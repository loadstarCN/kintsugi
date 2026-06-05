import 'reflect-metadata';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { TrialService } from './trial.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError } from '@kintsugi/shared';

interface FakeTrialApp {
  id: string;
  email: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  contactName: string;
  phone: string | null;
  company: string | null;
  useCase: string | null;
  approvedTenantCode: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

interface FakeTenant { tenantCode: string }

function makePrisma(seedApps: FakeTrialApp[] = [], seedTenants: FakeTenant[] = []): {
  prisma: PrismaService;
  state: { apps: FakeTrialApp[]; tenants: FakeTenant[] };
} {
  const apps = [...seedApps];
  const tenants = [...seedTenants];
  const prisma = {
    trialApplication: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { email: string; status: string } }) =>
        apps.find((a) => a.email === where.email && a.status === where.status) ?? null,
      ),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        apps.find((a) => a.id === where.id) ?? null,
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<FakeTrialApp> }) => {
        const row: FakeTrialApp = {
          id: `app-${apps.length + 1}`,
          email: data.email!,
          contactName: data.contactName!,
          phone: data.phone ?? null,
          company: data.company ?? null,
          useCase: data.useCase ?? null,
          status: 'PENDING',
          approvedTenantCode: null,
          reviewedBy: null,
          reviewNote: null,
          createdAt: new Date(),
          reviewedAt: null,
        };
        apps.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where?: { status?: string } } = {}) => {
        return where?.status ? apps.filter((a) => a.status === where.status) : apps;
      }),
      count: vi.fn().mockImplementation(async ({ where }: { where?: { status?: string } } = {}) => {
        return where?.status ? apps.filter((a) => a.status === where.status).length : apps.length;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<FakeTrialApp> }) => {
        const a = apps.find((x) => x.id === where.id);
        if (!a) throw new Error('not found');
        Object.assign(a, data);
        return a;
      }),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Partial<FakeTrialApp>;
        }) => {
          const a = apps.find((x) => x.id === where.id);
          if (!a) return { count: 0 };
          if (where.status !== undefined && a.status !== where.status) return { count: 0 };
          Object.assign(a, data);
          return { count: 1 };
        },
      ),
    },
    tenant: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { tenantCode: string } }) =>
        tenants.find((t) => t.tenantCode === where.tenantCode) ?? null,
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: { tenantCode: string } }) => {
        const t = { tenantCode: data.tenantCode };
        tenants.push(t);
        return t;
      }),
    },
    user: {
      create: vi.fn().mockImplementation(async () => ({ id: 'u-new' })),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  } as unknown as PrismaService;
  return { prisma, state: { apps, tenants } };
}

describe('TrialService.apply', () => {
  it('creates a PENDING application with normalized email/lowercase', async () => {
    const { prisma, state } = makePrisma();
    const svc = new TrialService(prisma);
    const r = await svc.apply({
      contactName: '  张三  ',
      email: 'Foo@Example.COM',
      company: 'Acme Co.',
      useCase: '需要做 BI',
    });
    expect(r.id).toBe('app-1');
    expect(state.apps[0]!.email).toBe('foo@example.com');
    expect(state.apps[0]!.contactName).toBe('张三');
    expect(state.apps[0]!.status).toBe('PENDING');
  });

  it('rejects duplicate PENDING by email (CONFLICT)', async () => {
    const { prisma } = makePrisma([
      {
        id: 'app-old',
        email: 'foo@example.com',
        status: 'PENDING',
        contactName: 'X',
        phone: null,
        company: null,
        useCase: null,
        approvedTenantCode: null,
        reviewedBy: null,
        reviewNote: null,
        createdAt: new Date(),
        reviewedAt: null,
      },
    ]);
    const svc = new TrialService(prisma);
    await expect(
      svc.apply({ contactName: '李四', email: 'foo@example.com' }),
    ).rejects.toThrow(KintsugiError);
  });

  it('two concurrent applies (same email) → DB-level P2002 catch returns CONFLICT', async () => {
    // 模拟 race：findFirst 都返 null，create 第二次抛 P2002
    let createCallCount = 0;
    const prisma = {
      trialApplication: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async () => {
          createCallCount++;
          if (createCallCount === 1) {
            return { id: 'app-1' };
          }
          const e = new Error('Unique constraint failed') as Error & { code: string };
          e.code = 'P2002';
          throw e;
        }),
      },
    } as unknown as PrismaService;
    const svc = new TrialService(prisma);
    const [r1, r2] = await Promise.allSettled([
      svc.apply({ contactName: 'A', email: 'race@example.com' }),
      svc.apply({ contactName: 'B', email: 'race@example.com' }),
    ]);
    expect(r1.status === 'fulfilled' || r2.status === 'fulfilled').toBe(true);
    const failed = [r1, r2].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(KintsugiError);
    expect((failed.reason as KintsugiError).code).toBe('CONFLICT');
  });

  it('allows new PENDING application after old one was REJECTED', async () => {
    const { prisma } = makePrisma([
      {
        id: 'app-old',
        email: 'foo@example.com',
        status: 'REJECTED',
        contactName: 'X',
        phone: null,
        company: null,
        useCase: null,
        approvedTenantCode: null,
        reviewedBy: 'u-admin',
        reviewNote: '不符合标准',
        createdAt: new Date(),
        reviewedAt: new Date(),
      },
    ]);
    const svc = new TrialService(prisma);
    const r = await svc.apply({ contactName: '李四', email: 'foo@example.com' });
    expect(r.id).toBe('app-2');
  });
});

