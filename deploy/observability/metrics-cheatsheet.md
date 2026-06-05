# Oncall 指标速查（3am 友好版）

按"看到这条 metric 异常 → 先做什么"组织。**不要从这页学指标含义**；那是 README 的事。

> 命名约定：`<value>` 是当前测得值，`<thresh>` 是告警阈值。所有 metric 的 emit 点
> 在 `apps/server/src/common/metrics.ts` 和 `apps/server/src/modules/scheduler/scheduler.service.ts`。

---

## 流量 / 错误率

### `kintsugi_uncaught_exception_total{kind="unknown"}` 飙

外部观感：5xx 突涨。

正常区间：常态稳定为 0；偶发 spike < 5/min。

第一步：

```sql
-- audit log 同窗口看哪个 traceparent 出现得多
SELECT traceparent, action, count(*)
FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '5 min'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;
```

→ 拿 traceparent 去 Tempo / Jaeger 看完整 span tree。

如果看到 `prepared statement does not exist` —— 之前出过的 TDZ 循环引用 bug，
看 `apps/server/src/llm/llm.tokens.ts` 是不是又被合掉了。

### `traces_spanmetrics_calls_total{status_code="error"}` 涨且分布在多 span

通常是上游故障（业务库 / LLM provider）传染。先看 `kintsugi_llm_call_total{outcome="error"}`
和 `kintsugi_db_conn_in_flight` 哪个先动。

---

## LLM 成本 / 配额

### `kintsugi_llm_token_total{kind="completion"}` 突增 N×

可能：

1. 某租户的 page 生成被卡死循环（PagesService.regenerate 没拦阈值）
2. 客户在 chats 里贴了几兆 prompt 进 chats.ask（应该被 server 截断，但兼容性 bug 时会漏）
3. 攻击：access key 泄漏 → 被人当代理用

第一步：

```sql
SELECT "tenantCode", "purpose", SUM(tokens) AS total
FROM "LlmCallLog"
WHERE "createdAt" > NOW() - INTERVAL '15 min'
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;
```

异常租户 → `LlmCostBudgetService` 应该已经触发了 warn-log（`[llm-budget] tenant=...`）；
没看到 = budget 没设。临时手段：直接禁用该租户的 access key，再排查。

### `kintsugi_llm_call_total{outcome="error",provider="deepseek"}` 持续走高

DeepSeek 抖动。降级：

```bash
# 临时切到 OpenAI 备用 key（提前在 .env 配 OPENAI_API_KEY）
export LLM_PROVIDER=openai
pm2 restart kintsugi-server
```

LlmGateway 的 failover 链应该自动接，但如果 failover 也 timeout 严重，手动切更快。

---

## 安全 / 限流

### `kintsugi_rate_limit_hit_total{scope="login"}` 飙

password spray 攻击。三步：

1. 看 `auditLog` 里 `action='auth.login'` 且 outcome=fail 的源 IP top 10
2. nginx 上对那批 IP 加 deny（`/etc/nginx/conf.d/deny.conf`）
3. 看是否有受害账号（fail 多但 success 也有）→ 强制 rotate 那些 user 的密码

### `kintsugi_access_key_expiring_soon` 持续 > 0

慢 tick（6h）一次的 gauge——值停在 N 表示 N 条 key 即将过期没 rotate。
**不是急告警**，下班前查邮件，给 owner 发"该旋转了"通知。

```sql
SELECT "accessKey", "appCode", "tenantCode", "expiresAt", "createdBy"
FROM "AccessKey"
WHERE "revokedAt" IS NULL
  AND "expiresAt" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
ORDER BY "expiresAt";
```

---

## 数据 / 持久化

### `kintsugi_audit_write_fail_total` 非 0

审计写不进 DB。元数据库可能：连接池耗尽 / 表锁 / 磁盘满。

第一步：

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));
SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'shared_buffers');
```

`AuditLog` 是写多读少的大表；retention sweep（`SchedulerService.purgeOldAuditLog`）
默认 365 天，急时把 `AUDIT_RETENTION_DAYS=90` 临时砍下去重启 server，6h 内 purge job 会跑。

### `kintsugi_db_conn_in_flight{dialect="..."}` 接近 RDS max_connections

业务库连接池接近耗尽。看是哪个 datasource：

```sql
-- 元数据库里看最近 1 小时使用过的 datasource
SELECT "dataSourceId", count(*)
FROM "AuditLog"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
  AND action LIKE 'instantApi.%'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
```

→ 直连那个客户业务库跑 `pg_stat_activity` 找慢 query。
长期手段：上 pgBouncer（见 `pgbouncer.md`），让连接复用。

### `kintsugi_audit_log_purged_total` 突然涨很多

正常情况：retention sweep 第一次跑 / `AUDIT_RETENTION_DAYS` 被改小。
异常情况：有人手动删了元数据库行，scheduler 误算。
看 `[SchedulerService] audit-log retention sweep: purged N rows older than ...` log，
N 应当稳定在每天的写入量左右；超过 10× → 调查。

---

## 业务 KPI（不是告警，是日报）

| Metric                                         | 业务含义                                       |
| ---------------------------------------------- | ---------------------------------------------- |
| `kintsugi_dataset_call_total{action="filter"}` | DAU / MAU 的近似上界                           |
| `kintsugi_page_generated_total{outcome="ok"}`  | 平台为客户生成的页面数（合同结算项）           |
| `kintsugi_chat_ask_total`                      | NL→SQL 自然语言查询使用率                      |
| `kintsugi_inactive_user_count`                 | 90 天没上来过的用户；客户成功团队的 churn 信号 |

不需要告警，按周看趋势即可。Grafana 里这些放在 `grafana-overview.json` 的"业务面板"区。

---

## 看完没思路？

1. `pm2 logs kintsugi-server --lines 500 | grep -E '\[(WARN|ERROR)\]'` 翻最近 warn/error
2. Grafana → Tempo 里按 service.name=kintsugi-server + status_code=ERROR 拉最新 50 个 trace
3. 实在不行 — 把 `OTEL_LOG_LEVEL=DEBUG` 重启一台实例（其他流量还在），看 OTel pipeline 自己有没有报错
