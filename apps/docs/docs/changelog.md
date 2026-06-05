# 更新日志

按 [Keep a Changelog](https://keepachangelog.com/) + 语义化版本（暂无正式 release）。

## Unreleased

### Added

- BFF / Instant API / Custom SQL / Chats 在 PG 业务连接上注入 `kintsugi.tenant/user_id/dept_ids` GUC，配合客户启用的 RLS policy 不会自挡
- VitePress 文档站（你正在看的）
- HMAC（AccessKey）路径在 ctx 里携带 tenantCode；下游 GUC 注入 + audit query 能正确 scope（之前 audit 在 access-key 路径返回**全租户**日志的 leak 已修）
- AccessKey 可选绑定到具体 user（`boundUserId`）—— HMAC 路径会注入 `kintsugi.user_id` GUC，scope=self 的 RLS 对该 key 也生效；适合 personal access token / OAuth 集成场景
- HMAC 写请求现在也写 audit log（之前 access-key 写操作不留痕迹）；userId 字段为 boundUserId（未绑则 null），accessKey 落进 afterJson 便于回溯
- `kintsugi api-pull` 现在真正生成 typed SDK：openapi.json + types.ts（openapi-typescript 派生）+ client.ts（dataset/sql/bff/chats 包好的 typed proxy）；server 改字段重跑即可
- server 暴露 `GET /api/openapi.platform.json` —— 平台稳定 API 的 OpenAPI 3.0.3 规范（与 per-app Instant API 互补）
- `@kintsugi/sdk` 自身类型现在从 platform spec 自动派生（`pnpm --filter @kintsugi/sdk gen`），告别手写漂移；checked-in 快照支持离线 build
- CI 加 `spec-drift` job：跑 `buildPlatformSpec()` 跟 `packages/sdk/spec/openapi.platform.json` 快照对比 + `pnpm sdk:gen` 后 git diff 必须为空；改了 platform-spec.ts 但忘了刷快照的 PR 直接挂
- 每个 app 的 OpenAPI 把 `FilterClause` / `FilterRequest` 从"每张表内联"提到顶层 `components.schemas`：spec 体积小，`kintsugi api-pull` 生成的 `client.ts` 现在 `op` 是 13 个值的 typed enum 而非 string
- `AuditLog` 新增 `accessKey` 列（带索引）+ `/api/audit-logs?accessKey=` filter；HMAC 路径写入时 access key 落首列而非藏在 afterJson 里。事件响应：撤销可疑 key 后能直接 `?accessKey=ak_xxx&from=...` 拉出该 key 在被撤销前的所有写操作
- 控制台新增**审计日志**页（`/audit-logs`）：按 app / userId / accessKey / 动作模糊 / 时间范围筛选，分页表 + CSV 导出按钮；点击 AccessKey tag 自动按该 key 过滤
- OTel **真埋点**：`tracing.ts` 装 MeterProvider + OTLP HTTP exporter；`common/metrics.ts` 集中定义 6 个 counter/histogram（rate_limit_hit / audit_write_fail / llm_call / llm_token / bff_exec_duration / db_conn_in_flight）；rate-limit 中间件 / audit interceptor / LLM provider 包装层 / BFF executor / openAdapter 都接上。Grafana panel 现在真有数据
- DBAgent eval fixture 从 3 扩到 20（涵盖 \_code 后缀 / 自引用 / 双 FK 同目标 / UUID / 复合 PK / 非 id PK / 多前缀 / substring / 大 schema / 拼音 / 空表）；规则层修了两个 bug：(1) 自引用 prefix（parent/child/next/reply 等）现在能产候选；(2) eval 阈值从 0.7 降到 0.5（匹配生产实际"会进 LLM 复核"的最低分）。20/20 macro F1 = 100%
- **Crypto 格式 v1**：AES-GCM ciphertext 加 version byte + 每条记录独立 16-byte 随机 salt（替代之前固定 'kintsugi-salt'）。decrypt 双路径：v1 优先，旧 v0 数据自动 fallback（无需停机迁移）。覆盖 1/256 IV 碰撞 case 的回归测试。已加密的 RDS 数据 100% 向后兼容
- 测试覆盖率工具上线：vitest --coverage（v8 reporter）+ vitest.config.ts 集中阈值。CI 跑 `pnpm test:cov` 反退化（当前 baseline lines 9.7% / branches 60% / functions 38%，定底线略低）。第一条 HTTP e2e（`/api/health`）打通了 supertest + @nestjs/testing + unplugin-swc 让 Nest DI 在 vitest 里能正确解析 decorator metadata
- **AI Credit 真扣** + 多租户配额。新 `LlmGateway` service：调 LLM 前查 `Tenant.aiCredits`，余额低于阈值抛 INSUFFICIENT_CREDIT（HTTP 402）；调用后按 token 数算 cost、原子更新余额 + 写 AiCreditTx；DB 失败 warn-only 不阻塞业务。已迁 ChatsService（最高频 LLM 路径），其他 service 后续轮迁。新 `QuotaService` 检查 DataSource / Dataset 数上限（Tenant 列优先，env 默认 50/1000）；create 路径触发即拒（QUOTA_EXCEEDED, HTTP 429）
- **用户级登录锁** + bcrypt 历史 access-key 清理。`User` 加 `failedLoginCount/lastFailedLoginAt/lockedUntil`：5 次失败 / 15min 窗口 → 锁 15min（env-tunable）。`pnpm bcrypt:cleanup` 脚本流式扫表 dry-run / `--apply` 把 decrypt 失败的旧 bcrypt 数据 revoke 掉
- **LLM provider 故障切换**：配 `LLM_FALLBACK_PROVIDER/MODEL/API_KEY` 后，主 provider 5xx-like 错误自动重试 fallback 一次。Timeout 不重试（避免双倍等待）
- **业务级 metric**：`kintsugi_dataset_call_total{tenant,app,action}` / `kintsugi_page_generated_total` / `kintsugi_chat_ask_total` / `kintsugi_uncaught_exception_total{kind,code}`。新 `AllExceptionsFilter` 兜底所有 5xx：统一计数 + 不外泄堆栈
- **ESLint v9 (flat config)** + husky pre-commit + CI lint job。@typescript-eslint recommended（不上 type-checked，避免 lint 时跑 tsc）。lint-staged 自动 fix；当前基线 0 errors / 19 warnings（react-hooks 老遗留）
- **后台调度**（`SchedulerModule`）：6h 一次 tick，扫 7 天内即将过期的 AccessKey + 90 天没活动的 User，emit metric `kintsugi_access_key_expiring_soon` / `kintsugi_inactive_user_count` + warn-log。`SCHEDULER_TICK_MS=0` 关闭。复用 main.ts 已有的 setInterval 模式，不引入 cron 框架

### Round-7 hardening (2026-05-03)

- Redis-backed rate limiter（共享 store + Redis URL 自动接管）
- PG RLS policy emitter（`GET /api/datasets/:code/rls-policy`）
- Audit log 查询 + CSV 导出
- AccessKey 旋转流程（`POST /:accessKey/rotate`，60 min grace）
- 安全关键路径 47 个测试
- DBAgent eval harness（fixture + F1 阈值）
- MCP 写工具（write_bff / write_sql / update_dataset_do / get_rls_policy）
- CI test + audit + dbagent-eval + Semgrep
- OTel SLO docs（Grafana + Prometheus + runbook）
- Text-to-Page 多模态（imageUrls）

### Round-6 (2026-04-25)

- Runtime 修复 + token 存储清理 + 子应用 SRI

### Round-5 (2026-04-24)

- Auth + replay protection + locking + rate-limit + deploy

### M3-M6 全线拉起 (2026-04-25)

- schema 增量同步 / ABAC + RLS 应用层 / 分布式事务 / OpenTelemetry
- 资产导入导出 / Text-to-Page / React 子应用宿主
- KintsugiReport AI 报表 / 飞书 Bridge / Docker 独立部署 / 移动端 SDK

### MVP（2026-04-25 单日推进）

- DataSource 管理 + DBAgent 扫描 + Dataset 落库
- Instant API v1 + DO 编辑器 + ER 图
- BFF 沙箱 + KintsugiChats 问数 + Kintsugi CLI
- MCP Server + Skills 2.0 + RBAC 基础
