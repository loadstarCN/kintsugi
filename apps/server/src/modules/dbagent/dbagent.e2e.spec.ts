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
import { DbAgentController } from './dbagent.controller';
import { DbAgentService } from './dbagent.service';

let lastCall: { op: string; args: unknown[]; tenantCode: string | null } | null = null;

const fakeService = {
  scan: async (dataSourceId: string, opts: unknown, tenantCode: string | null) => {
    lastCall = { op: 'scan', args: [dataSourceId, opts], tenantCode };
    return 'job-1';
  },
  getJob: async (jobId: string, tenantCode: string | null) => {
    lastCall = { op: 'getJob', args: [jobId], tenantCode };
    return { id: jobId, status: 'succeeded' };
  },
  sync: async (dataSourceId: string, tenantCode: string | null) => {
    lastCall = { op: 'sync', args: [dataSourceId], tenantCode };
    return { jobId: 'job-2' };
  },
  getSyncDiff: async (currentJobId: string, priorJobId: string | null, tenantCode: string | null) => {
    lastCall = { op: 'syncDiff', args: [currentJobId, priorJobId], tenantCode };
    return { added: [], removed: [], changed: [] };
  },
  listJobsForDataSource: async (
    dataSourceId: string,
    opts: unknown,
    tenantCode: string | null,
  ) => {
    lastCall = { op: 'listJobs', args: [dataSourceId, opts], tenantCode };
    return { data: [], total: 0, page: 1, pageSize: 50 };
  },
};

let injectedUser: { sub: string; tenantCode: string; username: string } | null = null;

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    if (injectedUser) req.user = injectedUser;
    return true;
  }
}

describe('DbAgentController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DbAgentController],
      providers: [
        { provide: DbAgentService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('POST /dbagent/datasources/:id/scan 返回 { jobId } + tenantCode 从 JWT 取', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/dbagent/datasources/ds-1/scan')
      .send({ sampleRowsPerTable: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ jobId: 'job-1' });
    expect(lastCall?.op).toBe('scan');
    expect(lastCall?.args).toEqual(['ds-1', { sampleRowsPerTable: 5 }]);
    expect(lastCall?.tenantCode).toBe('t-real');
  });

  it('scan 上界（>50）→ 400 ValidationPipe 拒绝（防止整库采样把上游 OOM）', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/dbagent/datasources/ds-1/scan')
      .send({ sampleRowsPerTable: 999 });
    expect(res.status).toBe(400);
  });

  it('scan 下界（<0）→ 400', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/dbagent/datasources/ds-1/scan')
      .send({ sampleRowsPerTable: -1 });
    expect(res.status).toBe(400);
  });

  it('scan body 完全省略也合法（sampleRowsPerTable 是 optional）', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer())
      .post('/api/dbagent/datasources/ds-1/scan')
      .send({});
    expect(res.status).toBe(201);
    expect(lastCall?.args).toEqual(['ds-1', {}]);
  });

  it('GET /dbagent/jobs/:jobId — 读路径不要求 @Permission', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    const res = await request(app.getHttpServer()).get('/api/dbagent/jobs/job-42');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('succeeded');
  });

  it('GET /dbagent/sync/diff 必传 currentJobId，priorJobId 可省', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    await request(app.getHttpServer())
      .get('/api/dbagent/sync/diff?currentJobId=jc&priorJobId=jp')
      .expect(200);
    expect(lastCall?.args).toEqual(['jc', 'jp']);

    await request(app.getHttpServer())
      .get('/api/dbagent/sync/diff?currentJobId=jc')
      .expect(200);
    expect(lastCall?.args).toEqual(['jc', null]);
  });

  it('listJobs 把 page/pageSize string 解析为 number 透传', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't', username: 'a' };
    await request(app.getHttpServer())
      .get('/api/dbagent/datasources/ds-1/jobs?page=2&pageSize=10');
    expect(lastCall?.args).toEqual(['ds-1', { page: 2, pageSize: 10 }]);
  });
});
