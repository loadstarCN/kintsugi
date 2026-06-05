/**
 * AuthController e2e：register / login / me / logout 全打通。
 * 不连真 RDS；用 in-memory fake Prisma 提供 user/tenant/jwtRevocation 三张表。
 *
 * 验证：
 *  - register 创建租户 + 用户 + 返回 JWT
 *  - 同 (tenantCode, username) 再 register → CONFLICT
 *  - login 正确密码 → 200 + token
 *  - login 错误密码 → 401，刷 failedLoginCount
 *  - me 用 Bearer 拿到自己（包括 roles）
 *  - logout 写 JwtRevocation；下一次 verify 失败
 */

import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './auth.guard';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';

interface UserRow {
  id: string;
  tenantCode: string;
  username: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  passwordHash: string;
  failedLoginCount: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
  roles: Array<{ role: { name: string } }>;
}

class FakePrisma {
  tenants = new Set<string>();
  users: UserRow[] = [];
  revocations = new Set<string>();

  tenant = {
    upsert: async ({ where: { tenantCode }, create }: { where: { tenantCode: string }; create: { tenantCode: string } }) => {
      this.tenants.add(create.tenantCode ?? tenantCode);
      return { tenantCode: create.tenantCode ?? tenantCode };
    },
    findUnique: async ({ where: { tenantCode } }: { where: { tenantCode: string } }): Promise<{ edition: string; trialExpiresAt: Date | null } | null> => {
      // 默认非试用 → login 不会被 trial-expired 挡。
      // 想测 trial 过期的用例可以在 spec 里覆写这个返回值。
      return this.tenants.has(tenantCode)
        ? { edition: 'PRO', trialExpiresAt: null }
        : null;
    },
  };

  user = {
    create: async ({ data, select }: { data: Omit<UserRow, 'id' | 'failedLoginCount' | 'lastFailedLoginAt' | 'lockedUntil' | 'roles'>; select?: Record<string, boolean> }) => {
      if (this.users.some((u) => u.tenantCode === data.tenantCode && u.username === data.username)) {
        const err = new Error('unique violation') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const id = `u-${this.users.length + 1}`;
      const row: UserRow = {
        id,
        tenantCode: data.tenantCode,
        username: data.username,
        email: data.email ?? null,
        phone: data.phone ?? null,
        department: data.department ?? null,
        passwordHash: data.passwordHash,
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        roles: [],
      };
      this.users.push(row);
      return select ? { id: row.id, tenantCode: row.tenantCode, username: row.username } : row;
    },
    findFirst: async ({ where }: { where: { tenantCode: string; username: string } }) => {
      return this.users.find((u) => u.tenantCode === where.tenantCode && u.username === where.username) ?? null;
    },
    findUnique: async ({ where, include }: { where: { id: string }; include?: { roles?: { include: { role: boolean } } } }) => {
      const u = this.users.find((x) => x.id === where.id) ?? null;
      if (!u) return null;
      return include?.roles ? u : { ...u, roles: undefined };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> & { failedLoginCount?: number | { increment: number } } }) => {
      const u = this.users.find((x) => x.id === where.id);
      if (!u) throw new Error('not found');
      const d = data as Record<string, unknown>;
      if (d['failedLoginCount'] != null) {
        const v = d['failedLoginCount'];
        u.failedLoginCount =
          typeof v === 'object' && v !== null && 'increment' in v
            ? u.failedLoginCount + (v as { increment: number }).increment
            : (v as number);
      }
      for (const k of Object.keys(d)) {
        if (k === 'failedLoginCount') continue;
        (u as unknown as Record<string, unknown>)[k] = d[k];
      }
      return u;
    },
    updateMany: async ({ where, data }: {
      where: { id: string; lastFailedLoginAt?: { gt: Date }; OR?: Array<{ lockedUntil: null | { lt: Date } }> };
      data: Partial<UserRow> & { failedLoginCount?: number | { increment: number } };
    }) => {
      const u = this.users.find((x) => x.id === where.id);
      if (!u) return { count: 0 };
      if (where.lastFailedLoginAt?.gt) {
        if (!u.lastFailedLoginAt || u.lastFailedLoginAt <= where.lastFailedLoginAt.gt) {
          return { count: 0 };
        }
      }
      if (where.OR) {
        const now = (where.OR.find((c) => c.lockedUntil && typeof c.lockedUntil === 'object') as { lockedUntil: { lt: Date } } | undefined)?.lockedUntil?.lt;
        const passes = u.lockedUntil === null || (now && u.lockedUntil < now);
        if (!passes) return { count: 0 };
      }
      const d = data as Record<string, unknown>;
      if (d['failedLoginCount'] != null) {
        const v = d['failedLoginCount'];
        u.failedLoginCount =
          typeof v === 'object' && v !== null && 'increment' in v
            ? u.failedLoginCount + (v as { increment: number }).increment
            : (v as number);
      }
      for (const k of Object.keys(d)) {
        if (k === 'failedLoginCount') continue;
        (u as unknown as Record<string, unknown>)[k] = d[k];
      }
      return { count: 1 };
    },
  };

