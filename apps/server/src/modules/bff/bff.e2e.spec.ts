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
import { BffController } from './bff.controller';
import { BffService } from './bff.service';

let lastArgs: Record<string, unknown> = {};

const fakeService = {
  list: async (appCode: string, opts: Record<string, unknown>, tenantCode: string | null) => {
    lastArgs = { op: 'list', appCode, opts, tenantCode };
    return {
      data: [{ id: 'b-1', appCode, scriptName: 'hello', type: 'ENDPOINT' }],
      total: 1,
      page: 1,
      pageSize: 50,
    };
  },
  getCode: async (id: string, tenantCode: string | null) => {
    lastArgs = { op: 'getCode', id, tenantCode };
    return { id, code: 'export default async () => ({ ok: true });' };
  },
  save: async (input: Record<string, unknown>, tenantCode: string | null) => {
    lastArgs = { op: 'save', input, tenantCode };
    return { id: 'b-new', ...input };
  },
  delete: async (id: string, tenantCode: string | null) => {
    lastArgs = { op: 'delete', id, tenantCode };
    return { ok: true };
  },
  executeEndpoint: async (input: Record<string, unknown>) => {
    lastArgs = { op: 'execute', input };
    return { ok: true, result: { greeting: 'hi' } };
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

describe('BffController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [BffController],
      providers: [
        { provide: BffService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('GET /api/bff lists with tenant ctx', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/bff?appCode=app-x');
    expect(res.status).toBe(200);
    expect(res.body.data[0].scriptName).toBe('hello');
    expect(lastArgs.tenantCode).toBe('t-real');
  });

  it('GET /api/bff/:id/code returns code + plumbs tenant', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/bff/b-9/code');
    expect(res.status).toBe(200);
    expect(res.body.code).toContain('export default');
    expect(lastArgs.id).toBe('b-9');
  });

  it('POST /api/bff rejects unknown type (class-validator @IsIn)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/bff')
      .send({
        appCode: 'app-x',
        scriptName: 'foo',
        type: 'NOT_A_TYPE',
        code: 'export default () => null;',
      });
    expect(res.status).toBe(400);
  });

  it('POST /api/bff happy path forwards optional boundDataset', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/bff')
      .send({
        appCode: 'app-x',
        scriptName: 'beforeCreate',
        type: 'BEFORE_HOOK',
        boundDataset: 'ds-1',
        code: 'export default async () => ({});',
      });
    expect(res.status).toBe(201);
    const input = lastArgs.input as Record<string, unknown>;
    expect(input.boundDataset).toBe('ds-1');
    expect(input.type).toBe('BEFORE_HOOK');
  });

  it('POST /api/bff/exec/:appCode/:scriptName forwards payload', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/bff/exec/app-x/hello')
      .send({ payload: { name: 'world' } });
    expect(res.status).toBe(201);
    const input = lastArgs.input as Record<string, unknown>;
    expect(input.appCode).toBe('app-x');
    expect(input.scriptName).toBe('hello');
    expect(input.payload).toEqual({ name: 'world' });
  });

  it('DELETE /api/bff/:id reaches service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).delete('/api/bff/b-1');
    expect(res.status).toBe(200);
    expect(lastArgs.op).toBe('delete');
  });
});
