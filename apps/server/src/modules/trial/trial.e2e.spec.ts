import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { TrialController, TrialAdminController } from './trial.controller';
import { TrialService } from './trial.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';

let lastCall: { op: string; args: unknown[]; reviewerUserId?: string } | null = null;

const fakeService = {
  apply: async (input: unknown) => {
    lastCall = { op: 'apply', args: [input] };
    return { id: 'app-new' };
  },
  listPending: async (opts: unknown) => {
    lastCall = { op: 'list', args: [opts] };
    return { data: [], total: 0, page: 1, pageSize: 50 };
  },
  approve: async (id: string, input: { reviewerUserId: string; tenantCode: string; tenantName: string; username: string; password: string }) => {
    lastCall = { op: 'approve', args: [id, input], reviewerUserId: input.reviewerUserId };
    return { tenantCode: input.tenantCode, userId: 'u-new' };
  },
  reject: async (id: string, reviewer: string, note?: string) => {
    lastCall = { op: 'reject', args: [id, note], reviewerUserId: reviewer };
    return { ok: true };
  },
};

let injectedUser: { sub: string; tenantCode: string; username: string } | null = null;

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    if (injectedUser) req.user = injectedUser;
    return true;
  }
}

describe('TrialController + TrialAdminController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [TrialController, TrialAdminController],
      providers: [
        { provide: TrialService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => await app.close());
  beforeEach(() => {
    lastCall = null;
    injectedUser = null;
  });

  // ---- 公开 apply ----

  it('POST /api/trial/apply 公开访问，返回 application id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trial/apply')
      .send({
        contactName: '张三',
        email: 'zhangsan@example.com',
        company: 'Acme',
        useCase: '想做 BI',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('app-new');
    expect(lastCall?.op).toBe('apply');
  });

  it('apply: 缺 contactName → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trial/apply')
      .send({ email: 'a@b.c' });
    expect(res.status).toBe(400);
  });

  it('apply: 邮箱格式错 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trial/apply')
      .send({ contactName: '张', email: 'not-email' });
    expect(res.status).toBe(400);
  });

  it('apply: useCase 超长 → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/trial/apply')
      .send({
        contactName: '张',
        email: 'a@b.c',
        useCase: 'x'.repeat(2001),
      });
    expect(res.status).toBe(400);
  });

  // ---- admin (PermissionGuard 在真生产挡住，e2e 不装 guard，验证 service 透传 + reviewerUserId) ----

  it('GET /api/admin/trials 透传 status filter', async () => {
    injectedUser = { sub: 'u-admin', tenantCode: 't', username: 'admin' };
    const res = await request(app.getHttpServer())
      .get('/api/admin/trials?status=PENDING&page=2&pageSize=10');
    expect(res.status).toBe(200);
    expect(lastCall?.args[0]).toMatchObject({ status: 'PENDING', page: 2, pageSize: 10 });
  });

  it('POST /api/admin/trials/:id/approve 把 reviewerUserId 从 JWT 取，不从 body', async () => {
    injectedUser = { sub: 'u-admin-from-jwt', tenantCode: 't', username: 'admin' };
    const res = await request(app.getHttpServer())
      .post('/api/admin/trials/app-1/approve')
      .send({
        tenantCode: 'acme',
        tenantName: 'Acme Co.',
        username: 'admin',
        password: 'temp-pass-2026-xyz',
        // 即使 body 里写 reviewerUserId 也应该被 forbidNonWhitelisted 或被忽略
      });
    expect(res.status).toBe(201);
    expect(lastCall?.reviewerUserId).toBe('u-admin-from-jwt');
    expect(lastCall?.args[0]).toBe('app-1');
  });

  it('approve 缺 password → 400', async () => {
    injectedUser = { sub: 'u-admin', tenantCode: 't', username: 'admin' };
    const res = await request(app.getHttpServer())
      .post('/api/admin/trials/app-1/approve')
      .send({ tenantCode: 'acme', tenantName: 'A', username: 'u' });
    expect(res.status).toBe(400);
  });

  it('approve password 短于 12 → 400 (admin 不能给弱密码)', async () => {
    injectedUser = { sub: 'u-admin', tenantCode: 't', username: 'admin' };
    const res = await request(app.getHttpServer())
      .post('/api/admin/trials/app-1/approve')
      .send({ tenantCode: 'acme', tenantName: 'A', username: 'u', password: 'short' });
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/trials/:id/reject 写 reviewerUserId + note', async () => {
    injectedUser = { sub: 'u-rev', tenantCode: 't', username: 'admin' };
    const res = await request(app.getHttpServer())
      .post('/api/admin/trials/app-1/reject')
      .send({ note: '资质不足' });
    expect(res.status).toBe(201);
    expect(lastCall?.reviewerUserId).toBe('u-rev');
    expect(lastCall?.args[1]).toBe('资质不足');
  });

  it('admin 无认证 → 403 (controller 层)', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer())
      .post('/api/admin/trials/app-1/reject')
      .send({});
    expect([401, 403]).toContain(res.status);
  });
});
