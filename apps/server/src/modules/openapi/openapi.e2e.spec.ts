import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OpenapiController, PlatformOpenapiController } from './openapi.controller';
import { OpenapiService } from './openapi.service';

const fakeService = {
  buildForApp: async (appCode: string) => ({
    openapi: '3.0.3',
    info: { title: `Kintsugi App API · ${appCode}`, version: '1.0' },
    paths: {
      [`/api/apps/${appCode}/ds/goods/filter`]: {
        post: { operationId: 'goods_filter', responses: { '200': { description: 'ok' } } },
      },
    },
  }),
};

describe('OpenapiController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [OpenapiController, PlatformOpenapiController],
      providers: [{ provide: OpenapiService, useValue: fakeService }],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => await app.close());

  it('GET /api/apps/:appCode/openapi.json returns spec for that app', async () => {
    const res = await request(app.getHttpServer()).get('/api/apps/app-x/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/api/apps/app-x/ds/goods/filter']).toBeDefined();
  });

  it('GET /api/openapi.platform.json returns the platform-stable spec', async () => {
    const res = await request(app.getHttpServer()).get('/api/openapi.platform.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toBeDefined();
    expect(res.body.info).toBeDefined();
  });

  it('rejects appCode with shell metachars (DOS / cmd injection paranoia)', async () => {
    const res = await request(app.getHttpServer()).get('/api/apps/app%3Bx/openapi.json');
    expect(res.status).toBe(400);
  });

  it('rejects appCode containing spaces', async () => {
    const res = await request(app.getHttpServer()).get('/api/apps/app%20x/openapi.json');
    expect(res.status).toBe(400);
  });

  it('rejects appCode longer than 64 chars', async () => {
    const longCode = 'a'.repeat(65);
    const res = await request(app.getHttpServer()).get(`/api/apps/${longCode}/openapi.json`);
    expect(res.status).toBe(400);
  });

  it('GET /api/apps/:appCode/docs serves Swagger UI HTML; appCode is HTML-escaped', async () => {
    const res = await request(app.getHttpServer()).get('/api/apps/app-x/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain("url: '/api/apps/app-x/openapi.json'");
    expect(res.text).toContain('swagger-ui-bundle.js');
  });

  it('docs html: appCode 不能含 < / > / "（防 XSS via path）', async () => {
    // appCode regex 已经卡住了；这里是双重保险，确认到不了 controller body
    const res = await request(app.getHttpServer()).get('/api/apps/%3Cscript%3E/docs');
    expect(res.status).toBe(400);
  });
});
