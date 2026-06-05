import 'reflect-metadata';
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiErrorFilter } from '../../common/kintsugi-error.filter';

interface ApplicationRow { appCode: string; tenantCode: string }
interface UserRow { id: string; tenantCode: string }
interface RoleRow { id: string; tenantCode: string }

const apps: ApplicationRow[] = [];
const users: UserRow[] = [];
const roles: RoleRow[] = [];

const fakePrisma = {
  application: {
    findUnique: async ({ where }: { where: { appCode: string } }) =>
      apps.find((a) => a.appCode === where.appCode) ?? null,
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      users.find((u) => u.id === where.id) ?? null,
  },
  role: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      roles.find((r) => r.id === where.id) ?? null,
  },
};

let lastSvcCall: { op: string; args: unknown[] } | null = null;

const fakeRbac = {
  listRoles: async (tenantCode: string, appCode?: string) => {
    lastSvcCall = { op: 'listRoles', args: [tenantCode, appCode] };
    return [{ id: 'r-1', name: 'admin', tenantCode }];
  },
  createRole: async (input: unknown) => {
    lastSvcCall = { op: 'createRole', args: [input] };
    return { id: 'r-new' };
  },
  assignRole: async (userId: string, roleId: string) => {
    lastSvcCall = { op: 'assignRole', args: [userId, roleId] };
    return { ok: true };
  },
  // 注意：不写 lastSvcCall —— grantsOfUser 是 createRole/assignRole 内部的预检
  // 助手，会污染 "service 真正收到了什么" 的断言。这里给 caller 一个 *:*:* 兜底，
  // 让权限衰减守卫直通；想测衰减本身见 permission-contract.spec.ts + privilege
  // attenuation 单独的 e2e（在 rbac.controller.ts 顶部注释里有手测脚本）。
  grantsOfUser: async (_userId: string) => ['*:*:*'],
};

let injectedUser: { sub: string; tenantCode: string; username: string; roles?: string[] } | null = null;

@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: typeof injectedUser }>();
    if (injectedUser) req.user = injectedUser;
    return true;
  }
}

