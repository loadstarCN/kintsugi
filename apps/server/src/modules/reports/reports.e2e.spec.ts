import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

const fakeService = {
  ask: async (args: { appCode: string; question: string }) => ({
    sql: `SELECT count(*) FROM x WHERE app='${args.appCode}'`,
    explanation: 'count',
    chart: { type: 'bar', xField: 'k', yField: 'v' },
    data: [{ k: 'a', v: 1 }],
  }),
};

describe('ReportsController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: fakeService }],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('POST /api/apps/:appCode/reports/ask returns sql + chart spec', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/reports/ask')
      .send({ question: '本月销售按产品分布' });
    expect(res.status).toBe(201);
    expect(res.body.sql).toContain("WHERE app='app-x'");
    expect(res.body.chart).toEqual({ type: 'bar', xField: 'k', yField: 'v' });
  });

  it('missing question → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/reports/ask')
      .send({});
    expect(res.status).toBe(400);
  });
});
