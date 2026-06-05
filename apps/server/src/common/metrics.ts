/**
 * Kintsugi 应用级 OTel metrics。
 *
 * `metrics.getMeter()` 在 OTEL_ENABLED=false 时返回 noop meter（OTel API 的兜底
 * 行为），所以业务代码可以直接 `.add(1, {...})` 不需要判断有没有开。
 *
 * 命名遵守 OTel semantic conventions：
 *  - 用 snake_case
 *  - counter 后缀 `_total`
 *  - histogram 后缀 `_duration_ms` / `_size_bytes`
 *
 * Grafana panel 引用：deploy/observability/grafana-overview.json
 */

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('kintsugi', '0.1.0');

/** 限流命中次数（rejected requests）。
 *  attrs: scope=minute|hour|day|ai-minute|ai-hour|login|akcreate
 *         key_kind=app|tenant|ip
 */
export const rateLimitHitCounter = meter.createCounter('kintsugi_rate_limit_hit_total', {
  description: 'Number of requests rejected by rate limiting.',
});

/** 审计写入失败次数（DB 抛错时）。 */
export const auditWriteFailCounter = meter.createCounter('kintsugi_audit_write_fail_total', {
  description: 'AuditLog rows that failed to persist.',
});

/** LLM 调用次数。
 *  attrs: provider=deepseek|openai|qwen|...
 *         outcome=ok|error|timeout
 *         purpose=chat|report|page_gen|dbagent|other
 */
export const llmCallCounter = meter.createCounter('kintsugi_llm_call_total', {
  description: 'LLM provider calls (success + failure).',
});

/** LLM token 消耗。attrs: provider, kind=prompt|completion */
export const llmTokenCounter = meter.createCounter('kintsugi_llm_token_total', {
  description: 'Total tokens consumed by LLM calls.',
});

/** BFF 执行延时直方图（ms）。attrs: app, scriptName, outcome=ok|error|timeout */
export const bffExecDuration = meter.createHistogram('kintsugi_bff_exec_duration_ms', {
  description: 'BFF script execution latency.',
  unit: 'ms',
});

/** Instant API 当前在 flight 的连接数（业务库连接，不是元数据库）。
 *  attrs: dialect=postgres|mysql|... */
export const dbConnInFlight = meter.createUpDownCounter('kintsugi_db_conn_in_flight', {
  description: 'Currently held business-DB adapter connections.',
});

// ---- 业务级 KPI ----

/** Instant API 调用次数。attrs: tenant, app, action=filter|getOne|create|update|delete|aggregate */
export const datasetCallCounter = meter.createCounter('kintsugi_dataset_call_total', {
  description: 'Instant-API hits per action (DAU / 业务热度看板用)。',
});

/** Text-to-Page 页面生成次数。attrs: tenant, app, outcome=ok|error */
export const pageGeneratedCounter = meter.createCounter('kintsugi_page_generated_total', {
  description: 'Pages produced by Text-to-Page LLM flow.',
});

/** Chats 问数次数。attrs: tenant, app, outcome=ok|error */
export const chatAskCounter = meter.createCounter('kintsugi_chat_ask_total', {
  description: 'Natural-language /chats/ask invocations.',
});

/** 未捕获异常计数（filter 兜底）。attrs: kind=kintsugi_error|nest_http|unknown, code (when kintsugi) */
export const uncaughtExceptionCounter = meter.createCounter(
  'kintsugi_uncaught_exception_total',
  { description: '5xx / unexpected exceptions surfaced to KintsugiErrorFilter.' },
);