describe('TrialService.approve', () => {
  beforeEach(() => {
    delete process.env['TRIAL_DAYS'];
    delete process.env['TRIAL_MAX_DATASOURCES'];
    delete process.env['TRIAL_MAX_DATASETS'];
    delete process.env['TRIAL_AI_CREDIT_INIT'];
  });
  afterEach(() => {
    delete process.env['TRIAL_DAYS'];
    delete process.env['TRIAL_MAX_DATASOURCES'];
    delete process.env['TRIAL_MAX_DATASETS'];
    delete process.env['TRIAL_AI_CREDIT_INIT'];
  });

  it('builds TRIAL tenant + admin user with default trial period (14 days)', async () => {
    const { prisma, state } = makePrisma([
      {
        id: 'app-1',
        email: 'foo@example.com',
        status: 'PENDING',
        contactName: '张三',
        phone: null,
        company: null,
        useCase: null,
        approvedTenantCode: null,
        reviewedBy: null,
        reviewNote: null,
        createdAt: new Date(),
        reviewedAt: null,
      },
    ]);
    const svc = new TrialService(prisma);
    const r = await svc.approve('app-1', {
      tenantCode: 'acme',
      tenantName: 'Acme Co.',
      username: 'zhangsan',
      password: 'temp-password-2026',
      reviewerUserId: 'u-admin',
    });
    expect(r.tenantCode).toBe('acme');
    expect(state.tenants).toHaveLength(1);
    // 验证 tenant.create 收到 TRIAL + quota + expiresAt
    const tenantCreate = (prisma.tenant.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(tenantCreate.data.edition).toBe('TRIAL');
    expect(tenantCreate.data.maxDataSources).toBe(1);
    expect(tenantCreate.data.maxDatasets).toBe(3);
    expect(tenantCreate.data.maxDailyLlmCalls).toBe(50);
    expect(Number(tenantCreate.data.aiCredits)).toBe(5);
    const trialMs = (tenantCreate.data.trialExpiresAt as Date).getTime() - Date.now();
    expect(trialMs).toBeGreaterThan(13 * 86400_000);
    expect(trialMs).toBeLessThan(15 * 86400_000);
    // application 标 APPROVED + approvedTenantCode 写
    expect(state.apps[0]!.status).toBe('APPROVED');
    expect(state.apps[0]!.approvedTenantCode).toBe('acme');
  });

  it('honors env overrides (TRIAL_DAYS / quotas / credit)', async () => {
    process.env['TRIAL_DAYS'] = '7';
    process.env['TRIAL_MAX_DATASOURCES'] = '2';
    process.env['TRIAL_MAX_DATASETS'] = '10';
    process.env['TRIAL_AI_CREDIT_INIT'] = '20';
    const { prisma } = makePrisma([
      {
        id: 'app-1', email: 'a@b.c', status: 'PENDING', contactName: 'X',
        phone: null, company: null, useCase: null,
        approvedTenantCode: null, reviewedBy: null, reviewNote: null,
        createdAt: new Date(), reviewedAt: null,
      },
    ]);
    const svc = new TrialService(prisma);
    await svc.approve('app-1', {
      tenantCode: 't', tenantName: 'T', username: 'u', password: 'temp-2026-pass-x',
      reviewerUserId: 'admin',
    });
    const tc = (prisma.tenant.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(tc.data.maxDataSources).toBe(2);
    expect(tc.data.maxDatasets).toBe(10);
    expect(Number(tc.data.aiCredits)).toBe(20);
    const trialMs = (tc.data.trialExpiresAt as Date).getTime() - Date.now();
    expect(trialMs).toBeGreaterThan(6 * 86400_000);
    expect(trialMs).toBeLessThan(8 * 86400_000);
  });

  it('refuses approve on already approved application', async () => {
    const { prisma } = makePrisma([
      {
        id: 'app-1', email: 'a@b', status: 'APPROVED', contactName: 'X',
        phone: null, company: null, useCase: null,
        approvedTenantCode: 'acme', reviewedBy: 'admin', reviewNote: null,
        createdAt: new Date(), reviewedAt: new Date(),
      },
    ]);
    const svc = new TrialService(prisma);
    await expect(svc.approve('app-1', {
      tenantCode: 'x', tenantName: 'X', username: 'u', password: 'temp-2026-pass-x',
      reviewerUserId: 'admin',
    })).rejects.toThrow(KintsugiError);
  });

  it('refuses if tenantCode already exists', async () => {
    const { prisma } = makePrisma(
      [{ id: 'app-1', email: 'a@b', status: 'PENDING', contactName: 'X',
         phone: null, company: null, useCase: null,
         approvedTenantCode: null, reviewedBy: null, reviewNote: null,
         createdAt: new Date(), reviewedAt: null }],
      [{ tenantCode: 'taken' }],
    );
    const svc = new TrialService(prisma);
    await expect(svc.approve('app-1', {
      tenantCode: 'taken', tenantName: 'X', username: 'u', password: 'temp-2026-pass-x',
      reviewerUserId: 'admin',
    })).rejects.toThrow(/already exists/);
  });

  it('two concurrent approve on same application → claim race lets only one win', async () => {
    const { prisma } = makePrisma([
      { id: 'app-race', email: 'a@b.c', status: 'PENDING', contactName: 'X',
        phone: null, company: null, useCase: null,
        approvedTenantCode: null, reviewedBy: null, reviewNote: null,
        createdAt: new Date(), reviewedAt: null },
    ]);
    const svc = new TrialService(prisma);
    const [r1, r2] = await Promise.allSettled([
      svc.approve('app-race', { tenantCode: 'tnt-a', tenantName: 'A', username: 'u1', password: 'temp-pass-2026-a', reviewerUserId: 'admin1' }),
      svc.approve('app-race', { tenantCode: 'tnt-b', tenantName: 'B', username: 'u2', password: 'temp-pass-2026-b', reviewerUserId: 'admin2' }),
    ]);
    const succeeded = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(1);
    // 失败那条 reject reason 包含 "concurrently approved"
    const failed = [r1, r2].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((failed.reason as Error).message).toMatch(/concurrently approved|already/);
  });
});

describe('TrialService.reject + isTrialExpired', () => {
  it('rejects PENDING with note', async () => {
    const { prisma, state } = makePrisma([
      { id: 'app-1', email: 'a@b', status: 'PENDING', contactName: 'X',
        phone: null, company: null, useCase: null,
        approvedTenantCode: null, reviewedBy: null, reviewNote: null,
        createdAt: new Date(), reviewedAt: null },
    ]);
    const svc = new TrialService(prisma);
    await svc.reject('app-1', 'u-admin', '资质不足');
    expect(state.apps[0]!.status).toBe('REJECTED');
    expect(state.apps[0]!.reviewNote).toBe('资质不足');
  });

  it('reject 已 APPROVED 的申请 → CONFLICT（不覆盖）', async () => {
    const { prisma, state } = makePrisma([
      { id: 'app-1', email: 'a@b', status: 'APPROVED', contactName: 'X',
        phone: null, company: null, useCase: null,
        approvedTenantCode: 'acme', reviewedBy: 'u-admin1', reviewNote: null,
        createdAt: new Date(), reviewedAt: null },
    ]);
    const svc = new TrialService(prisma);
    await expect(svc.reject('app-1', 'u-admin2')).rejects.toThrow(/already APPROVED/);
    // 不应被覆盖
    expect(state.apps[0]!.status).toBe('APPROVED');
    expect(state.apps[0]!.reviewedBy).toBe('u-admin1');
  });

  it('reject 不存在的申请 → NOT_FOUND', async () => {
    const { prisma } = makePrisma([]);
    const svc = new TrialService(prisma);
    await expect(svc.reject('does-not-exist', 'u-admin')).rejects.toThrow(/not found/);
  });

  it('isTrialExpired: PRO 永远不过期', () => {
    const svc = new TrialService({} as PrismaService);
    expect(svc.isTrialExpired({ edition: 'PRO', trialExpiresAt: new Date(0) })).toBe(false);
  });

  it('isTrialExpired: TRIAL + null = 不过期', () => {
    const svc = new TrialService({} as PrismaService);
    expect(svc.isTrialExpired({ edition: 'TRIAL', trialExpiresAt: null })).toBe(false);
  });

  it('isTrialExpired: TRIAL + 过去时间 = 过期', () => {
    const svc = new TrialService({} as PrismaService);
    expect(svc.isTrialExpired({ edition: 'TRIAL', trialExpiresAt: new Date(Date.now() - 1000) })).toBe(true);
  });

  it('isTrialExpired: TRIAL + 未来时间 = 不过期', () => {
    const svc = new TrialService({} as PrismaService);
    expect(svc.isTrialExpired({ edition: 'TRIAL', trialExpiresAt: new Date(Date.now() + 86400_000) })).toBe(false);
  });
});
