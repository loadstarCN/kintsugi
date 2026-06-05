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
import { CustomSqlController } from './custom-sql.controller';
import { CustomSqlService } from './custom-sql.service';

let lastExecArgs: { sqlCode?: string; opts?: { actor?: string; tenantCode?: string | null; userId?: string | null } } = {};

const fakeService = {
  list: async (appCode: string) => ({
    data: [{ sqlCode: 'sq-1', sqlName: 'demo', appCode, content: 'SELECT 1', paramsSchema: null, lastSubmittedAt: new Date(), createdAt: new Date() }],
    total: 1, page: 1, pageSize: 50,
  }),
  get: async (sqlCode: string) => ({ sqlCode, sqlName: 'demo', appCode: 'app-x', content: 'SELECT 1', paramsSchema: null, lastSubmittedAt: new Date(), createdAt: new Date() }),
  save: async (input: { sqlName: string; content: string }) => ({ sqlCode: 'sq-new', ...input }),
  update: async (sqlCode: string, input: Record<string, unknown>) => ({ sqlCode, ...input }),
  remove: async (_sqlCode: string) => ({ ok: true }),
  validate: async (content: string) => ({
    riskLevel: /\bdrop\b/i.test(content) ? 'critical' : 'low',
    placeholders: [...content.matchAll(/#\{(\w+)\}/g)].map((m) => m[1]),
    valid: true,
  }),
  execute: async (sqlCode: string, _params: unknown, opts: { actor: string; tenantCode: string | null; userId: string | null }) => {
    lastExecArgs = { sqlCode, opts };
    return { data: [{ x: 1 }], rowCount: 1, riskLevel: 'low' };
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

describe('CustomSqlController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [CustomSqlController],
      providers: [
        { provide: CustomSqlService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('GET /api/sql lists', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/sql?appCode=app-x');
    expect(res.status).toBe(200);
    expect(res.body.data[0].sqlCode).toBe('sq-1');
  });

  it('POST /api/sql/validate echoes risk + placeholders', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/sql/validate')
      .send({ content: 'SELECT * FROM goods WHERE id = #{id}' });
    expect(res.status).toBe(201);
    expect(res.body.riskLevel).toBe('low');
    expect(res.body.placeholders).toEqual(['id']);
  });

  it('execute under JWT → actor=human passed to service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/sql/sq-1/execute')
      .send({ params: { x: 1 } });
    expect(res.status).toBe(201);
    expect(lastExecArgs.opts?.actor).toBe('human');
    expect(lastExecArgs.opts?.tenantCode).toBe('t-real');
    expect(lastExecArgs.opts?.userId).toBe('u1');
  });

  it('execute under no user (HMAC路径模拟) → actor=ai', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer())
      .post('/api/sql/sq-1/execute')
      .send({});
    expect(res.status).toBe(201);
    expect(lastExecArgs.opts?.actor).toBe('ai');
  });

  it('body.actor in payload is rejected (forbidNonWhitelisted)', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer())
      .post('/api/sql/sq-1/execute')
      .send({ actor: 'human' });
    expect(res.status).toBe(400);
  });
});
