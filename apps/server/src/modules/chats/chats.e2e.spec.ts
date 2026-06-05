/**
 * ChatsController e2e — controller is thin (single POST /ask).
 * Validates: ValidationPipe rejects bad payload, JWT user is plumbed
 * to ChatsService.ask, response shape passes through.
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
import { ChatsController } from './chats.controller';
import { ChatsService } from './chats.service';

let lastArgs: { user?: { tenantCode?: string | null; userId?: string | null }; question?: string; appCode?: string } = {};

const fakeService = {
  ask: async (args: { appCode: string; question: string; user?: { tenantCode?: string; userId?: string } }) => {
    lastArgs = args;
    return {
      sql: 'SELECT 1',
      explanation: 'noop',
      data: [{ a: 1 }],
      rowCount: 1,
    };
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

describe('ChatsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ChatsController],
      providers: [
        { provide: ChatsService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('POST /api/chats/ask plumbs user.tenantCode + sub into service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/chats/ask')
      .send({ appCode: 'app-x', question: 'how many rows?' });
    expect(res.status).toBe(201);
    expect(res.body.sql).toBe('SELECT 1');
    expect(lastArgs.user).toMatchObject({ tenantCode: 't-real', userId: 'u1' });
    expect(lastArgs.question).toBe('how many rows?');
    expect(lastArgs.appCode).toBe('app-x');
  });

  it('missing appCode → 400 (required)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/chats/ask')
      .send({ question: 'no app' });
    expect(res.status).toBe(400);
  });

  it('maxTables out of range → 400', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/chats/ask')
      .send({ appCode: 'app-x', question: 'x', maxTables: 999 });
    expect(res.status).toBe(400);
  });

  it('anonymous (no user) still calls service with no user ctx', async () => {
    injectedUser = null;
    lastArgs = {};
    const res = await request(app.getHttpServer())
      .post('/api/chats/ask')
      .send({ appCode: 'app-x', question: 'a' });
    expect(res.status).toBe(201);
    expect(lastArgs.user).toBeUndefined();
  });
});
