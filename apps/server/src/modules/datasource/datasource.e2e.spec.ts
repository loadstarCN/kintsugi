/**
 * DataSourceController e2e — 重点验证 controller 把 tenantCode 正确派生（JWT 或 HMAC ctx），
 * + 路由方法匹配 + DELETE 200 而不是 204。Service 行为（SSRF / encrypt / openAdapter）
 * 由 unit-level 测试和真实集成测试覆盖；这里 mock service 让 e2e 跑得快。
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
import { DataSourceController } from './datasource.controller';
import { DataSourceService } from './datasource.service';

let lastTenantCode: string | null = null;
const fakeService = {
  list: async (filter: { appCode?: string; tenantCode: string | null }) => {
    lastTenantCode = filter.tenantCode;
    return {
      data: [
        {
          id: 'ds-1',
          appCode: filter.appCode ?? 'app-x',
          dialect: 'postgres',
          displayName: 'main',
          host: 'rds.example',
          port: 5432,
          database: 'biz',
          schema: 'public',
          username: 'app',
          sslMode: 'disable',
          createdAt: new Date(),
          updatedAt: new Date(),
          lastScanAt: null,
          lastScanStatus: 'pending',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    };
  },
  get: async (id: string, tenantCode: string | null) => {
    lastTenantCode = tenantCode;
    if (id === 'ds-missing') {
      const { KintsugiError } = await import('@kintsugi/shared');
      throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    }
    return { id };
  },
  create: async (dto: { appCode: string; displayName: string }) => ({
    id: 'ds-new',
    ...dto,
  }),
  update: async (id: string) => ({ id, updated: true }),
  remove: async () => ({ ok: true }),
  testConnection: async () => ({ ok: true, version: '15.0' }),
};

let injectedUser: { sub: string; tenantCode: string; username: string } | null = null;

@Injectable()
class FakeUserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    req.user = injectedUser ?? undefined;
    return true;
  }
}

describe('DataSourceController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DataSourceController],
      providers: [
        { provide: DataSourceService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    const { KintsugiErrorFilter } = await import('../../common/kintsugi-error.filter');
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/datasources passes tenantCode from JWT', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/datasources?appCode=app-x');
    expect(res.status).toBe(200);
    expect(lastTenantCode).toBe('t-real');
    expect(res.body.data[0].id).toBe('ds-1');
  });

  it('GET /api/datasources without user → tenantCode null', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer()).get('/api/datasources');
    expect(res.status).toBe(200);
    expect(lastTenantCode).toBeNull();
  });

  it('GET /:id 404 mapped via KintsugiErrorFilter', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/datasources/ds-missing');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST /api/datasources rejects body lacking required fields → 400', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/datasources')
      .send({ appCode: 'app-x' }); // 缺 displayName/host/...
    expect(res.status).toBe(400);
  });

  it('DELETE /:id returns 200 (not 204) per @HttpCode(200)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).delete('/api/datasources/ds-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /:id/test returns connection probe result', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).post('/api/datasources/ds-1/test');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, version: '15.0' });
  });
});
