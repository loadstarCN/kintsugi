import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { PrismaService } from '../prisma/prisma.service';

const meter = metrics.getMeter('kintsugi-llm-budget');
const breachCounter = meter.createCounter('kintsugi_llm_budget_breach_total', {
  description: 'Tenants observed exceeding rolling 1h LLM cost budget.',
});

/**
 * 滚动窗口预算告警。**不阻断**业务调用——硬上限走 LlmGateway.assertCreditAvailable，
 * 这条只是一个"早告警"：超过阈值就 warn-log + emit counter，让 oncall 在 5 分钟内看到。
 *
 * 阈值通过 env 读：
 *   LLM_BUDGET_YUAN_PER_HOUR=10        — 每租户每小时累计花费 ≥ 10 元 → warn
 *   LLM_BUDGET_THROTTLE_AFTER_BREACHES=3 — 同一租户单 tick 已 warn 过 3 次再 warn 没意义，去抖
 *
 * 缺省（env 未设 / 0）= 关闭，零开销。聚合查 AiCreditTx 用现有 (tenantCode, createdAt) 索引。
 *
 * 设计选择：每次 deduct 后查一次滚动 1h 总和——不在内存维护 token bucket：
 *   1. 多 server 实例时 in-memory 状态会漂；
 *   2. AiCreditTx 已经是计费真相，多打一个 SUM query 在 (tenantCode, createdAt) 索引上很便宜；
 *   3. 如果以后 query 太频，再加 5 分钟 in-process 缓存，不需要先做。
 */
@Injectable()
export class LlmBudgetService {
  private readonly logger = new Logger(LlmBudgetService.name);
  /** 同一 tenant 同一小时内最多 emit 多少条 warn-log，避免日志风暴 */
  private readonly maxWarnsPerTenantPerHour: number;
  /** key=tenantCode|hour-bucket → warn 计数 */
  private readonly warnCount = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {
    this.maxWarnsPerTenantPerHour = Number(
      process.env['LLM_BUDGET_THROTTLE_AFTER_BREACHES'] ?? '3',
    );
  }

  /**
   * deduct 完成后调；超阈值时 warn + counter。永不抛错——失败也别 block 业务热路径。
   */
  async checkAfterDeduct(tenantCode: string): Promise<void> {
    const limit = Number(process.env['LLM_BUDGET_YUAN_PER_HOUR'] ?? '0');
    if (!Number.isFinite(limit) || limit <= 0) return;

    try {
      const since = new Date(Date.now() - 3_600_000);
      const agg = await this.prisma.aiCreditTx.aggregate({
        where: {
          tenantCode,
          createdAt: { gte: since },
          delta: { lt: 0 }, // 只算消耗（充值是 +）
        },
        _sum: { delta: true },
      });
      const spent = agg._sum.delta ? -Number(agg._sum.delta) : 0;
      if (spent < limit) return;

      // 去抖：同 tenant 同小时桶内最多打 N 条 warn
      const bucket = `${tenantCode}|${Math.floor(Date.now() / 3_600_000)}`;
      const seen = this.warnCount.get(bucket) ?? 0;
      this.warnCount.set(bucket, seen + 1);
      if (seen >= this.maxWarnsPerTenantPerHour) return;

      // 不把 tenantCode 作 metric label：高基数（tenants 数量增长 → 时间序列爆炸 / OOM 后端）。
      // tenant 信息见下方 warn log，metric 只记 count。
      breachCounter.add(1);
      this.logger.warn(
        `[llm-budget] tenant=${tenantCode} 1h spend=${spent.toFixed(4)}元 ≥ limit=${limit.toFixed(4)}元 — investigate`,
      );

      // 偶尔清掉过期 bucket 防 Map 漏（>500 entries 之后清一波）
      if (this.warnCount.size > 500) {
        const cutoff = Math.floor(Date.now() / 3_600_000) - 1;
        for (const k of this.warnCount.keys()) {
          const m = /\|(\d+)$/.exec(k);
          if (m && Number(m[1]) < cutoff) this.warnCount.delete(k);
        }
      }
    } catch (err) {
      this.logger.warn(`[llm-budget] check failed for tenant=${tenantCode}: ${(err as Error).message}`);
    }
  }
}
