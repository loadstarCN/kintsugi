/**
 * ApplicationController e2e：list/get/create + 跨租户保护。
 *
 * 关键不变量：
 *  - create 时 tenantCode **强制从 JWT 取**，body 不接受任何 tenantCode 字段
 *  - list 已登录用户忽略 query.tenantCode，强按自己 tenant
 *  - 没 user.tenantCode 时 create → 403
 *
 * 用 fake AuthGuard 模拟 JWT 注入到 req.user，绕过真 JWT verify。
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
import { ApplicationController } from './application.controller';
import { ApplicationService } from './application.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';

interface AppRow {
  appCode: string;
  tenantCode: string;
  name: string;
  description: string | null;
  environment: 'production' | 'daily' | 'development';
  createdAt: Date;
  updatedAt: Date;
}

class FakePrisma {
  apps: AppRow[] = [];

  application = {
    findMany: async ({ where, take, skip }: { where?: { tenantCode?: string }; take?: number; skip?: number }) => {
      let rows = this.apps;
      if (where?.tenantCode) rows = rows.filter((r) => r.tenantCode === where.tenantCode);
      return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
    },
    count: async ({ where }: { where?: { tenantCode?: string } }) => {
      if (!where?.tenantCode) return this.apps.length;
      return this.apps.filter((r) => r.tenantCode === where.tenantCode).length;
    },
    findUnique: async ({ where }: { where: { appCode: string } }) =>
      this.apps.find((r) => r.appCode === where.appCode) ?? null,
    create: async ({ data }: { data: Omit<AppRow, 'createdAt' | 'updatedAt'> }) => {
      if (this.apps.some((r) => r.appCode === data.appCode)) {
        const err = new Error('unique') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row: AppRow = { ...data, createdAt: new Date(), updatedAt: new Date() };
      this.apps.push(row);
      return row;
    },
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

describe('ApplicationController (e2e)', () => {
  let app: INestApplication;
  let prisma: FakePrisma;

  beforeAll(async () => {
    prisma = new FakePrisma();
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ApplicationController],
      providers: [
        ApplicationService,
        { provide: PrismaService, useValue: prisma },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('create requires user.tenantCode → 403 without it', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer())
      .post('/api/applications')
      .send({ appCode: 'app-1', name: 'A' });
    expect(res.status).toBe(403);
  });

  it('extra body field tenantCode → 400 (forbidNonWhitelisted)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/applications')
      .send({ appCode: 'app-evil', name: 'A', tenantCode: 't-fake' });
    expect(res.status).toBe(400);
    // 没创建出来 — 防 body 注入 tenant 的关键保证
    expect(prisma.apps.find((a) => a.appCode === 'app-evil')).toBeUndefined();
  });

  it('create without spurious fields → 201, tenantCode from JWT', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/applications')
      .send({ appCode: 'app-2', name: 'B', description: 'b desc' });
    expect(res.status).toBe(201);
    expect(res.body.tenantCode).toBe('t-real');
  });

  it('list scopes to user.tenantCode, ignoring query.tenantCode', async () => {
    prisma.apps.push({
      appCode: 'app-other',
      tenantCode: 't-other',
      name: 'X',
      description: null,
      environment: 'development',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/applications?tenantCode=t-other');
    expect(res.status).toBe(200);
    // 上一条只创了 app-2 在 t-real 下；query.tenantCode=t-other 应被忽略
    expect(res.body.data.every((a: AppRow) => a.tenantCode === 't-real')).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('appCode 含非法字符 → 400 from class-validator', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/applications')
      .send({ appCode: 'app with space!', name: 'X' });
    expect(res.status).toBe(400);
  });

  it('GET /:appCode returns row when it exists', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/applications/app-2');
    expect(res.status).toBe(200);
    expect(res.body.appCode).toBe('app-2');
  });
});
