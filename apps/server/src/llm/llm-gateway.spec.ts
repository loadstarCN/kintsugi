/**
 * LlmGateway 行为（reserve-then-settle 模式）：
 *  - tenantCode=null → 直接透传，不预扣、不写 AiCreditTx
 *  - tenantCode + 余额够（≥ minBalance + reserve）→ 预扣 → 调 LLM → settle 差额
 *  - 余额不够（atomic UPDATE 0 行）→ 抛 INSUFFICIENT_CREDIT，不调 LLM
 *  - LLM 抛错 → 退还预扣
 *  - LLM 不返 usage（罕见）→ settle 用 actual=0，全额退还预扣
 *  - 扣费 DB 失败 → warn-only，不影响 LLM 响应返回
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { LlmGateway } from './llm-gateway.service';
import type { LlmProvider, LlmResponse } from '@kintsugi/llm';
import { KintsugiError } from '@kintsugi/shared';

interface MockPrisma {
  tenant: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  aiCreditTx: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

function makePrisma(balance: number, transactionFails = false): MockPrisma {
  // 模拟 atomic UPDATE WHERE balance >= threshold：参数化的 reserve 检查
  let currentBalance = balance;
  return {
    tenant: {
      findUnique: vi.fn().mockImplementation(async () => ({ aiCredits: currentBalance })),
      update: vi.fn().mockImplementation(async ({ data }: { data: { aiCredits: { decrement?: number; increment?: number } } }) => {
        if (data.aiCredits.decrement !== undefined) currentBalance -= data.aiCredits.decrement;
        if (data.aiCredits.increment !== undefined) currentBalance += data.aiCredits.increment;
        return {};
      }),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { aiCredits: { gte: number } };
          data: { aiCredits: { decrement: number } };
        }) => {
          if (currentBalance < where.aiCredits.gte) return { count: 0 };
          currentBalance -= data.aiCredits.decrement;
          return { count: 1 };
        },
      ),
    },
    aiCreditTx: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: transactionFails
      ? vi.fn().mockRejectedValue(new Error('db down'))
      : vi.fn().mockImplementation(async (ops: unknown[]) => ops),
  };
}

function makeProvider(usage?: LlmResponse['usage']): LlmProvider {
  return {
    id: 'deepseek' as const,
    model: 'test-model',
    complete: vi.fn().mockResolvedValue({
      content: 'response',
      ...(usage ? { usage } : {}),
    } satisfies LlmResponse),
  };
}

describe('LlmGateway', () => {
  beforeEach(() => {
    delete process.env['AI_CREDIT_MIN_BALANCE'];
    delete process.env['AI_CREDIT_RESERVE_PER_CALL'];
    process.env['AI_CREDIT_PRICE_PROMPT_PER_1K'] = '0.001';
    process.env['AI_CREDIT_PRICE_COMPLETION_PER_1K'] = '0.004';
  });

  it('passes through when tenantCode is null (no reserve, no deduct)', async () => {
    const prisma = makePrisma(10);
    const provider = makeProvider({ promptTokens: 100, completionTokens: 50 });
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    const r = await gw.complete(null, 'chat', { messages: [] });
    expect(r.content).toBe('response');
    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reserve + settle when tenant has credit + usage reported', async () => {
    const prisma = makePrisma(10);
    const provider = makeProvider({ promptTokens: 1000, completionTokens: 500 });
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    await gw.complete('t1', 'chat', { messages: [] });
    // reserve 0.10 元（默认）走 updateMany；settle 走 $transaction
    expect(prisma.tenant.updateMany).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('refuses with INSUFFICIENT_CREDIT when balance < minBalance + reserve', async () => {
    process.env['AI_CREDIT_RESERVE_PER_CALL'] = '0.10';
    // balance=0.05 < 0+0.10 → updateMany 0 行 → 拒
    const prisma = makePrisma(0.05);
    const provider = makeProvider();
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    await expect(gw.complete('t1', 'chat', { messages: [] })).rejects.toThrow(KintsugiError);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('refunds reserve when provider throws', async () => {
    const prisma = makePrisma(10);
    const provider = {
      id: 'deepseek' as const,
      model: 'm',
      complete: vi.fn().mockRejectedValue(new Error('upstream')),
    };
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    await expect(gw.complete('t1', 'chat', { messages: [] })).rejects.toThrow('upstream');
    // 一次 reserve（updateMany），一次 refund（$transaction）
    expect(prisma.tenant.updateMany).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('settles with actual=0 when usage absent (refunds reserve)', async () => {
    const prisma = makePrisma(10);
    const provider = makeProvider(); // no usage
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    await gw.complete('t1', 'chat', { messages: [] });
    // settle 仍然跑（即使 usage 缺失），actual=0 → 退全部 reserve
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('absorbs DB settle failure without breaking the response', async () => {
    const prisma = makePrisma(10, /* transactionFails */ true);
    const provider = makeProvider({ promptTokens: 100, completionTokens: 50 });
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    const r = await gw.complete('t1', 'chat', { messages: [] });
    expect(r.content).toBe('response'); // 仍正常返回
  });

  it('atomic conditional decrement serializes concurrent reserves', async () => {
    // balance=0.15, reserve=0.10 → 第一个过，第二个 0.05 < 0.10 → 拒
    process.env['AI_CREDIT_RESERVE_PER_CALL'] = '0.10';
    const prisma = makePrisma(0.15);
    const provider = makeProvider({ promptTokens: 100, completionTokens: 50 });
    const gw = new LlmGateway(provider, prisma as never, { checkAfterDeduct: async () => undefined } as never);
    const [r1, r2] = await Promise.allSettled([
      gw.complete('t1', 'chat', { messages: [] }),
      gw.complete('t1', 'chat', { messages: [] }),
    ]);
    const succeeded = [r1, r2].filter((r) => r.status === 'fulfilled').length;
    const failed = [r1, r2].filter((r) => r.status === 'rejected').length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
  });
});
