import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { encrypt, decrypt } from '../../common/crypto';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';

export interface AccessKeyPublic {
  accessKey: string;
  appCode: string;
  createdBy: string | null;
  boundUserId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class AccessKeyService {
  private readonly logger = new Logger(AccessKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** appCode 归属 tenant 校验（tenantCode=null 走 accessKey，已被 TenantGuard 卡死 appCode）。 */
  private async assertAppOwned(appCode: string, tenantCode: string | null): Promise<void> {
    if (tenantCode === null) return;
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: { tenantCode: true },
    });
    if (!app || app.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    }
  }

  /**
   * Tenant-scoped access-key lookup。返回 r.appCode 给 caller。
   *
   * 比"先 findUnique 再 assertAppOwned"更安全：跨 tenant 的 accessKey 直接
   * 报"AccessKey not found"，不暴露目标 key 所属的 appCode（之前
   * assertAppOwned 抛"Application X not found" 等于侧信道泄露）。
   */
  private async lookupAccessKeyForTenant<S extends Record<string, true>>(
    accessKey: string,
    tenantCode: string | null,
    select: S,
  ): Promise<({ appCode: string } & { [K in keyof S]: unknown }) | null> {
    if (tenantCode === null) {
      return (await this.prisma.accessKey.findUnique({
        where: { accessKey },
        select: { appCode: true, ...select } as S & { appCode: true },
      })) as never;
    }
    return (await this.prisma.accessKey.findFirst({
      where: { accessKey, application: { tenantCode } },
      select: { appCode: true, ...select } as S & { appCode: true },
    })) as never;
  }

