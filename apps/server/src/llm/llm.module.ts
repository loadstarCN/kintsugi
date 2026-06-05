import { Global, Logger, Module } from '@nestjs/common';
import {
  createLlmProvider,
  createLlmProviderFromEnv,
  type LlmProvider,
  type LlmProviderConfig,
  type LlmProviderId,
  type LlmRequest,
  type LlmResponse,
} from '@kintsugi/llm';
import { llmCallCounter, llmTokenCounter } from '../common/metrics';
import { LlmGateway } from './llm-gateway.service';
import { LlmBudgetService } from './llm-budget.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LLM_PROVIDER } from './llm.tokens';

export { LLM_PROVIDER };

/**
 * 在原 provider 外包一层，统计 OTel metric：
 *  - kintsugi_llm_call_total{provider, outcome}
 *  - kintsugi_llm_token_total{provider, kind=prompt|completion}
 *
 * outcome 分 ok / error / timeout（按错误信息粗判；timeout 文案不统一时归为 error）。
 */
function instrument(provider: LlmProvider): LlmProvider {
  return {
    id: provider.id,
    model: provider.model,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const labels = { provider: provider.id };
      try {
        const resp = await provider.complete(req);
        llmCallCounter.add(1, { ...labels, outcome: 'ok' });
        if (resp.usage?.promptTokens) {
          llmTokenCounter.add(resp.usage.promptTokens, { ...labels, kind: 'prompt' });
        }
        if (resp.usage?.completionTokens) {
          llmTokenCounter.add(resp.usage.completionTokens, { ...labels, kind: 'completion' });
        }
        return resp;
      } catch (err) {
        const msg = (err as Error).message ?? '';
        const outcome = /timeout|aborted|abortError/i.test(msg) ? 'timeout' : 'error';
        llmCallCounter.add(1, { ...labels, outcome });
        throw err;
      }
    },
  };
}

/**
 * 主 provider 故障 → 落到 fallback 重试一次。配 LLM_FALLBACK_PROVIDER + LLM_FALLBACK_API_KEY
 * 即启用；缺一就只跑 primary（无 fallback）。
 *
 * 不在 timeout 上 retry —— 用户已经等了一次 timeout 时长，别让他们再等第二次。
 * 只对 5xx / network / "LLM upstream"-style error 走 fallback。
 *
 * id/model 报告主 provider 的（fallback 是隐式的，对调用方透明）。
 */
function withFailover(
  primary: LlmProvider,
  fallback: LlmProvider | null,
  logger: Logger,
): LlmProvider {
  if (!fallback) return primary;
  return {
    id: primary.id,
    model: primary.model,
    async complete(req: LlmRequest): Promise<LlmResponse> {
      try {
        return await primary.complete(req);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/timeout|aborted|abortError/i.test(msg)) {
          throw err; // 别让 timeout 链式
        }
        logger.warn(
          `[llm] primary provider=${primary.id} failed (${msg.slice(0, 200)}); ` +
            `failing over to ${fallback.id}`,
        );
        llmCallCounter.add(1, { provider: primary.id, outcome: 'failover_to_secondary' });
        return await fallback.complete(req);
      }
    },
  };
}

function buildFallbackFromEnv(): LlmProvider | null {
  const provider = process.env['LLM_FALLBACK_PROVIDER'] as LlmProviderId | undefined;
  const apiKey = process.env['LLM_FALLBACK_API_KEY'];
  const model = process.env['LLM_FALLBACK_MODEL'];
  if (!provider || !apiKey || !model) return null;
  const cfg: LlmProviderConfig = { provider, model, apiKey };
  if (process.env['LLM_FALLBACK_BASE_URL']) cfg.baseUrl = process.env['LLM_FALLBACK_BASE_URL'];
  if (process.env['LLM_FALLBACK_TIMEOUT_MS']) {
    cfg.timeoutMs = Number(process.env['LLM_FALLBACK_TIMEOUT_MS']);
  }
  return createLlmProvider(cfg);
}

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: (): LlmProvider => {
        const logger = new Logger('LLM');
        const primary = instrument(createLlmProviderFromEnv());
        const fallback = buildFallbackFromEnv();
        if (fallback) {
          logger.log(`failover enabled: primary=${primary.id} fallback=${fallback.id}/${fallback.model}`);
          return withFailover(primary, instrument(fallback), logger);
        }
        return primary;
      },
    },
    LlmGateway,
    LlmBudgetService,
  ],
  exports: [LLM_PROVIDER, LlmGateway, LlmBudgetService],
})
export class LlmModule {}