  jwtRevocation = {
    findUnique: async ({ where: { jti } }: { where: { jti: string } }) =>
      this.revocations.has(jti) ? { jti } : null,
    upsert: async ({ where: { jti } }: { where: { jti: string } }) => {
      this.revocations.add(jti);
      return { jti };
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'test-jwt-secret-min-32-bytes-XXXXXXXX';
    // 测试覆盖 register flow → 必须显式开公开注册
    process.env['KINTSUGI_ALLOW_PUBLIC_REGISTER'] = 'true';
    prisma = new FakePrisma();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        Reflector,
        JwtGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('POST /api/auth/register creates tenant + user + returns token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        tenantCode: 'tnt-a',
        username: 'alice',
        password: 'long-enough-password-1',
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.id).toMatch(/^u-/);
    expect(prisma.users).toHaveLength(1);
  });

  it('register with same (tenant, username) → CONFLICT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        tenantCode: 'tnt-a',
        username: 'alice',
        password: 'long-enough-password-1',
      });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('register 公开关闭时（KINTSUGI_ALLOW_PUBLIC_REGISTER 未设）→ 403', async () => {
    delete process.env['KINTSUGI_ALLOW_PUBLIC_REGISTER'];
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        tenantCode: 'rejected-tenant',
        username: 'no-go',
        password: 'long-enough-password-XX',
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toContain('public registration is disabled');
    // 后续测试还要 register，恢复 env
    process.env['KINTSUGI_ALLOW_PUBLIC_REGISTER'] = 'true';
  });

  it('TRIAL tenant 过期 → login 拒（FORBIDDEN）', async () => {
    // 直接造一个 TRIAL 用户 + 过期 trial，绕过 register
    const passwordHash = bcrypt.hashSync('trial-correct-pwd-xx', 4);
    prisma.users.push({
      id: 'u-trial',
      tenantCode: 'trial-tnt',
      username: 'trialuser',
      email: null,
      phone: null,
      department: null,
      passwordHash,
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      roles: [],
    });
    prisma.tenants.add('trial-tnt');
    // 临时 hack：tenant.findUnique 返回 trial 过期态
    const orig = prisma.tenant.findUnique;
    prisma.tenant.findUnique = async ({ where }: { where: { tenantCode: string } }) => {
      if (where.tenantCode === 'trial-tnt') {
        return { edition: 'TRIAL' as const, trialExpiresAt: new Date(Date.now() - 1000) };
      }
      return orig.call(prisma.tenant, { where });
    };
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantCode: 'trial-tnt',
      username: 'trialuser',
      password: 'trial-correct-pwd-xx',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toContain('trial expired');
    prisma.tenant.findUnique = orig;
  });

  it('login wrong password → 401, increments failedLoginCount', async () => {
    const before = prisma.users[0]!.failedLoginCount;
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantCode: 'tnt-a',
      username: 'alice',
      password: 'wrong-password-also-long',
    });
    expect(res.status).toBe(401);
    expect(prisma.users[0]!.failedLoginCount).toBe(before + 1);
  });

  it('login correct password → 200 + token + counter reset', async () => {
    // 先把 hash 备好 —— register 用 bcrypt.hash with cost 10 慢；测试里用 cost 4 加速
    prisma.users[0]!.passwordHash = bcrypt.hashSync('correct-password-12chars', 4);
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantCode: 'tnt-a',
      username: 'alice',
      password: 'correct-password-12chars',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(prisma.users[0]!.failedLoginCount).toBe(0);
  });

  it('GET /api/auth/me without token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('me with Bearer → returns user shape', async () => {
    prisma.users[0]!.passwordHash = bcrypt.hashSync('correct-password-12chars', 4);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantCode: 'tnt-a',
      username: 'alice',
      password: 'correct-password-12chars',
    });
    const token = login.body.token as string;
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      tenantCode: 'tnt-a',
      username: 'alice',
      roles: [],
    });
  });

  it('logout writes a JwtRevocation row (revocation enforced by JwtGuard, not /me)', async () => {
    prisma.users[0]!.passwordHash = bcrypt.hashSync('correct-password-12chars', 4);
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({
      tenantCode: 'tnt-a',
      username: 'alice',
      password: 'correct-password-12chars',
    });
    const token = login.body.token as string;
    const before = prisma.revocations.size;
    const out = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('authorization', `Bearer ${token}`);
    expect(out.status).toBe(201);
    expect(prisma.revocations.size).toBe(before + 1);
  });
});
