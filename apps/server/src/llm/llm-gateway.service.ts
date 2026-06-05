import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmProvider, LlmRequest, LlmResponse } from '@kintsugi/llm';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER } from './llm.tokens';
import { LlmBudgetService } from './llm-budget.service';

/**
 * 在 LLM provider 之上加一层"租户计费 + 配额"网关。
 *
 *  - 调用前：检查 Tenant.aiCredits ≥ minBalance（默认 0），不足直接拒（INSUFFICIENT_CREDIT）
 *  - 调用后：按 token 数算 cost，原子地 (Tenant.aiCredits -= cost) + 写 AiCreditTx
 *  - LlmGateway 自己的度量在 llm.module.ts 那个 wrapper 里已经埋（call/token counter）
 *
 * 价格计算：
 *  - 默认 prompt 0.001 元/1K tokens、completion 0.004 元/1K tokens（OpenAI gpt-4o-mini 量级）
 *  - 通过 env `AI_CREDIT_PRICE_PROMPT_PER_1K` / `AI_CREDIT_PRICE_COMPLETION_PER_1K` 调
 *  - 没拿到 usage 时按 fallback 估算（promptChars/4 + completionChars/4）—— 极端兜底
 *
 * 调用方应当传 `tenantCode`；传 null 表示"系统级调用"（如 dbagent 自检），跳过计费。
 *
 * 仅迁移到 ChatsService 等高频路径；其他 service 继续用 LLM_PROVIDER 直接调可以，
 * 但请尽快走这条 gateway。
 */
export type AiCreditReason = 'chat' | 'report' | 'page_gen' | 'dbagent' | 'mcp' | 'other';

