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
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';

let lastArgs: Record<string, unknown> = {};

const fakeService = {
  list: async (appCode: string, opts: Record<string, unknown>, tenantCode: string | null) => {
    lastArgs = { op: 'list', appCode, opts, tenantCode };
    return { data: [{ id: 'p-1', name: 'demo', appCode }], total: 1, page: 1, pageSize: 50 };
  },
  get: async (id: string, tenantCode: string | null) => {
    lastArgs = { op: 'get', id, tenantCode };
    return { id, name: 'demo', appCode: 'app-x', sourceFiles: { 'index.tsx': '' } };
  },
  generate: async (input: Record<string, unknown>, tenantCode: string | null) => {
    lastArgs = { op: 'generate', input, tenantCode };
    return { id: 'p-new', ...input };
  },
  saveSource: async (id: string, files: Record<string, string>, tenantCode: string | null) => {
    lastArgs = { op: 'saveSource', id, files, tenantCode };
    return { ok: true };
  },
  publish: async (id: string, tenantCode: string | null) => {
    lastArgs = { op: 'publish', id, tenantCode };
    return { ok: true, publishedAt: new Date().toISOString() };
  },
  regenerate: async (id: string, input: Record<string, unknown>, tenantCode: string | null) => {
    lastArgs = { op: 'regenerate', id, input, tenantCode };
    return { id, regenerated: true };
  },
  delete: async (id: string, tenantCode: string | null) => {
    lastArgs = { op: 'delete', id, tenantCode };
    return { ok: true };
  },
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

describe('PagesController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PagesController],
      providers: [
        { provide: PagesService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('GET /api/pages plumbs tenantCode from JWT', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/pages?appCode=app-x&page=2&pageSize=10');
    expect(res.status).toBe(200);
    expect(lastArgs.tenantCode).toBe('t-real');
    expect(lastArgs.opts).toMatchObject({ page: 2, pageSize: 10 });
  });

  it('GET /api/pages/:id passes id + tenantCode', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/pages/p-42');
    expect(res.status).toBe(200);
    expect(lastArgs.op).toBe('get');
    expect(lastArgs.id).toBe('p-42');
    expect(lastArgs.tenantCode).toBe('t-real');
  });

  it('POST /api/apps/:appCode/pages/generate validates prompt is required', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/pages/generate')
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/apps/:appCode/pages/generate happy path forwards imageUrls', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/pages/generate')
      .send({ prompt: '订单列表', imageUrls: ['https://example.com/m.png'] });
    expect(res.status).toBe(201);
    expect((lastArgs.input as Record<string, unknown>).imageUrls).toEqual(['https://example.com/m.png']);
    expect((lastArgs.input as Record<string, unknown>).appCode).toBe('app-x');
  });

  it('PUT /api/pages/:id/source rejects non-object sourceFiles', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .put('/api/pages/p-1/source')
      .send({ sourceFiles: 'not an object' });
    expect(res.status).toBe(400);
  });

  it('POST /api/pages/:id/publish reaches service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).post('/api/pages/p-1/publish');
    expect(res.status).toBe(201);
    expect(lastArgs.op).toBe('publish');
  });

  it('DELETE /api/pages/:id reaches service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).delete('/api/pages/p-1');
    expect(res.status).toBe(200);
    expect(lastArgs.op).toBe('delete');
  });
});