describe('RbacController (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [
        { provide: RbacService, useValue: fakeRbac },
        { provide: PrismaService, useValue: fakePrisma },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new KintsugiErrorFilter());
    await app.init();
  });
  afterAll(async () => await app.close());

  beforeEach(() => {
    apps.length = 0;
    users.length = 0;
    roles.length = 0;
    lastSvcCall = null;
    injectedUser = { sub: 'u-admin', tenantCode: 't-real', username: 'a' };
  });

  it('GET /rbac/roles 用 JWT.tenantCode 而非 query', async () => {
    const res = await request(app.getHttpServer()).get('/api/rbac/roles?appCode=app-x');
    expect(res.status).toBe(200);
    expect(lastSvcCall).toEqual({ op: 'listRoles', args: ['t-real', 'app-x'] });
  });

  it('未登录 → 403（rbac requires authenticated user context）', async () => {
    injectedUser = null;
    const res = await request(app.getHttpServer()).get('/api/rbac/roles');
    expect([401, 403]).toContain(res.status);
  });

  it('createRole 拒绝跨租户的 appCode', async () => {
    apps.push({ appCode: 'app-other', tenantCode: 't-other' });
    const res = await request(app.getHttpServer())
      .post('/api/rbac/roles')
      .send({ appCode: 'app-other', name: 'admin', grants: ['*:*:*'] });
    expect([400, 404]).toContain(res.status);
    expect(lastSvcCall).toBeNull();
  });

  it('createRole 同租户 appCode → service 收到 server 端推导的 tenantCode', async () => {
    apps.push({ appCode: 'app-mine', tenantCode: 't-real' });
    const res = await request(app.getHttpServer())
      .post('/api/rbac/roles')
      .send({ appCode: 'app-mine', name: 'ops', grants: ['app-mine:dataset:read'] });
    expect(res.status).toBe(201);
    const arg = (lastSvcCall?.args[0] ?? {}) as { tenantCode: string; appCode: string; name: string };
    expect(arg.tenantCode).toBe('t-real');
    expect(arg.appCode).toBe('app-mine');
    expect(arg.name).toBe('ops');
  });

  it('createRole 缺 grants[] → 400 (class-validator)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/rbac/roles')
      .send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  it('assign 拒绝把跨租户 user 接到本租户 role', async () => {
    users.push({ id: 'u-foreign', tenantCode: 't-other' });
    roles.push({ id: 'r-mine', tenantCode: 't-real' });
    const res = await request(app.getHttpServer())
      .post('/api/rbac/assign')
      .send({ userId: 'u-foreign', roleId: 'r-mine' });
    expect([400, 404]).toContain(res.status);
    expect(lastSvcCall).toBeNull();
  });

  it('assign 同租户 → service 收到 (userId, roleId)', async () => {
    users.push({ id: 'u-1', tenantCode: 't-real' });
    roles.push({ id: 'r-1', tenantCode: 't-real' });
    const res = await request(app.getHttpServer())
      .post('/api/rbac/assign')
      .send({ userId: 'u-1', roleId: 'r-1' });
    expect(res.status).toBe(201);
    expect(lastSvcCall).toEqual({ op: 'assignRole', args: ['u-1', 'r-1'] });
  });

  describe('privilege attenuation', () => {
    // 把 caller 的 grants 收紧 + 给 role 一个含 *:admin:write 的 permissions —— 模拟
    // tenant-admin 想通过角色绑定把平台级权限外授的越权场景。
    const limitedRbac = {
      ...fakeRbac,
      grantsOfUser: async (_userId: string) => ['*:datasource:write'],
    };

    let app2: INestApplication;
    beforeAll(async () => {
      const mod = await Test.createTestingModule({
        controllers: [RbacController],
        providers: [
          { provide: RbacService, useValue: limitedRbac },
          {
            provide: PrismaService,
            useValue: {
              ...fakePrisma,
              role: {
                findUnique: async ({ where }: { where: { id: string } }) => {
                  if (where.id === 'r-platform') {
                    return {
                      id: 'r-platform',
                      tenantCode: 't-real',
                      permissions: { grants: ['*:admin:write'] },
                    };
                  }
                  return roles.find((r) => r.id === where.id) ?? null;
                },
              },
            },
          },
          { provide: APP_GUARD, useClass: FakeAuthGuard },
        ],
      }).compile();
      app2 = mod.createNestApplication();
      app2.setGlobalPrefix('api');
      app2.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app2.useGlobalFilters(new KintsugiErrorFilter());
      await app2.init();
    });
    afterAll(async () => await app2.close());

    it('createRole 拒绝 caller 没有的 grant（platform tier）', async () => {
      const res = await request(app2.getHttpServer())
        .post('/api/rbac/roles')
        .send({ name: 'sneaky', grants: ['*:admin:write'] });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('*:admin:write'),
        details: { tier: 'platform' },
      });
    });

    it('createRole 拒绝 caller 没有的 grant（tenant tier）', async () => {
      const res = await request(app2.getHttpServer())
        .post('/api/rbac/roles')
        .send({ name: 'analyst', grants: ['*:audit:read'] });
      expect(res.status).toBe(403);
      expect(res.body.details).toMatchObject({ tier: 'tenant' });
    });

    it('createRole 通过 caller 持有的 grant', async () => {
      const res = await request(app2.getHttpServer())
        .post('/api/rbac/roles')
        .send({ name: 'ds-writer', grants: ['*:datasource:write'] });
      expect(res.status).toBe(201);
    });

    it('assignRole 拒绝把含越权 grant 的角色绑给任何人', async () => {
      // 注：fakePrisma.user 用的还是顶层 users[]，不是这里的 inline 重写。
      users.push({ id: 'u-victim', tenantCode: 't-real' });
      const res = await request(app2.getHttpServer())
        .post('/api/rbac/assign')
        .send({ userId: 'u-victim', roleId: 'r-platform' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        code: 'FORBIDDEN',
        details: { grant: '*:admin:write', tier: 'platform' },
      });
    });
  });

  it('GET /users/:userId/grants 拒绝跨租户查别人 grants', async () => {
    users.push({ id: 'u-foreign', tenantCode: 't-other' });
    const res = await request(app.getHttpServer()).get('/api/rbac/users/u-foreign/grants');
    expect([400, 404]).toContain(res.status);
    expect(lastSvcCall).toBeNull();
  });
});
