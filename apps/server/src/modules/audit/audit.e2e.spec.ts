/**
 * AuditController e2e。重点：tenantCode 隔离 + filter 透传 + CSV stream。
 * 关键安全不变量：JWT 路径用 user.tenantCode；HMAC 路径用 accessKeyCtx.tenantCode；
 * 二者都缺则 tenantCode=null —— whereOf 的实现会变成"返回全部"，所以在没 user
 * 的场景必须由上层 guard 挡住。这里用 fake guard 注入 user 模拟生产路径。
 */

import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Injectable,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

interface AuditRow {
  id: string;
  tenantCode: string;
  appCode: string | null;
  userId: string | null;
  accessKey: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  traceparent: string | null;
  createdAt: Date;
  afterJson: unknown;
}

class FakePrisma {
  rows: AuditRow[] = [
    { id: 'a1', tenantCode: 't1', appCode: 'app-x', userId: 'u1', accessKey: null, action: 'POST /api/x', targetType: 'http', targetId: null, traceparent: null, createdAt: new Date('2026-05-01T00:00:00Z'), afterJson: { foo: 1 } },
    { id: 'a2', tenantCode: 't1', appCode: 'app-x', userId: null, accessKey: 'ak_abc', action: 'DELETE /api/y', targetType: 'http:hmac', targetId: null, traceparent: null, createdAt: new Date('2026-05-02T00:00:00Z'), afterJson: null },
    { id: 'a3', tenantCode: 't2', appCode: 'app-z', userId: 'u9', accessKey: null, action: 'POST /api/x', targetType: 'http', targetId: null, traceparent: null, createdAt: new Date('2026-05-03T00:00:00Z'), afterJson: null },
  ];

  auditLog = {
    findMany: async ({ where, take, skip, orderBy, cursor }: {
      where?: { tenantCode?: string; appCode?: string; userId?: string; accessKey?: string; action?: { contains: string } };
      take?: number;
      skip?: number;
      orderBy?: unknown;
      cursor?: { id: string };
    }) => {
      let rows = this.rows;
      if (where?.tenantCode) rows = rows.filter((r) => r.tenantCode === where.tenantCode);
      if (where?.appCode) rows = rows.filter((r) => r.appCode === where.appCode);
      if (where?.userId) rows = rows.filter((r) => r.userId === where.userId);
      if (where?.accessKey) rows = rows.filter((r) => r.accessKey === where.accessKey);
      if (where?.action) {
        const sub = where.action.contains.toLowerCase();
        rows = rows.filter((r) => r.action.toLowerCase().includes(sub));
      }
      // 排序：默认 desc by createdAt
      rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (cursor) {
        const i = rows.findIndex((r) => r.id === cursor.id);
        if (i >= 0) rows = rows.slice(i + 1); // skip:1 后 cursor 之后的
      }
      void orderBy;
      return rows.slice(skip ?? 0, (skip ?? 0) + (take ?? 50));
    },
    count: async ({ where }: { where?: { tenantCode?: string; appCode?: string } }) => {
      let rows = this.rows;
      if (where?.tenantCode) rows = rows.filter((r) => r.tenantCode === where.tenantCode);
      if (where?.appCode) rows = rows.filter((r) => r.appCode === where.appCode);
      return rows.length;
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

describe('AuditController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        AuditService,
        { provide: PrismaService, useClass: FakePrisma },
        { provide: APP_GUARD, useClass: FakeUserGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('list scopes to user.tenantCode (only t1 rows)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't1', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.every((r: AuditRow) => r.tenantCode === 't1')).toBe(true);
  });

  it('?accessKey=ak_abc filters to that key only (incident-response flow)', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't1', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/audit-logs?accessKey=ak_abc');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('a2');
  });

  it('?action=delete does case-insensitive substring match', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't1', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/audit-logs?action=delete');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toMatch(/DELETE/);
  });

  it('csv export streams header + rows for tenant scope', async () => {
    injectedUser = { sub: 'u1', tenantCode: 't1', username: 'alice' };
    const res = await request(app.getHttpServer()).get('/api/audit-logs/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/audit-logs\.csv/);
    const text = res.text;
    // 第一行是 header
    expect(text.split('\n')[0]).toMatch(/^id,tenantCode,appCode,userId,accessKey/);
    // t2 的行不能在
    expect(text).not.toContain('app-z');
  });
});
