# Kintsugi Runbook

## High Error Rate

**Alert:** `KintsugiHighErrorRate5m` — 5xx 占比 > 2% 持续 10 分钟。

**Triage（按优先级）：**

1. **看 trace** — 在 Grafana / Tempo / Jaeger 里按 `service.name=kintsugi-server status_code=ERROR` 拉最近 5 分钟，
   看 span_name 集中在哪一类端点：
   - `POST /api/apps/.*/ds/.*` → Instant API 路径，多半是业务库连接出问题
   - `POST /api/chats/ask` / `POST /api/.*/reports/ask` → LLM provider 抛错或超时
   - `POST /api/auth/login` → 看是不是被 password spray + login throttle 没接好
2. **看业务库** — 如果是 Instant API：
   ```sql
   SELECT pid, state, query_start, wait_event_type, query
   FROM pg_stat_activity
   WHERE state != 'idle' AND now() - query_start > interval '10s';
   ```
   超长 query / lock waits → 通知客户应用团队。
3. **看 LLM provider** — 如果是 chat / report / pages.generate：
   先确认 `LLM_API_KEY` 没变；DeepSeek 状态页 / 配额。
   降级方案：临时把 `LLM_PROVIDER=openai` 切到备用 provider（需提前配 OpenAI key）。
4. **看 DB 连接池** — Prisma 默认 connection_limit=num_cpus\*2+1；如果业务库连接耗尽，
   `prisma db connect` 会抛 `P1001`。临时手段：重启 server 实例。

## Instant API P99 高

**Alert:** `KintsugiInstantApiP99High` — p99 > 500ms 持续 10 分钟。

1. 拉 trace，看是 server 内逻辑还是业务库 query 慢。一般 90% 在业务库 span 上。
2. 业务库慢 → 看 `pg_stat_statements`：
   ```sql
   SELECT query, calls, mean_exec_time, max_exec_time
   FROM pg_stat_statements
   WHERE query ILIKE 'select%'
   ORDER BY mean_exec_time DESC
   LIMIT 20;
   ```
3. 没走索引的列 → 通知客户加索引；或者先在 DO 里把 `searchable=true` 关掉。

## LLM 端点 P99 > 15s

**Alert:** `KintsugiLlmEndpointP99High`

LLM 端点慢通常是 provider 本身慢，不一定是 server 问题。但如果是 `pages/generate` 或
`reports/ask` 慢，可以：

1. 看 `LLM_MAX_TOKENS` 配置 —— 上下文太长会显著拖慢 inference
2. DBAgent 扫描时如果业务库表很多，先用 `?include=` 缩小范围

## Rate Limit Flood (Login)

**Alert:** `KintsugiRateLimitFloodLogin`

login throttle 被打到说明可能在被 password spray。

1. 找 source IP：在 OTel attributes 里看 `client.address`
2. 多个 username 来自同一 IP 但都失败 → 加防火墙 / WAF 规则
3. 是真用户密码忘了 → 引导走 reset 流程（目前没有；下一轮加）

## Server Down

**Alert:** `KintsugiServerDown`

1. 看 PM2 / systemd / docker logs：`deploy/pm2/` 下有启动脚本
2. 常见原因：
   - `METADATA_DATABASE_URL` 失效（密码过期 / RDS 重启）
   - `ENCRYPTION_KEY` 没读到 → 启动时所有 access-key 验签都失败
   - OOM —— Node 进程默认 1.7GB heap，scan 任务 + 大表 sample 偶发触顶；加 `--max-old-space-size=4096`
3. 启动时的 OTel init 失败不会阻塞服务（tracing.ts 里 try/catch 了）；
   但如果 collector endpoint 拒绝连接，trace 就丢了，metrics dashboard 会空。
