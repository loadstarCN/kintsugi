import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { SdkDownloadController } from './sdk-download.controller';

describe('SdkDownloadController (e2e)', () => {
  let app: INestApplication;
  let tmpDir: string;
  let aarPath: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kintsugi-aar-test-'));
    aarPath = path.join(tmpDir, 'fake.aar');
    // 写一个 ~256 字节的假 AAR（够 length / Content-Length 验证）
    fs.writeFileSync(aarPath, Buffer.alloc(256, 0x42));

    const mod: TestingModule = await Test.createTestingModule({
      controllers: [SdkDownloadController],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env['KINTSUGI_ANDROID_AAR_PATH'];
  });
  afterEach(() => {
    delete process.env['KINTSUGI_ANDROID_AAR_PATH'];
  });

  it('GET /api/sdk/android/info 返回 schema 不论 AAR 是否就位', async () => {
    const res = await request(app.getHttpServer()).get('/api/sdk/android/info');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      version: expect.any(String),
      filename: 'kintsugi-release.aar',
      artifactId: 'kintsugi',
      groupId: 'com.kintsugi',
      minSdk: 24,
    });
    expect(typeof res.body.available).toBe('boolean');
  });

  it('AAR 存在 → info.available=true + sizeBytes', async () => {
    process.env['KINTSUGI_ANDROID_AAR_PATH'] = aarPath;
    const res = await request(app.getHttpServer()).get('/api/sdk/android/info');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.sizeBytes).toBe(256);
  });

  it('AAR 路径无效 → info.available=false + sizeBytes=null', async () => {
    process.env['KINTSUGI_ANDROID_AAR_PATH'] = '/nonexistent/path.aar';
    const res = await request(app.getHttpServer()).get('/api/sdk/android/info');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.sizeBytes).toBeNull();
  });

  it('GET /api/sdk/android/kintsugi.aar 在 env 指向的文件 → 200 + binary stream', async () => {
    process.env['KINTSUGI_ANDROID_AAR_PATH'] = aarPath;
    const res = await request(app.getHttpServer())
      .get('/api/sdk/android/kintsugi.aar')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/vnd.android.package-archive');
    expect(res.headers['content-disposition']).toMatch(/attachment;\s*filename="kintsugi-/);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect((res.body as Buffer).length).toBe(256);
  });

  it('AAR 不存在 → 404 with 帮助文本', async () => {
    process.env['KINTSUGI_ANDROID_AAR_PATH'] = '/dev/null/no-such-aar';
    const res = await request(app.getHttpServer()).get('/api/sdk/android/kintsugi.aar');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/未构建|gradle|assembleRelease/i);
  });

  it('两个 endpoint 都是 @Public（无 token 也通）', async () => {
    process.env['KINTSUGI_ANDROID_AAR_PATH'] = aarPath;
    const r1 = await request(app.getHttpServer()).get('/api/sdk/android/info');
    expect(r1.status).toBe(200);
    const r2 = await request(app.getHttpServer())
      .get('/api/sdk/android/kintsugi.aar')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r2.status).toBe(200);
  });
});