@Injectable()
export class LlmGateway {
  private readonly logger = new Logger(LlmGateway.name);
  private readonly pricePromptPer1k: number;
  private readonly priceCompletionPer1k: number;

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly prisma: PrismaService,
    private readonly budget: LlmBudgetService,
  ) {
    this.pricePromptPer1k = Number(
      process.env['AI_CREDIT_PRICE_PROMPT_PER_1K'] ?? '0.001',
    );
    this.priceCompletionPer1k = Number(
      process.env['AI_CREDIT_PRICE_COMPLETION_PER_1K'] ?? '0.004',
    );
  }

  /** 预扣金额：覆盖一次中等长度的 chat 调用。actual > reserve 时 settle 时再补扣，
   *  那时已经过 race window，但仅 (actual - reserve) 那段会有超支，不再无界。 */
  private get reserveAmount(): number {
    return Number(process.env['AI_CREDIT_RESERVE_PER_CALL'] ?? '0.10');
  }

  /**
   * 主入口。tenantCode=null → 仅透传到 provider，不计费、不查余额。
   */
  async complete(
    tenantCode: string | null,
    reason: AiCreditReason,
    req: LlmRequest,
  ): Promise<LlmResponse> {
    let reserved = 0;
    if (tenantCode) {
      reserved = await this.tryReserve(tenantCode, reason);
    }
    let resp: LlmResponse;
    try {
      resp = await this.provider.complete(req);
    } catch (err) {
      // 调用失败：把预扣全部退还（actual cost = 0）
      if (tenantCode && reserved > 0) {
        await this.refundReserve(tenantCode, reason, reserved, (err as Error).message);
      }
      throw err;
    }
    if (tenantCode && reserved > 0) {
      // settle: actual - reserve = 差额。正 = 再扣，负 = 退。
      await this.settle(
        tenantCode,
        reason,
        resp.usage ?? null,
        reserved,
        this.provider.id,
        this.provider.model,
      );
      void this.budget.checkAfterDeduct(tenantCode);
    }
    return resp;
  }

  /**
   * Atomic conditional decrement：
   *   UPDATE Tenant SET aiCredits -= reserve
   *   WHERE tenantCode = ? AND aiCredits >= minBalance + reserve
   * 0 行 → 余额不足。
   *
   * Prisma updateMany + where: { aiCredits: { gte: ... } } 翻译成的 SQL 等价。
   * 同时写一条 reserve TX 记录（reason 加后缀 `:reserve` 标识）。
   */
  private async tryReserve(tenantCode: string, reason: AiCreditReason): Promise<number> {
    const minBalance = Number(process.env['AI_CREDIT_MIN_BALANCE'] ?? '0');
    const reserve = this.reserveAmount;
    if (reserve <= 0) return 0; // 关闭计费

    const r = await this.prisma.tenant.updateMany({
      where: { tenantCode, aiCredits: { gte: minBalance + reserve } },
      data: { aiCredits: { decrement: reserve } },
    });
    if (r.count === 0) {
      // 区分 tenant-not-found vs 余额不足
      const t = await this.prisma.tenant.findUnique({
        where: { tenantCode },
        select: { aiCredits: true },
      });
      if (!t) throw new KintsugiError('NOT_FOUND', `Tenant ${tenantCode} not found`);
      throw new KintsugiError(
        'INSUFFICIENT_CREDIT',
        `tenant ${tenantCode} aiCredits ${Number(t.aiCredits).toFixed(4)} below threshold ${minBalance} + reserve ${reserve}`,
        { balance: Number(t.aiCredits), minBalance, reserve },
      );
    }
    // 写 reserve TX。失败不抛——余额已扣，TX 只是审计；warn 让 oncall 看到对账缺口
    try {
      await this.prisma.aiCreditTx.create({
        data: { tenantCode, delta: -reserve, reason: `${reason}:reserve` },
      });
    } catch (err) {
      this.logger.warn(
        `[llm-credit] reserve TX log failed for ${tenantCode}: ${(err as Error).message}`,
      );
    }
    return reserve;
  }

  /** 调用失败：把全部预扣退回 + 写一条 reason:refund TX */
  private async refundReserve(
    tenantCode: string,
    reason: AiCreditReason,
    reserve: number,
    errMsg: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction([
        this.prisma.tenant.update({
          where: { tenantCode },
          data: { aiCredits: { increment: reserve } },
        }),
        this.prisma.aiCreditTx.create({
          data: {
            tenantCode,
            delta: reserve,
            reason: `${reason}:refund`,
            meta: { error: errMsg.slice(0, 500) },
          },
        }),
      ]);
    } catch (err) {
      this.logger.warn(
        `[llm-credit] refund failed for ${tenantCode} reserve=${reserve}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * actual = 真实 token cost；delta = actual - reserve。
   * 正 → 再扣 delta；负 → 退还 |delta|。一并写一条 settle TX 含 actual / reserve 元数据。
   * 没 usage 信息时按 actual=0 处理：退还全部 reserve（保守但避免误扣）。
   */
  private async settle(
    tenantCode: string,
    reason: AiCreditReason,
    usage: LlmResponse['usage'] | null,
    reserve: number,
    provider: string,
    model: string,
  ): Promise<void> {
    let actual = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    if (usage) {
      promptTokens = usage.promptTokens ?? 0;
      completionTokens = usage.completionTokens ?? 0;
      actual =
        (promptTokens / 1000) * this.pricePromptPer1k +
        (completionTokens / 1000) * this.priceCompletionPer1k;
    }
    const delta = actual - reserve; // 正 = 再扣；负 = 退
    try {
      await this.prisma.$transaction([
        this.prisma.tenant.update({
          where: { tenantCode },
          data: { aiCredits: { decrement: delta } }, // delta < 0 → increment
        }),
        this.prisma.aiCreditTx.create({
          data: {
            tenantCode,
            delta: -delta, // tx delta 表 "余额变化"，所以是 -delta
            reason: `${reason}:settle`,
            meta: {
              provider,
              model,
              promptTokens,
              completionTokens,
              totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
              actualCost: actual,
              reserve,
            },
          },
        }),
      ]);
      if (actual > reserve * 3) {
        this.logger.warn(
          `[llm-credit] settle for ${tenantCode}: actual=${actual.toFixed(4)} > reserve×3 ` +
            `(${(reserve * 3).toFixed(4)})—consider raising AI_CREDIT_RESERVE_PER_CALL`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[llm-credit] settle failed for ${tenantCode} delta=${delta.toFixed(4)}: ${(err as Error).message}`,
      );
    }
  }
}
