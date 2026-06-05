# Kintsugi Observability

OTel 已经接好（`apps/server/src/tracing.ts`），生产打开方法：

```bash
OTEL_ENABLED=true \
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces \
OTEL_SERVICE_NAME=kintsugi-server \
node dist/main.js
```

## 关键 metrics（建议接入）

OTel auto-instrument 默认产 trace；要拿 metrics，建议在 collector 侧用
`spanmetrics` connector 把 trace 转 RED（Rate / Errors / Duration），或者前置
`@opentelemetry/sdk-metrics` 自己暴露 Prometheus endpoint。

下面 dashboard / alerts 假设你已经把 spanmetrics 接到 Prometheus，metric 名称是
默认 `traces_spanmetrics_*`（可在 collector 里改）。

| Metric                                        | 取自                  | 用途         |
| --------------------------------------------- | --------------------- | ------------ |
| `traces_spanmetrics_calls_total`              | spanmetrics connector | RPS / 错误率 |
| `traces_spanmetrics_latency_bucket`           | spanmetrics connector | P50/P95/P99  |
| `db_client_operation_duration_seconds_bucket` | pg/mysql 实例化       | 业务库慢查询 |
| `kintsugi_rate_limit_hit_total`               | 自定义（见下方）      | 限流命中率   |

## SLO 目标（建议）

| SLO                     | 阈值     | 测量窗口       |
| ----------------------- | -------- | -------------- |
| Instant API p99 latency | < 500 ms | 30 day rolling |
| Server 5xx rate         | < 0.5%   | 30 day rolling |
| HMAC 验签可用性         | > 99.9%  | 30 day rolling |
| LLM-backed endpoint p99 | < 15 s   | 30 day rolling |

`prometheus-rules.yaml` 里给了对应的 Prometheus alerting rules（30d burn rate）。

## 文件清单

- `grafana-overview.json` — Grafana dashboard JSON（直接导入）
- `prometheus-rules.yaml` — 报警规则
- `runbook.md` — 当前已知告警的处理 SOP
- `metrics-cheatsheet.md` — oncall 速查：看到指标异常先做什么（3am 友好）
- `pgbouncer.md` — 业务库连接放大场景下接 pgBouncer 的姿势

## 自定义指标已埋点

`apps/server/src/common/metrics.ts` 集中定义；`tracing.ts` 在
`OTEL_ENABLED=true` 时启 MeterProvider + OTLP HTTP exporter（推送到
`${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics`，默认间隔 60s）。

| Metric                              | Type            | Labels                   | 触发点                                          |
| ----------------------------------- | --------------- | ------------------------ | ----------------------------------------------- |
| `kintsugi_rate_limit_hit_total`     | counter         | scope, key_kind          | 三类限流 middleware 命中分支                    |
| `kintsugi_audit_write_fail_total`   | counter         | tenant                   | AuditInterceptor 写失败                         |
| `kintsugi_llm_call_total`           | counter         | provider, outcome        | LLM provider 包装层                             |
| `kintsugi_llm_token_total`          | counter         | provider, kind           | 同上，按 prompt/completion 拆                   |
| `kintsugi_bff_exec_duration_ms`     | histogram       | app, scriptName, outcome | BffService.executeEndpoint finally              |
| `kintsugi_db_conn_in_flight`        | up_down_counter | dialect                  | DataSourceService.openAdapter                   |
| `kintsugi_dataset_call_total`       | counter         | tenant, app, action      | InstantApiController（filter/getOne/...）       |
| `kintsugi_page_generated_total`     | counter         | app, outcome             | PagesService.generate                           |
| `kintsugi_chat_ask_total`           | counter         | tenant, app, outcome     | ChatsService.ask                                |
| `kintsugi_uncaught_exception_total` | counter         | kind, code               | KintsugiErrorFilter + AllExceptionsFilter       |
| `kintsugi_access_key_expiring_soon` | up_down_counter | —                        | SchedulerService 慢 tick：7 天内将过期的 key 数 |
| `kintsugi_inactive_user_count`      | up_down_counter | —                        | SchedulerService 慢 tick：90 天未活跃的 user 数 |
| `kintsugi_audit_log_purged_total`   | counter         | —                        | SchedulerService.purgeOldAuditLog（保留期清理） |
| `kintsugi_trial_application_total`  | counter         | action, outcome          | TrialService apply/approve/reject 流转          |

OTel API 在没 MeterProvider 注册时回 noop，所以业务代码无需判 `OTEL_ENABLED`。
