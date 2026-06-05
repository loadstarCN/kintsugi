import 'reflect-metadata';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { LlmBudgetService } from './llm-budget.service';
import type { PrismaService } from '../prisma/prisma.service';

interface FakePrisma {
  aiCreditTx: { aggregate: ReturnType<typeof vi.fn> };
}

function makeService(spent: number): { svc: LlmBudgetService; prisma: FakePrisma } {
  const prisma: FakePrisma = {
    aiCreditTx: {
      aggregate: vi.fn(async () => ({ _sum: { delta: -spent } })),
    },
  };
  const svc = new LlmBudgetService(prisma as unknown as PrismaService);
  return { svc, prisma };
}

describe('LlmBudgetService.checkAfterDeduct', () => {
  beforeEach(() => {
    delete process.env['LLM_BUDGET_YUAN_PER_HOUR'];
    delete process.env['LLM_BUDGET_THROTTLE_AFTER_BREACHES'];
  });
  afterEach(() => {
    delete process.env['LLM_BUDGET_YUAN_PER_HOUR'];
    delete process.env['LLM_BUDGET_THROTTLE_AFTER_BREACHES'];
  });

  it('env 未设 → no-op，不查 DB', async () => {
    const { svc, prisma } = makeService(100);
    await svc.checkAfterDeduct('t-1');
    expect(prisma.aiCreditTx.aggregate).not.toHaveBeenCalled();
  });

  it('env=0 → no-op', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '0';
    const { svc, prisma } = makeService(100);
    await svc.checkAfterDeduct('t-1');
    expect(prisma.aiCreditTx.aggregate).not.toHaveBeenCalled();
  });

  it('env="oops" 非法 → no-op', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = 'oops';
    const { svc, prisma } = makeService(100);
    await svc.checkAfterDeduct('t-1');
    expect(prisma.aiCreditTx.aggregate).not.toHaveBeenCalled();
  });

  it('低于阈值 → 查 DB 但不 warn / 不计 counter', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc, prisma } = makeService(5);
    await svc.checkAfterDeduct('t-1');
    expect(prisma.aiCreditTx.aggregate).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('超阈值 → emit warn 含 tenant + spent + limit', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    const { svc } = makeService(15);
    const warn = vi.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    await svc.checkAfterDeduct('t-busy');
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = (warn.mock.calls[0]![0] as string);
    expect(msg).toContain('tenant=t-busy');
    expect(msg).toContain('spend=15.0000元');
    expect(msg).toContain('limit=10.0000元');
    warn.mockRestore();
  });

  it('同一 tenant 同一小时 warn 上限默认 3 条（去抖防日志风暴）', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    const { svc } = makeService(15);
    const warn = vi.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 10; i++) await svc.checkAfterDeduct('t-1');
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('LLM_BUDGET_THROTTLE_AFTER_BREACHES 可调', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    process.env['LLM_BUDGET_THROTTLE_AFTER_BREACHES'] = '1';
    const { svc } = makeService(15);
    const warn = vi.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 5; i++) await svc.checkAfterDeduct('t-1');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('DB 查询抛错 → 自吞，不让 LLM 热路径炸', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    const prisma = {
      aiCreditTx: { aggregate: vi.fn(async () => { throw new Error('db down'); }) },
    } as unknown as PrismaService;
    const svc = new LlmBudgetService(prisma);
    await expect(svc.checkAfterDeduct('t-1')).resolves.toBeUndefined();
  });

  it('aggregate 返回 _sum.delta=null（无消耗记录）→ spent=0，不 warn', async () => {
    process.env['LLM_BUDGET_YUAN_PER_HOUR'] = '10';
    const prisma = {
      aiCreditTx: { aggregate: vi.fn(async () => ({ _sum: { delta: null } })) },
    } as unknown as PrismaService;
    const svc = new LlmBudgetService(prisma);
    const warn = vi.spyOn(svc['logger'], 'warn').mockImplementation(() => undefined);
    await svc.checkAfterDeduct('t-1');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
