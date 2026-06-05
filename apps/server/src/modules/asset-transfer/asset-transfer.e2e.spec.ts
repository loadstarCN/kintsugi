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
import { AssetTransferController } from './asset-transfer.controller';
import { AssetTransferService } from './asset-transfer.service';

let lastExport: { appCode?: string; tenantCode?: string | null } = {};
let lastImport: { appCode?: string; size?: number; opts?: { overwrite: boolean }; tenantCode?: string | null } = {};

const fakeService = {
  exportBundle: async (appCode: string, tenantCode: string | null) => {
    lastExport = { appCode, tenantCode };
    return {
      zip: Buffer.from(`PK-zip-bytes-for-${appCode}`),
      filename: `${appCode}-中文-bundle.zip`,
    };
  },
  importBundle: async (appCode: string, buf: Buffer, opts: { overwrite: boolean }, tenantCode: string | null) => {
    lastImport = { appCode, size: buf.length, opts, tenantCode };
    return { ok: true, datasets: 3, pages: 5, overwrite: opts.overwrite };
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

describe('AssetTransferController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [AssetTransferController],
      providers: [
        { provide: AssetTransferService, useValue: fakeService },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });
  afterAll(async () => await app.close());

  it('GET /transfer/export 走 RFC 5987：UTF-8 filename* + ASCII fallback', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/apps/app-x/transfer/export')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const cd = res.headers['content-disposition'] as string;
    expect(cd).toContain("filename*=UTF-8''");
    // ASCII fallback：原中文被替成 _，不应能注入 CRLF/引号
    expect(cd).toMatch(/filename="[\x20-\x7E]+"/);
    expect(cd).not.toMatch(/[\r\n]/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).toString()).toBe('PK-zip-bytes-for-app-x');
  });

  it('POST /transfer/import 把 multipart file buffer + overwrite 透传给 service', async () => {
    const fakeZip = Buffer.from('PK\x03\x04 fake zip body');
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/transfer/import?overwrite=true')
      .attach('file', fakeZip, 'bundle.zip');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, overwrite: true });
    expect(lastImport.appCode).toBe('app-x');
    expect(lastImport.size).toBe(fakeZip.length);
    expect(lastImport.opts).toEqual({ overwrite: true });
  });

  it('overwrite query 缺省 → opts.overwrite=false（防默认覆盖陷阱）', async () => {
    lastImport = {};
    await request(app.getHttpServer())
      .post('/api/apps/app-x/transfer/import')
      .attach('file', Buffer.from('zz'), 'b.zip');
    expect(lastImport.opts).toEqual({ overwrite: false });
  });

  it('multipart 缺 file 字段 → 201 + error 字符串，service 不被调', async () => {
    lastImport = {};
    const res = await request(app.getHttpServer())
      .post('/api/apps/app-x/transfer/import')
      .field('foo', 'bar');
    expect(res.status).toBe(201);
    expect(res.body.error).toContain('multipart "file" field required');
    expect(lastImport.size).toBeUndefined();
  });

  it('export: JWT 路径把 tenantCode 透传给 service（防跨租户拷整应用）', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    await request(app.getHttpServer())
      .get('/api/apps/app-x/transfer/export')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(lastExport.tenantCode).toBe('t-real');
  });

  it('import: JWT 路径把 tenantCode 透传给 service', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't-real', username: 'a' };
    await request(app.getHttpServer())
      .post('/api/apps/app-x/transfer/import')
      .attach('file', Buffer.from('zz'), 'b.zip');
    expect(lastImport.tenantCode).toBe('t-real');
  });

  it('未登录路径 → tenantCode=null（service 内部按 access-key ctx 兜底）', async () => {
    injectedUser = null;
    await request(app.getHttpServer())
      .get('/api/apps/app-x/transfer/export')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(lastExport.tenantCode).toBeNull();
  });
});
