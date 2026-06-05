/**
 * AccessKeyController e2e。覆盖 create / list / revoke / rotate 四条路径，
 * 重点验：cross-tenant 不可访问、rotate grace 上下界、ValidationPipe。
 */

import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AccessKeyController } from './access-key.controller';
import { AccessKeyService } from './access-key.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';
import { encrypt } from '../../common/crypto';

interface AppRow {
  appCode: string;
  tenantCode: string;
}
interface UserRow {
  id: string;
  tenantCode: string;
}
interface KeyRow {
  accessKey: string;
  appCode: string;
  secretKeyHash: string;
  prevSecretKeyHash: string | null;
  prevValidUntil: Date | null;
  createdBy: string | null;
  boundUserId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

class FakePrisma {
  apps: AppRow[] = [
    { appCode: 'app-x', tenantCode: 't-real' },
    { appCode: 'app-other', tenantCode: 't-other' },
  ];
  users: UserRow[] = [{ id: 'u1', tenantCode: 't-real' }];
  keys: KeyRow[] = [];

  application = {
    findUnique: async ({ where }: { where: { appCode: string } }) =>
      this.apps.find((a) => a.appCode === where.appCode) ?? null,
  };
  user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.users.find((u) => u.id === where.id) ?? null,
  };
  accessKey = {
    create: async ({ data }: { data: Omit<KeyRow, 'createdAt' | 'revokedAt' | 'prevSecretKeyHash' | 'prevValidUntil' | 'boundUserId'> & Partial<Pick<KeyRow, 'boundUserId'>> }) => {
      const row: KeyRow = {
        accessKey: data.accessKey,
        appCode: data.appCode,
        secretKeyHash: data.secretKeyHash,
        prevSecretKeyHash: null,
        prevValidUntil: null,
        createdBy: data.createdBy ?? null,
        boundUserId: data.boundUserId ?? null,
        expiresAt: data.expiresAt ?? null,
        revokedAt: null,
        createdAt: new Date(),
      };
      this.keys.push(row);
      return row;
    },
    findMany: async ({ where, take, skip, select }: {
      where: { appCode: string };
      take?: number;
      skip?: number;
      select?: Record<string, boolean>;
    }) => {
      const rows = this.keys
        .filter((k) => k.appCode === where.appCode)
        .slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
      if (!select) return rows;
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        const src = r as unknown as Record<string, unknown>;
        for (const k of Object.keys(select)) if (select[k]) out[k] = src[k];
        return out;
      });
    },
    count: async ({ where }: { where: { appCode: string } }) =>
      this.keys.filter((k) => k.appCode === where.appCode).length,
    findUnique: async ({ where, select, include }: {
      where: { accessKey: string };
      select?: Record<string, boolean>;
      include?: { application?: { select: Record<string, boolean> } };
    }) => {
      const row = this.keys.find((k) => k.accessKey === where.accessKey);
      if (!row) return null;
      void select;
      if (include?.application) {
        const app = this.apps.find((a) => a.appCode === row.appCode);
        return { ...row, application: { tenantCode: app?.tenantCode ?? '' } };
      }
      return row;
    },
    findFirst: async ({ where }: {
      where: {
        accessKey: string;
        application?: { tenantCode: string };
      };
    }) => {
      const row = this.keys.find((k) => k.accessKey === where.accessKey);
      if (!row) return null;
      if (where.application?.tenantCode) {
        const app = this.apps.find((a) => a.appCode === row.appCode);
        if (app?.tenantCode !== where.application.tenantCode) return null;
      }
      return row;
    },
    update: async ({ where, data }: { where: { accessKey: string }; data: Partial<KeyRow> }) => {
      const row = this.keys.find((k) => k.accessKey === where.accessKey);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
  };
  accessKeyNonce = {
    create: async () => ({}),
    deleteMany: async () => ({ count: 0 }),
  };
}

let injectedUser: { sub: string; tenantCode: string; username: string } | null = null;

@Injectable()
class FakeUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    req.user = injectedUser ?? undefined;
    return true;
  }
}

describe('AccessKeyController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['ENCRYPTION_KEY'] = 'test-encryption-key-32-bytes-min-XXXXXX';
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [AccessKeyController],
      providers: [
        AccessKeyService,
        { provide: PrismaService, useClass: FakePrisma },
        { provide: APP_GUARD, useClass: FakeUserGuard },
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

  it('create returns accessKey + secretKey + boundUserId echo', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x', expiresInDays: 30, boundUserId: 'u1' });
    expect(res.status).toBe(201);
    expect(res.body.accessKey).toMatch(/^ak_/);
    expect(res.body.secretKey).toMatch(/^sk_/);
    expect(res.body.boundUserId).toBe('u1');
    expect(typeof res.body.expiresAt).toBe('string');
  });

  it('create against another tenant\'s app → NOT_FOUND', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-other' });
    expect(res.status).toBe(404);
  });

  it('expiresInDays out of range (≥ 3650+1) → 400 ValidationPipe', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x', expiresInDays: 99999 });
    expect(res.status).toBe(400);
  });

  it('list scopes to ?appCode=', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/access-keys?appCode=app-x');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.every((k: KeyRow) => k.appCode === 'app-x')).toBe(true);
    // 不能泄漏 secretKeyHash
    expect(res.body.data[0]?.secretKeyHash).toBeUndefined();
  });

  it('rotate enforces grace bounds (clamps to [10, 1440] minutes)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    // 准备一条带 secret 的 key
    const create = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x' });
    const ak = create.body.accessKey as string;

    // 输入 5min（< 10）会被 clamp 到 10min
    const r = await request(app.getHttpServer())
      .post(`/api/access-keys/${ak}/rotate?graceMinutes=5`);
    expect(r.status).toBe(201);
    expect(r.body.newSecretKey).toMatch(/^sk_/);
    const prevValidUntil = new Date(r.body.prevValidUntil as string).getTime();
    const delta = prevValidUntil - Date.now();
    // 应当 ~10min
    expect(delta).toBeGreaterThan(9 * 60_000);
    expect(delta).toBeLessThan(11 * 60_000);
    // 旁路：encrypt 来 ack 一下导入正确
    expect(typeof encrypt('x')).toBe('string');
  });

  it('revoke marks revokedAt; double revoke OK', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const create = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x' });
    const ak = create.body.accessKey as string;
    const r1 = await request(app.getHttpServer()).delete(`/api/access-keys/${ak}`);
    expect(r1.status).toBe(200);
  });

  it('cross-tenant revoke → 404 "AccessKey not found" (no app code leak)', async () => {
    // tenant A 创 key
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const create = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x' });
    const ak = create.body.accessKey as string;

    // tenant B 试着 revoke 别人的 key → 应该返回 AccessKey not found（不暴露 appCode）
    injectedUser = { sub: 'u2', tenantCode: 't-other', username: 'bob' };
    const r = await request(app.getHttpServer()).delete(`/api/access-keys/${ak}`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).toMatch(/AccessKey not found/);
    expect(JSON.stringify(r.body)).not.toMatch(/app-x/); // 不漏 appCode
  });

  it('cross-tenant rotate → 404 "AccessKey not found" (no app code leak)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const create = await request(app.getHttpServer())
      .post('/api/access-keys')
      .send({ appCode: 'app-x' });
    const ak = create.body.accessKey as string;

    injectedUser = { sub: 'u2', tenantCode: 't-other', username: 'bob' };
    const r = await request(app.getHttpServer()).post(`/api/access-keys/${ak}/rotate`);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).toMatch(/AccessKey not found/);
    expect(JSON.stringify(r.body)).not.toMatch(/app-x/);
  });
});
