import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError } from '@kintsugi/shared';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string; // userId
  tenantCode: string;
  username: string;
  jti?: string;
  exp?: number;
  iat?: number;
  roles?: string[];
}

/** JWT iss/aud claim：sign 和 verify 必须配对，挡掉别 service 拿同 secret 签的 token。 */
const JWT_ISSUER = 'kintsugi';
const JWT_AUDIENCE = 'kintsugi-api';

/** dev fallback：仅 NODE_ENV != production 时启用，且每个进程随机生成——
 *  老的硬编码 'dev-insecure-secret-change-me' 太致命：一旦写进生产 image
 *  且 JWT_SECRET 漏配，全平台 token 可被任意人伪造。
 *  随机值意味着 dev server 重启所有人被踢，但这正是我们想要的"提示你设了没"。 */
const DEV_FALLBACK_SECRET = process.env['NODE_ENV'] === 'production'
  ? null
  : crypto.randomBytes(48).toString('hex');

const MIN_SECRET_BYTES = 32;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 启动时强制校验 JWT_SECRET，让漏配在 boot 阶段就 fail-fast，
   *  而不是第一个请求来才暴露。 */
  onModuleInit(): void {
    this.secret(); // 触发同款检查；不通过会抛
  }

  private secret(): string {
    const s = process.env['JWT_SECRET'];
    if (s && s.length >= MIN_SECRET_BYTES) return s;
    if (process.env['NODE_ENV'] === 'production') {
      if (!s || s.length === 0) {
        throw new Error(
          'JWT_SECRET is required in production. Set a random value of at least ' +
            `${MIN_SECRET_BYTES} bytes (e.g. \`openssl rand -hex 48\`).`,
        );
      }
      throw new Error(
        `JWT_SECRET is too short: got ${s.length} chars, need ≥${MIN_SECRET_BYTES}. ` +
          'Generate with `openssl rand -hex 48`.',
      );
    }
    if (s && s.length < MIN_SECRET_BYTES) {
      this.logger.warn(
        `JWT_SECRET set but only ${s.length} chars (<${MIN_SECRET_BYTES}); ` +
          'using anyway since NODE_ENV != production.',
      );
      return s;
    }
    this.logger.warn(
      'JWT_SECRET unset; using random per-process secret (NODE_ENV != production). ' +
        'All tokens invalidate on restart — this is intentional dev behavior.',
    );
    // DEV_FALLBACK_SECRET 在 production 时是 null，到这条已经被上面的 throw 拦掉了
    return DEV_FALLBACK_SECRET as string;
  }

  async register(input: {
    tenantCode: string;
    username: string;
    password: string;
    email?: string;
    phone?: string;
    department?: string;
  }): Promise<{ id: string; token: string }> {
    // 公开 register 默认关闭——商业系统走 /api/trial/apply 申请审批，或平台方
    // 直建 tenant。本地 dev 把 KINTSUGI_ALLOW_PUBLIC_REGISTER=true 打开。
    if (process.env['KINTSUGI_ALLOW_PUBLIC_REGISTER'] !== 'true') {
      throw new KintsugiError(
        'FORBIDDEN',
        'public registration is disabled. Apply at /api/trial/apply or contact platform admin.',
      );
    }
    // 首次注册：如果 tenant 不存在，顺带建 tenant
    await this.prisma.tenant.upsert({
      where: { tenantCode: input.tenantCode },
      create: { tenantCode: input.tenantCode, tenantName: input.tenantCode, edition: 'PRO' },
      update: {},
    });

    const passwordHash = await bcrypt.hash(input.password, 10);
    let user: { id: string; tenantCode: string; username: string };
    try {
      // 直接 create —— 让 (tenantCode, username) 的 @@unique 兜底并发情况，
      // 比"先 findFirst 再 create"少一次往返、也避免 TOCTOU 在 bcrypt 那 ~100ms 窗口被绕。
      user = await this.prisma.user.create({
        data: {
          tenantCode: input.tenantCode,
          username: input.username,
          email: input.email ?? null,
          phone: input.phone ?? null,
          department: input.department ?? null,
          passwordHash,
        },
        select: { id: true, tenantCode: true, username: true },
      });
    } catch (err) {
      // Prisma P2002 = unique constraint violation
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new KintsugiError(
          'CONFLICT',
          `username '${input.username}' already exists in tenant`,
        );
      }
      throw err;
    }

    const token = this.signToken({
      sub: user.id,
      tenantCode: user.tenantCode,
      username: user.username,
    });
    return { id: user.id, token };
  }

  async login(input: {
    tenantCode: string;
    username: string;
    password: string;
  }): Promise<{ id: string; tenantCode: string; username: string; token: string }> {
    const user = await this.prisma.user.findFirst({
      where: { tenantCode: input.tenantCode, username: input.username },
    });
    if (!user) throw new KintsugiError('UNAUTHENTICATED', 'invalid credentials');

    // user-level lock：上层 LoginThrottle 是 IP 维度，挡不住攻击者从一堆 IP 试同一个账号
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw new KintsugiError(
        'UNAUTHENTICATED',
        `account temporarily locked, retry in ${remaining}s`,
      );
    }

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(user.id, user.failedLoginCount, user.lastFailedLoginAt);
      throw new KintsugiError('UNAUTHENTICATED', 'invalid credentials');
    }

    // 试用 / 付费订阅过期 → 拒登录（商业策略：到期账户必须续费才能继续用）
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantCode: user.tenantCode },
      select: {
        edition: true,
        trialExpiresAt: true,
        subscriptionExpiresAt: true,
      },
    });
    const now = Date.now();
    if (
      tenant?.edition === 'TRIAL' &&
      tenant.trialExpiresAt &&
      tenant.trialExpiresAt.getTime() < now
    ) {
      this.logger.warn(
        `login refused: tenant ${user.tenantCode} trial expired at ${tenant.trialExpiresAt.toISOString()}`,
      );
      throw new KintsugiError(
        'FORBIDDEN',
        `trial expired at ${tenant.trialExpiresAt.toISOString()}. Contact admin to upgrade.`,
        { trialExpiresAt: tenant.trialExpiresAt.toISOString() },
      );
    }
    if (
      tenant &&
      tenant.edition !== 'TRIAL' &&
      tenant.subscriptionExpiresAt &&
      tenant.subscriptionExpiresAt.getTime() < now
    ) {
      this.logger.warn(
        `login refused: tenant ${user.tenantCode} subscription expired at ${tenant.subscriptionExpiresAt.toISOString()}`,
      );
      throw new KintsugiError(
        'FORBIDDEN',
        `subscription expired at ${tenant.subscriptionExpiresAt.toISOString()}. Renew at /billing to continue.`,
        { subscriptionExpiresAt: tenant.subscriptionExpiresAt.toISOString() },
      );
    }

    // 成功 → 清失败计数
    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
      });
    }

    const token = this.signToken({
      sub: user.id,
      tenantCode: user.tenantCode,
      username: user.username,
    });
    return { id: user.id, tenantCode: user.tenantCode, username: user.username, token };
  }

  /**
   * 累积失败登录。窗口外（≥WINDOW_MS 没失败过）重新从 1 计；窗口内累加。
   * 达到阈值 → 设 lockedUntil。default 5 fails / 15min → lock 15min。
   */
  private async recordFailedLogin(
    userId: string,
    _prevCount: number,
    _prevLastFailedAt: Date | null,
  ): Promise<void> {
    void _prevCount;
    void _prevLastFailedAt;
    const WINDOW_MS = Number(process.env['LOGIN_FAIL_WINDOW_MS'] ?? '900000'); // 15min
    const MAX_FAILS = Number(process.env['LOGIN_FAIL_MAX'] ?? '5');
    const LOCK_MS = Number(process.env['LOGIN_LOCK_MS'] ?? '900000'); // 15min

    const now = new Date();
    const windowStart = new Date(now.getTime() - WINDOW_MS);
    try {
      // 原子 increment：在窗口内累加。snapshot-based 之前的实现里 prevCount 是
      // bcrypt.compare 之前读的，并发失败 login 会让多次失败被同一基线覆盖（attacker
      // 可以打 N 个并发请求绕过 lockout）。
      const inWindow = await this.prisma.user.updateMany({
        where: { id: userId, lastFailedLoginAt: { gt: windowStart } },
        data: {
          failedLoginCount: { increment: 1 },
          lastFailedLoginAt: now,
        },
      });
      if (inWindow.count === 0) {
        // 窗口外 / 第一次失败 → reset 到 1
        await this.prisma.user.update({
          where: { id: userId },
          data: { failedLoginCount: 1, lastFailedLoginAt: now },
        });
      }
      // 读回当前 count，决定是否要 lock
      const cur = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { failedLoginCount: true, lockedUntil: true },
      });
      if (cur && cur.failedLoginCount >= MAX_FAILS) {
        // updateMany 而非 update —— 已经 lock 的不延长（避免重复 fail 无限拉长 lock）
        const lockedUntil = new Date(now.getTime() + LOCK_MS);
        await this.prisma.user.updateMany({
          where: { id: userId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
          data: { lockedUntil },
        });
        this.logger.warn(
          `user ${userId} locked until ${lockedUntil.toISOString()} after ${cur.failedLoginCount} failed logins`,
        );
      }
    } catch (err) {
      // failed-login bookkeeping 失败 warn-only —— 不阻塞 login 流程
      this.logger.warn(`failed-login bookkeeping failed: ${(err as Error).message}`);
    }
  }

  /**
   * 同步签名校验（不查 DB）—— 给 audit interceptor / 内部 fast path 用。
   * 不能区分"token 还有效 vs 已撤销"。要严格校验请用 verifyAndCheckRevocation。
   */
  verify(token: string): JwtPayload {
    try {
      const p = jwt.verify(token, this.secret(), {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (typeof p === 'string') throw new Error('unexpected token shape');
      return p as unknown as JwtPayload;
    } catch (err) {
      throw new KintsugiError('UNAUTHENTICATED', `invalid token: ${(err as Error).message}`);
    }
  }

  /**
   * 完整校验：签名 + jti 是否在撤销名单里。
   * Guard 里用这一条；每次 HTTP 多一次 DB 主键查（有 index）。
   */
  async verifyAndCheckRevocation(token: string): Promise<JwtPayload> {
    const payload = this.verify(token);
    if (payload.jti) {
      const revoked = await this.prisma.jwtRevocation.findUnique({
        where: { jti: payload.jti },
        select: { jti: true },
      });
      if (revoked) {
        throw new KintsugiError('UNAUTHENTICATED', 'token has been revoked');
      }
    }
    return payload;
  }

  /** logout 写入撤销名单。expiresAt 取 token 的 exp，到期可清理。 */
  async revokeToken(token: string): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = this.verify(token);
    } catch {
      // token 已经无效，无需撤销
      return;
    }
    if (!payload.jti || !payload.exp) return;
    const expiresAt = new Date(payload.exp * 1000);
    await this.prisma.jwtRevocation
      .upsert({
        where: { jti: payload.jti },
        create: {
          jti: payload.jti,
          userId: payload.sub,
          expiresAt,
        },
        update: {}, // 已撤销过就保持原状
      })
      .catch((err) => {
        this.logger.warn(`revoke token write failed: ${(err as Error).message}`);
      });
  }

  /** 启动惰性清理：删过期撤销项防表无限增长。 */
  async cleanupExpiredRevocations(): Promise<number> {
    try {
      const r = await this.prisma.jwtRevocation.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return r.count;
    } catch (err) {
      this.logger.warn(`cleanup revocations failed: ${(err as Error).message}`);
      return 0;
    }
  }

  private signToken(payload: JwtPayload): string {
    const jti = crypto.randomBytes(16).toString('hex');
    return jwt.sign({ ...payload, jti }, this.secret(), {
      expiresIn: '7d',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  async me(userId: string): Promise<{
    id: string;
    tenantCode: string;
    username: string;
    email: string | null;
    roles: string[];
    /**
     * 用户全部 grants，扁平化（去重）。给前端按 grants 决定 nav / 操作可见性用。
     * 后端最终鉴权仍走 PermissionGuard + RbacService.userHasPermission（带通配符匹配），
     * 这里给前端的只是"展示用 hint"，不可作为安全边界。
     */
    grants: string[];
  }> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!u) throw new KintsugiError('NOT_FOUND', 'user not found');
    const grants = new Set<string>();
    for (const ur of u.roles) {
      const perms = (ur.role.permissions as unknown as { grants?: string[] }) ?? {};
      for (const g of perms.grants ?? []) grants.add(g);
    }
    return {
      id: u.id,
      tenantCode: u.tenantCode,
      username: u.username,
      email: u.email,
      roles: u.roles.map((ur) => ur.role.name),
      grants: [...grants],
    };
  }
}
