/**
 * BillingService — 单元测试。
 *
 * 不连真 DB；mock prisma + mail 直接 verify 业务流。重点：
 *  · 用 fake prisma 跟踪 upgradeRequest / tenant 状态
 *  · 验证 approveUpgrade 计算 newExpires 的"提前续费"逻辑
 *  · 验证 plan 不存在 / duration 不在 plan 允许列表 → 拒
 *  · 验证 reject 走原子 claim 路径，已 APPROVED 的不可再 reject
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import { KintsugiError } from '@kintsugi/shared';

interface UpgradeRow {
  id: string;
  tenantCode: string;
  requestedPlanCode: string;
  requestedDurationMonths: number;
  contactName: string;
  contactEmail: string;
  phone: string | null;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  approvedExpiresAt: Date | null;
  createdAt: Date;
}

interface TenantRow {
  tenantCode: string;
  edition: 'TRIAL' | 'PRO' | 'ENTERPRISE';
  currentPlanCode: string | null;
  subscriptionExpiresAt: Date | null;
  trialExpiresAt: Date | null;
  autoRenew: boolean;
  aiCredits: number;
  maxDataSources: number | null;
  maxDatasets: number | null;
  maxDailyLlmCalls: number | null;
}

function makePrisma(initialTenant?: Partial<TenantRow>): {
  prisma: PrismaService;
  state: { upgrades: UpgradeRow[]; tenant: TenantRow };
  mail: MailService;
  mailCalls: Array<{ template: string; to: string | string[]; variables: unknown }>;
} {
  const tenant: TenantRow = {
    tenantCode: 't-acme',
    edition: 'TRIAL',
    currentPlanCode: null,
    subscriptionExpiresAt: null,
    trialExpiresAt: null,
    autoRenew: false,
    aiCredits: 0,
    maxDataSources: 1,
    maxDatasets: 3,
    maxDailyLlmCalls: 50,
    ...initialTenant,
  };
  const upgrades: UpgradeRow[] = [];

  const prisma = {
    upgradeRequest: {
      create: vi.fn(async ({ data, select }: { data: Partial<UpgradeRow>; select?: Record<string, boolean> }) => {
        const row: UpgradeRow = {
          id: `req-${upgrades.length + 1}`,
          tenantCode: data.tenantCode!,
          requestedPlanCode: data.requestedPlanCode!,
          requestedDurationMonths: data.requestedDurationMonths!,
          contactName: data.contactName!,
          contactEmail: data.contactEmail!,
          phone: data.phone ?? null,
          note: data.note ?? null,
          status: 'PENDING',
          reviewedBy: null,
          reviewNote: null,
          reviewedAt: null,
          approvedExpiresAt: null,
          createdAt: new Date(),
        };
        upgrades.push(row);
        return select ? { id: row.id } : row;
      }),
      findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = upgrades.find((u) => u.id === where.id);
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = (row as unknown as Record<string, unknown>)[k];
        return out;
      }),
      findMany: vi.fn(async ({ where }: { where?: { status?: string } } = {}) => {
        return where?.status ? upgrades.filter((u) => u.status === where.status) : upgrades;
      }),
      count: vi.fn(async ({ where }: { where?: { status?: string } } = {}) => {
        return where?.status ? upgrades.filter((u) => u.status === where.status).length : upgrades.length;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Partial<UpgradeRow>;
        }) => {
          const row = upgrades.find((u) => u.id === where.id);
          if (!row) return { count: 0 };
          if (where.status !== undefined && row.status !== where.status) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    tenant: {
      findUnique: vi.fn(async ({ where, select }: { where: { tenantCode: string }; select?: Record<string, boolean> }) => {
        if (where.tenantCode !== tenant.tenantCode) return null;
        if (!select) return tenant;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = (tenant as unknown as Record<string, unknown>)[k];
        return out;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { tenantCode: string }; data: Record<string, unknown> }) => {
          if (where.tenantCode !== tenant.tenantCode) throw new Error('not found');
          // 处理 increment
          for (const k of Object.keys(data)) {
            const v = data[k];
            if (typeof v === 'object' && v !== null && 'increment' in (v as object)) {
              const cur = (tenant as unknown as Record<string, unknown>)[k] as number;
              (tenant as unknown as Record<string, unknown>)[k] = cur + (v as { increment: number }).increment;
            } else {
              (tenant as unknown as Record<string, unknown>)[k] = v;
            }
          }
          return tenant;
        },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  } as unknown as PrismaService;

  const mailCalls: Array<{ template: string; to: string | string[]; variables: unknown }> = [];
  const mail: MailService = {
    sendTemplate: vi.fn(async (input: { template: string; to: string | string[]; variables?: unknown }) => {
      mailCalls.push({ template: input.template, to: input.to, variables: input.variables });
      return 't-x';
    }),
  } as unknown as MailService;

  return { prisma, state: { upgrades, tenant }, mail, mailCalls };
}

describe('BillingService.listPlans', () => {
  it('returns the hardcoded plans', () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    const plans = svc.listPlans();
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const codes = plans.map((p) => p.code);
    expect(codes).toContain('pro_monthly');
    expect(codes).toContain('pro_yearly');
    expect(codes).toContain('enterprise_yearly');
  });
});

describe('BillingService.requestUpgrade', () => {
  beforeEach(() => {
    delete process.env['MAILPILOT_BASE_URL'];
    delete process.env['MAILPILOT_API_KEY'];
  });

  it('creates a PENDING UpgradeRequest + sends email to applicant', async () => {
    const { prisma, mail, state, mailCalls } = makePrisma();
    const svc = new BillingService(prisma, mail);
    const r = await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_yearly',
      requestedDurationMonths: 12,
      contactName: '张三',
      contactEmail: 'zhangsan@example.com',
    });
    expect(r.id).toBe('req-1');
    expect(r.totalYuan).toBe(700 * 12); // pro_yearly: 700 元/月
    expect(state.upgrades[0]!.status).toBe('PENDING');
    expect(mailCalls).toHaveLength(1);
    expect(mailCalls[0]!.template).toBe('kintsugi_upgrade_requested');
  });

  it('rejects unknown plan code', async () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    await expect(
      svc.requestUpgrade({
        tenantCode: 't-acme',
        requestedPlanCode: 'nope',
        requestedDurationMonths: 12,
        contactName: 'X',
        contactEmail: 'x@y',
      }),
    ).rejects.toThrow(/unknown plan/);
  });

  it('rejects duration not allowed by the plan', async () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    // pro_yearly 只允许 12 / 24 个月，不接受 1
    await expect(
      svc.requestUpgrade({
        tenantCode: 't-acme',
        requestedPlanCode: 'pro_yearly',
        requestedDurationMonths: 1,
        contactName: 'X',
        contactEmail: 'x@y',
      }),
    ).rejects.toThrow(/does not support duration/);
  });
});

describe('BillingService.approveUpgrade', () => {
  it('TRIAL → PRO：edition / plan / expires / aiCredits / quota 全更新', async () => {
    const { prisma, mail, state, mailCalls } = makePrisma({ edition: 'TRIAL', aiCredits: 5 });
    const svc = new BillingService(prisma, mail);
    await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_yearly',
      requestedDurationMonths: 12,
      contactName: '张三',
      contactEmail: 'zhangsan@example.com',
    });
    const r = await svc.approveUpgrade('req-1', { reviewerUserId: 'u-admin' });
    expect(state.tenant.edition).toBe('PRO');
    expect(state.tenant.currentPlanCode).toBe('pro_yearly');
    expect(state.tenant.subscriptionExpiresAt).toBeInstanceOf(Date);
    expect(state.tenant.maxDataSources).toBe(5); // pro plan quota
    expect(state.tenant.aiCredits).toBe(5 + 120 * 12); // initial 5 + plan.monthlyAiCreditYuan × 12
    expect(state.upgrades[0]!.status).toBe('APPROVED');
    expect(r.aiCreditAdded).toBe(120 * 12);
    expect(mailCalls.some((c) => c.template === 'kintsugi_upgrade_approved')).toBe(true);
  });

  it('提前续费：从 max(now, currentExpiresAt) 起算', async () => {
    const futureExpires = new Date(Date.now() + 30 * 86400_000); // 30 天后
    const { prisma, mail, state } = makePrisma({
      edition: 'PRO',
      currentPlanCode: 'pro_yearly',
      subscriptionExpiresAt: futureExpires,
    });
    const svc = new BillingService(prisma, mail);
    await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_yearly',
      requestedDurationMonths: 12,
      contactName: '张三',
      contactEmail: 'zhangsan@example.com',
    });
    await svc.approveUpgrade('req-1', { reviewerUserId: 'u-admin' });
    // 新 expires 应该是 futureExpires + 12*30 天，而不是 now + 12*30 天
    const expected = futureExpires.getTime() + 12 * 30 * 86400_000;
    const actual = state.tenant.subscriptionExpiresAt!.getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(2_000); // 2 秒内
  });

  it('已 APPROVED 的请求不可再 approve（CONFLICT）', async () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_monthly',
      requestedDurationMonths: 1,
      contactName: 'X',
      contactEmail: 'x@y',
    });
    await svc.approveUpgrade('req-1', { reviewerUserId: 'u-admin' });
    await expect(svc.approveUpgrade('req-1', { reviewerUserId: 'u-admin' })).rejects.toThrow(KintsugiError);
  });
});

describe('BillingService.rejectUpgrade', () => {
  it('rejects PENDING + sends email', async () => {
    const { prisma, mail, state, mailCalls } = makePrisma();
    const svc = new BillingService(prisma, mail);
    await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_monthly',
      requestedDurationMonths: 1,
      contactName: '李四',
      contactEmail: 'lisi@example.com',
    });
    await svc.rejectUpgrade('req-1', 'u-admin', '付款未到账');
    expect(state.upgrades[0]!.status).toBe('REJECTED');
    expect(state.upgrades[0]!.reviewNote).toBe('付款未到账');
    expect(mailCalls.some((c) => c.template === 'kintsugi_upgrade_rejected')).toBe(true);
  });

  it('已 APPROVED 不可再 reject', async () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    await svc.requestUpgrade({
      tenantCode: 't-acme',
      requestedPlanCode: 'pro_monthly',
      requestedDurationMonths: 1,
      contactName: 'X',
      contactEmail: 'x@y',
    });
    await svc.approveUpgrade('req-1', { reviewerUserId: 'u-admin' });
    await expect(svc.rejectUpgrade('req-1', 'u-admin')).rejects.toThrow(/already APPROVED/);
  });
});

describe('BillingService.isSubscriptionExpired', () => {
  it('TRIAL 不算 — 走 trial 那条路径', () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    expect(svc.isSubscriptionExpired({ edition: 'TRIAL', subscriptionExpiresAt: new Date(0) })).toBe(false);
  });
  it('PRO + null → 不过期', () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    expect(svc.isSubscriptionExpired({ edition: 'PRO', subscriptionExpiresAt: null })).toBe(false);
  });
  it('PRO + 过去 → 过期', () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    expect(svc.isSubscriptionExpired({ edition: 'PRO', subscriptionExpiresAt: new Date(Date.now() - 1000) })).toBe(true);
  });
  it('ENTERPRISE + 未来 → 不过期', () => {
    const { prisma, mail } = makePrisma();
    const svc = new BillingService(prisma, mail);
    expect(svc.isSubscriptionExpired({ edition: 'ENTERPRISE', subscriptionExpiresAt: new Date(Date.now() + 86400_000) })).toBe(false);
  });
});
