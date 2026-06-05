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
import { InstantApiController } from './instant-api.controller';
import { InstantApiService } from './instant-api.service';

interface CapturedCall {
  op: string;
  appCode: string;
  datasetCode: string;
  args: unknown[];
  user: { userId?: string; tenantCode?: string; roles?: string[] };
}

let lastCall: CapturedCall | null = null;

const fakeService = {
  filter: async (appCode: string, datasetCode: string, body: unknown, user: CapturedCall['user']) => {
    lastCall = { op: 'filter', appCode, datasetCode, args: [body], user };
    return { data: [{ id: '1' }], total: 1 };
  },
  getOne: async (appCode: string, datasetCode: string, id: string, user: CapturedCall['user']) => {
    lastCall = { op: 'getOne', appCode, datasetCode, args: [id], user };
    return { id, x: 1 };
  },
  create: async (appCode: string, datasetCode: string, body: unknown, user: CapturedCall['user']) => {
    lastCall = { op: 'create', appCode, datasetCode, args: [body], user };
    return { id: 'new', ...(body as object) };
  },
  update: async (appCode: string, datasetCode: string, id: string, body: unknown, user: CapturedCall['user']) => {
    lastCall = { op: 'update', appCode, datasetCode, args: [id, body], user };
    return { id, ...(body as object) };
  },
  remove: async (appCode: string, datasetCode: string, id: string, user: CapturedCall['user']) => {
    lastCall = { op: 'remove', appCode, datasetCode, args: [id], user };
    return { ok: true };
  },
  batchCreate: async (appCode: string, datasetCode: string, rows: unknown[], user: CapturedCall['user']) => {
    lastCall = { op: 'batchCreate', appCode, datasetCode, args: [rows], user };
    return { inserted: rows.length };
  },
  aggregate: async (appCode: string, datasetCode: string, spec: unknown, _params: unknown, user: CapturedCall['user']) => {
    lastCall = { op: 'aggregate', appCode, datasetCode, args: [spec], user };
    return [{ count: 5 }];
  },
  getSelectOptions: async (appCode: string, datasetCode: string, field: string, user: CapturedCall['user']) => {
    lastCall = { op: 'options', appCode, datasetCode, args: [field], user };
    return [{ value: 'a', label: 'A' }];
  },
};

let injectedUser: { sub: string; tenantCode: string; username: string; roles?: string[] } | null = null;
let injectedHmacCtx: { appCode: string; tenantCode: string; createdBy: string | null; boundUserId: string | null } | null = null;

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser; accessKeyCtx?: typeof injectedHmacCtx }>();
    if (injectedUser) req.user = injectedUser;
    if (injectedHmacCtx) req.accessKeyCtx = injectedHmacCtx;
    return true;
  }
}

describe('InstantApiController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [InstantApiController],
      providers: [
        { provide: InstantApiService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('JWT 路径：filter 把 userId/tenantCode/roles 传给 service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a', roles: ['ops'] };
    injectedHmacCtx = null;
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/ds/goods/filter')
      .send({ where: [{ field: 'name', op: 'eq', value: 'a' }] });
    expect(res.status).toBe(201);
    expect(lastCall?.op).toBe('filter');
    expect(lastCall?.user).toEqual({ userId: 'u1', tenantCode: 't-real', roles: ['ops'] });
  });

  it('HMAC 路径无 boundUserId：只 tenantCode，无 userId', async () => {
    injectedUser = null;
    injectedHmacCtx = { appCode: 'app-x', tenantCode: 't-hmac', createdBy: null, boundUserId: null };
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/ds/goods/filter')
      .send({});
    expect(res.status).toBe(201);
    expect(lastCall?.user).toEqual({ tenantCode: 't-hmac' });
  });

  it('HMAC 路径有 boundUserId：把 userId 一并下传，让 scope=self RLS 生效', async () => {
    injectedUser = null;
    injectedHmacCtx = { appCode: 'app-x', tenantCode: 't', createdBy: null, boundUserId: 'u-bound' };
    await request(app.getHttpServer())
      .get('/api/apps/app-x/ds/goods/some-id')
      .expect(200);
    expect(lastCall?.user).toEqual({ tenantCode: 't', userId: 'u-bound' });
  });

  it('PATCH /:id 把 id + body 都传给 service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    injectedHmacCtx = null;
    const res = await request(app.getHttpServer())
      .patch('/api/apps/app-x/ds/goods/abc')
      .send({ name: 'updated' });
    expect(res.status).toBe(200);
    expect(lastCall?.op).toBe('update');
    expect(lastCall?.args).toEqual(['abc', { name: 'updated' }]);
  });

  it('DELETE /:id reaches service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    await request(app.getHttpServer()).delete('/api/apps/app-x/ds/goods/xyz').expect(200);
    expect(lastCall?.op).toBe('remove');
    expect(lastCall?.args).toEqual(['xyz']);
  });

  it('batchCreate forwards rows[]', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/ds/goods/batchCreate')
      .send({ rows: [{ a: 1 }, { a: 2 }] });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(2);
    expect(lastCall?.args).toEqual([[{ a: 1 }, { a: 2 }]]);
  });

  it('aggregate plumbs metrics spec', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const spec = { metrics: [{ op: 'count', alias: 'n' }], groupBy: ['kind'] };
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/ds/goods/aggregate')
      .send(spec);
    expect(res.status).toBe(201);
    expect(lastCall?.op).toBe('aggregate');
    expect(lastCall?.args).toEqual([spec]);
  });

  it('GET options/:field forwards field', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/apps/app-x/ds/goods/options/category');
    expect(res.status).toBe(200);
    expect(lastCall?.args).toEqual(['category']);
  });
});
