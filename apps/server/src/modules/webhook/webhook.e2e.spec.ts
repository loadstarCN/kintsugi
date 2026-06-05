/**
 * WebhookController e2e：CRUD shape，不验证派发链路（那个由 webhook.spec.ts 单测覆盖）。
 *
 * 重点：
 *  - POST /api/webhooks → 一次性返回 secret
 *  - GET /api/webhooks → 列表
 *  - PATCH /:id/enabled → toggle
 *  - DELETE /:id → 200
 *  - 缺 events / url 非 http(s) → 400
 *
 * Permission decorator (@Permission) 没装实际 PermissionGuard，所以 RBAC 那条不验证；
 * 想验 RBAC 的话单写 permission.guard.spec。
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
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';

interface SubRow {
  id: string;
  appCode: string;
  url: string;
  events: string[];
  description: string | null;
  enabled: boolean;
  secretCipher: string;
  createdAt: Date;
  updatedAt: Date;
}

class FakePrisma {
  subs: SubRow[] = [];
  apps: Array<{ appCode: string; tenantCode: string }> = [
    { appCode: 'app-x', tenantCode: 't-real' },
  ];

  application = {
    findUnique: async ({ where }: { where: { appCode: string } }) =>
      this.apps.find((a) => a.appCode === where.appCode) ?? null,
  };

  webhookSub = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.subs.find((s) => s.id === where.id) ?? null,
    create: async ({ data, select: _ignored }: { data: Omit<SubRow, 'id' | 'createdAt' | 'updatedAt' | 'enabled'>; select?: unknown }) => {
      const id = `sub-${this.subs.length + 1}`;
      const row: SubRow = {
        id,
        ...data,
        description: data.description ?? null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.subs.push(row);
      return { id };
    },
    findMany: async ({ where, select }: { where?: { appCode?: string }; select?: Record<string, boolean> }) => {
      let rows = this.subs;
      if (where?.appCode) rows = rows.filter((r) => r.appCode === where.appCode);
      // honor select projection — service explicitly excludes secretCipher,
      // and the spec asserts secret never leaks via list
      if (!select) return rows;
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        const src = r as unknown as Record<string, unknown>;
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = src[k];
        }
        return out;
      });
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<SubRow> }) => {
      const r = this.subs.find((x) => x.id === where.id);
      if (!r) throw new Error('not found');
      Object.assign(r, data);
      return r;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const i = this.subs.findIndex((x) => x.id === where.id);
      if (i < 0) throw new Error('not found');
      this.subs.splice(i, 1);
      return { id: where.id };
    },
  };
}

const injectedUser: { sub: string; tenantCode: string; username: string } = {
  sub: 'u1',
  tenantCode: 't-real',
  username: 'a',
};

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    if (injectedUser) req.user = injectedUser;
    return true;
  }
}

describe('WebhookController (e2e)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let createdId = '';
  let createdSecret = '';

  beforeAll(async () => {
    process.env['ENCRYPTION_KEY'] = 'test-encryption-key-32-bytes-min-XXXXXX';
    // hook.example 是测试假 host，DNS 解析会失败被 SSRF 直接拒；这里 bypass
    process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'] = 'true';
    prisma = new FakePrisma();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => {
    delete process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'];
    await app.close();
  });

  it('POST /api/webhooks creates and returns secret once', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/webhooks')
      .send({
        appCode: 'app-x',
        url: 'https://hook.example/in',
        events: ['dataset.created', 'dataset.updated'],
        description: 'crm sync',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^sub-/);
    expect(res.body.secret).toMatch(/^whs_/);
    createdId = res.body.id;
    createdSecret = res.body.secret;
  });

  it('non-http URL → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/webhooks')
      .send({ appCode: 'app-x', url: 'ftp://x', events: ['dataset.created'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('empty events → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/webhooks')
      .send({ appCode: 'app-x', url: 'https://hook.example/in', events: [] });
    expect(res.status).toBe(400);
  });

  it('GET /api/webhooks lists subs scoped to app', async () => {
    const res = await request(app.getHttpServer()).get('/api/webhooks?appCode=app-x');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(createdId);
    // 不能泄漏 secret
    expect(res.body[0].secret).toBeUndefined();
    expect(res.body[0].secretCipher).toBeUndefined();
  });

  it('PATCH /:id/enabled toggles', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/webhooks/${createdId}/enabled`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(prisma.subs[0]!.enabled).toBe(false);
  });

  it('跨租户 create 被拒（appCode 不在当前 tenant）', async () => {
    prisma.apps.push({ appCode: 'app-other', tenantCode: 't-other' });
    const res = await request(app.getHttpServer())
      .post('/api/webhooks')
      .send({
        appCode: 'app-other',
        url: 'https://hook.example/y',
        events: ['dataset.created'],
      });
    expect([400, 404]).toContain(res.status);
    expect(prisma.subs.find((s) => s.appCode === 'app-other')).toBeUndefined();
  });

  it('跨租户 list 被拒（appCode 属别的 tenant）', async () => {
    const res = await request(app.getHttpServer()).get('/api/webhooks?appCode=app-other');
    expect([400, 404]).toContain(res.status);
  });

  it('跨租户 toggle/delete 被拒（sub 反查 appCode 后租户不符）', async () => {
    // 直接造一条属于 t-other 的 sub
    prisma.subs.push({
      id: 'sub-foreign',
      appCode: 'app-other',
      url: 'https://hook.example/z',
      events: ['dataset.created'],
      secretCipher: 'xxx',
      description: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const r1 = await request(app.getHttpServer())
      .patch('/api/webhooks/sub-foreign/enabled')
      .send({ enabled: false });
    expect([400, 404]).toContain(r1.status);
    const r2 = await request(app.getHttpServer()).delete('/api/webhooks/sub-foreign');
    expect([400, 404]).toContain(r2.status);
    // 仍存活
    expect(prisma.subs.find((s) => s.id === 'sub-foreign')).toBeDefined();
  });

  it('DELETE /:id removes', async () => {
    const res = await request(app.getHttpServer()).delete(`/api/webhooks/${createdId}`);
    expect(res.status).toBe(200);
    expect(prisma.subs.find((s) => s.id === createdId)).toBeUndefined();
    // sanity: secret 在响应里只该出现一次（创建那次）
    expect(createdSecret).toBeTruthy();
  });
});
