/**
 * 第一条 HTTP e2e 测试：起一个最小 Nest 测试 app（HealthController + 假 Prisma），
 * 用 supertest 打 GET /api/health 验证返回。
 *
 * 价值：以前所有测试都是 unit；controller / Nest pipe / global prefix / @Public
 * 装饰器这条链路从没有自动覆盖过，重构容易踩坑。这条 spec 是"e2e 框架在线"的
 * 烟雾测试，后面的端点照着这个模式扩。
 *
 * 不连真 DB，不连 Redis，不依赖 .env —— 单测进程独立。
 */

import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HealthController } from './health.controller';
import { PrismaService } from '../../prisma/prisma.service';

const fakePrisma = {
  $queryRaw: async () => [{ '?column?': 1 }],
  $disconnect: async () => undefined,
  $connect: async () => undefined,
  onModuleInit: async () => undefined,
  onModuleDestroy: async () => undefined,
};

describe('GET /api/health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: fakePrisma }],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok + metadata=connected', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', metadata: 'connected' });
  });

  it('404s on unmounted route', async () => {
    const res = await request(app.getHttpServer()).get('/api/this-does-not-exist');
    expect(res.status).toBe(404);
  });
});