  async create(
    input: {
      appCode: string;
      createdBy?: string;
      expiresInDays?: number;
      /** 可选：把 key 绑给具体 user。绑了 HMAC 路径会注入 kintsugi.user_id GUC，
       *  scope=self 的 RLS policy 对该 key 生效；不绑则只走 tenant scope。 */
      boundUserId?: string;
    },
    tenantCode: string | null = null,
  ): Promise<{
    accessKey: string;
    secretKey: string;
    expiresAt: Date | null;
    boundUserId: string | null;
  }> {
    await this.assertAppOwned(input.appCode, tenantCode);
    if (input.boundUserId) {
      await this.assertUserInTenant(input.boundUserId, input.appCode, tenantCode);
    }
    const accessKey = `ak_${crypto.randomBytes(12).toString('hex')}`;
    const secretKey = `sk_${crypto.randomBytes(24).toString('hex')}`;
    // SDK 客户端用 raw secretKey 做 HMAC，服务端必须能拿到同一个原文。
    // 用 AES-GCM 加密落库；master key 来自 ENCRYPTION_KEY/SESSION_SECRET。
    // 字段名 secretKeyHash 沿用避免 migration；语义已不再是单向哈希。
    const secretKeyHash = encrypt(secretKey);
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86400_000)
      : null;
    await this.prisma.accessKey.create({
      data: {
        accessKey,
        appCode: input.appCode,
        secretKeyHash,
        createdBy: input.createdBy ?? null,
        boundUserId: input.boundUserId ?? null,
        expiresAt,
      },
    });
    // 一次性返回明文 secretKey（之后只能从 DB 解密）
    return { accessKey, secretKey, expiresAt, boundUserId: input.boundUserId ?? null };
  }

  /** 校验 boundUserId 与 app 同租户——防绑给跨租户用户。 */
  private async assertUserInTenant(
    userId: string,
    appCode: string,
    callerTenantCode: string | null,
  ): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantCode: true },
    });
    if (!u) throw new KintsugiError('NOT_FOUND', `User ${userId} not found`);
    // app 的 tenant 已经在 assertAppOwned 验过；这里只对 caller 的 tenant 二次校验
    if (callerTenantCode !== null && u.tenantCode !== callerTenantCode) {
      throw new KintsugiError('FORBIDDEN', 'cannot bind access key to user in another tenant');
    }
    // app.tenantCode 必须等于 user.tenantCode
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: { tenantCode: true },
    });
    if (!app || app.tenantCode !== u.tenantCode) {
      throw new KintsugiError('FORBIDDEN', 'user and application are in different tenants');
    }
  }

  async list(
    appCode: string,
    pageReq: PageRequest = {},
    tenantCode: string | null = null,
  ): Promise<PagedResult<AccessKeyPublic>> {
    await this.assertAppOwned(appCode, tenantCode);
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const where = { appCode };
    const select = {
      accessKey: true,
      appCode: true,
      createdBy: true,
      boundUserId: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    };
    const [data, total] = await Promise.all([
      this.prisma.accessKey.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip, select }),
      this.prisma.accessKey.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async revoke(
    accessKey: string,
    tenantCode: string | null = null,
  ): Promise<{ ok: true }> {
    const r = await this.lookupAccessKeyForTenant(accessKey, tenantCode, {});
    if (!r) throw new KintsugiError('NOT_FOUND', `AccessKey not found`);
    await this.prisma.accessKey.update({
      where: { accessKey },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * 旋转 secret：生成新 secretKey，旧 secret 在 graceMinutes 内仍可验签（默认 60 分钟）。
   * 时间窗结束后旧 secret 自然失效（verifySignature 会检查 prevValidUntil）。
   *
   * 客户端拿到响应后必须立刻把 secret 替换为 newSecretKey，并验证调用通畅；
   * 如发现仍依赖老的，等 grace 过期就会断流。
   */
  async rotate(
    accessKey: string,
    tenantCode: string | null = null,
    graceMinutes = 60,
  ): Promise<{ accessKey: string; newSecretKey: string; prevValidUntil: Date }> {
    const r = (await this.lookupAccessKeyForTenant(accessKey, tenantCode, {
      secretKeyHash: true,
      revokedAt: true,
      expiresAt: true,
    })) as { appCode: string; secretKeyHash: string; revokedAt: Date | null; expiresAt: Date | null } | null;
    if (!r) throw new KintsugiError('NOT_FOUND', `AccessKey not found`);
    if (r.revokedAt) throw new KintsugiError('VALIDATION_FAILED', `AccessKey already revoked`);
    if (r.expiresAt && r.expiresAt.getTime() < Date.now()) {
      throw new KintsugiError('VALIDATION_FAILED', `AccessKey already expired`);
    }

    const newSecretKey = `sk_${crypto.randomBytes(24).toString('hex')}`;
    const newSecretCipher = encrypt(newSecretKey);
    const prevValidUntil = new Date(Date.now() + Math.max(1, graceMinutes) * 60_000);

    await this.prisma.accessKey.update({
      where: { accessKey },
      data: {
        secretKeyHash: newSecretCipher,
        prevSecretKeyHash: r.secretKeyHash,
        prevValidUntil,
      },
    });
    return { accessKey, newSecretKey, prevValidUntil };
  }

  async verifySignature(args: {
    accessKey: string;
    signature: string;
    timestamp: string;
    nonce: string;
    method: string;
    path: string;
    body: string;
  }): Promise<{
    appCode: string;
    tenantCode: string;
    createdBy: string | null;
    boundUserId: string | null;
  } | null> {
    const record = await this.prisma.accessKey.findUnique({
      where: { accessKey: args.accessKey },
      include: { application: { select: { tenantCode: true } } },
    });
    if (!record || record.revokedAt) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

    // 5 分钟时间窗口
    const ts = Number(args.timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > 5 * 60_000) return null;

    // 解密拿到原文 secretKey（旧 bcrypt 数据 decrypt 会抛错，记日志后视为失效）
    const candidates: string[] = [];
    try {
      candidates.push(decrypt(record.secretKeyHash));
    } catch (err) {
      this.logger.warn(
        `accessKey ${args.accessKey} secret 无法解密（可能是旧版 bcrypt 数据）：${(err as Error).message}`,
      );
      return null;
    }
    // 轮转 grace 内允许旧 secret
    if (
      record.prevSecretKeyHash &&
      record.prevValidUntil &&
      record.prevValidUntil.getTime() > Date.now()
    ) {
      try {
        candidates.push(decrypt(record.prevSecretKeyHash));
      } catch {
        /* 旧值无法解密就当不存在，正常路径仍走新 secret */
      }
    }

    // canonical string：METHOD + '\n' + PATH + '\n' + TIMESTAMP + '\n' + NONCE + '\n' + BODY
    const canonical = [
      args.method.toUpperCase(),
      args.path,
      args.timestamp,
      args.nonce,
      args.body,
    ].join('\n');

    let matched = false;
    for (const sk of candidates) {
      const expectedSig = crypto.createHmac('sha256', sk).update(canonical).digest('hex');
      if (timingSafeEqual(expectedSig, args.signature)) {
        matched = true;
        break;
      }
    }
    if (!matched) return null;

    // 重放保护：验签通过后把 (accessKey, nonce) 落库；唯一索引冲突 = 同 nonce 已用过。
    // expiresAt 给 nonce 留 25 min（= 时间窗 5×），cleanup 任务 / 启动时清。
    const nonceExpiresAt = new Date(Date.now() + 25 * 60_000);
    try {
      await this.prisma.accessKeyNonce.create({
        data: {
          accessKey: args.accessKey,
          nonce: args.nonce,
          expiresAt: nonceExpiresAt,
        },
      });
    } catch (err) {
      // P2002 = unique constraint violation → replay
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        this.logger.warn(
          `replay detected for accessKey=${args.accessKey} nonce=${args.nonce}`,
        );
        return null;
      }
      // 其他 DB 错误 fail-closed —— 宁可拒一次正常请求，也不放行可能重放
      this.logger.error(
        `nonce persistence failed for accessKey=${args.accessKey}: ${(err as Error).message}`,
      );
      return null;
    }

    return {
      appCode: record.appCode,
      tenantCode: record.application.tenantCode,
      createdBy: record.createdBy,
      boundUserId: record.boundUserId,
    };
  }

  /** 清理过期 nonce 防表无限增长。启动时跑一次，可由调度器定时跑。 */
  async cleanupExpiredNonces(): Promise<number> {
    try {
      const r = await this.prisma.accessKeyNonce.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return r.count;
    } catch (err) {
      this.logger.warn(`cleanup nonces failed: ${(err as Error).message}`);
      return 0;
    }
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
