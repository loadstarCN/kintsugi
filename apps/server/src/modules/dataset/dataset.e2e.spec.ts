/**
 * DatasetController e2e — list / get / rls-policy / updateDo / softDelete / from-scan。
 * Service mock-out（DBAgent / 真 schemaSnapshot 路径太重，单独 unit 覆盖）。
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
import { DatasetController } from './dataset.controller';
import { DatasetService } from './dataset.service';

let lastTenantCode: string | null = null;
const fakeService = {
  list: async (appCode: string, _page: unknown, tenantCode: string | null) => {
    lastTenantCode = tenantCode;
    return {
      data: [{ datasetCode: 'ds-1', appCode, dataSourceId: 'src-1', tableName: 't1', alias: 't1', version: 1, updatedAt: new Date() }],
      total: 1, page: 1, pageSize: 50,
    };
  },
  get: async (datasetCode: string, tenantCode: string | null) => {
    lastTenantCode = tenantCode;
    if (datasetCode === 'ds-missing') {
      const { KintsugiError } = await import('@kintsugi/shared');
      throw new KintsugiError('NOT_FOUND', `Dataset ${datasetCode} not found`);
    }
    return {
      datasetCode,
      appCode: 'app-x',
      dataSourceId: 'src-1',
      tableName: 't1',
      alias: 't1',
      schemaName: null,
      version: 1,
      doJson: { version: 1, fields: [], relations: [] },
      updatedAt: new Date(),
    };
  },
  getRlsPolicy: async (datasetCode: string) => ({
    sql: `-- ALTER TABLE "t1" ENABLE ROW LEVEL SECURITY;`,
    dropSql: '-- DROP POLICY IF EXISTS ...',
    policies: [],
    warnings: [],
    dialect: 'postgres',
    table: 't1',
    schema: null,
    datasetCode,
  }),
  updateDoJson: async (
    datasetCode: string,
    _doJson: unknown,
    _by: string | undefined,
    _tc: string | null,
    expectedVersion: number | undefined,
  ) => {
    if (expectedVersion !== undefined && expectedVersion !== 1) {
      const { KintsugiError } = await import('@kintsugi/shared');
      throw new KintsugiError('BLOCKED_BY_CONCURRENT_EDIT', `current 1 ≠ expected ${expectedVersion}`);
    }
    return { version: 2 };
  },
  softDelete: async () => ({ ok: true }),
  ingestFromScan: async (args: { appCode: string; jobId: string }) => ({
    created: 3,
    updated: 0,
    datasets: [
      { datasetCode: 'ds-a', tableName: 'a', alias: 'a' },
      { datasetCode: 'ds-b', tableName: 'b', alias: 'b' },
      { datasetCode: 'ds-c', tableName: 'c', alias: 'c' },
    ],
  }),
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

describe('DatasetController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DatasetController],
      providers: [
        { provide: DatasetService, useValue: fakeService },
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

  it('list passes tenantCode from JWT', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/datasets?appCode=app-x');
    expect(res.status).toBe(200);
    expect(lastTenantCode).toBe('t-real');
  });

  it('GET /:datasetCode → 200 / NOT_FOUND mapped to 404', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    expect((await request(app.getHttpServer()).get('/api/datasets/ds-1')).status).toBe(200);
    const miss = await request(app.getHttpServer()).get('/api/datasets/ds-missing');
    expect(miss.status).toBe(404);
    expect(miss.body.code).toBe('NOT_FOUND');
  });

  it('GET /:datasetCode/rls-policy returns SQL', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/datasets/ds-1/rls-policy');
    expect(res.status).toBe(200);
    expect(res.body.sql).toMatch(/ROW LEVEL SECURITY/);
    expect(res.body.dialect).toBe('postgres');
  });

  it('PATCH /:datasetCode/do with mismatched expectedVersion → 409', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .patch('/api/datasets/ds-1/do')
      .send({ doJson: { version: 1 }, expectedVersion: 99 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BLOCKED_BY_CONCURRENT_EDIT');
  });

  it('PATCH /:datasetCode/do with correct version → 200 + version+1', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .patch('/api/datasets/ds-1/do')
      .send({ doJson: { version: 1 }, expectedVersion: 1 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it('POST /from-scan/:jobId returns batch summary', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer())
      .post('/api/datasets/from-scan/job-1')
      .send({ appCode: 'app-x' });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(res.body.datasets).toHaveLength(3);
  });

  it('DELETE /:datasetCode → 200 + { ok: true }', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'alice' };
    const res = await request(app.getHttpServer()).delete('/api/datasets/ds-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
