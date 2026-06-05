# Kintsugi Roadmap

## 已交付（2026-04-25 单日推进）

### 核心价值闭环（P0）

| 模块                       | 状态 | 说明                                                                      |
| -------------------------- | ---- | ------------------------------------------------------------------------- |
| DataSource 管理 + 连接测试 | ✅   | POST/GET/DELETE `/api/datasources`                                        |
| DBAgent 扫描               | ✅   | 规则候选 + LLM 分批复核 + neighborTables                                  |
| 扫描结果呈现               | ✅   | web `/datasources/:dsId/scans/:jobId`                                     |
| Dataset 从 scan 落库       | ✅   | `/api/datasets/from-scan/:jobId`                                          |
| Instant API v1             | ✅   | filter/getOne/create/update/delete/batchCreate/aggregate/getSelectOptions |
| DO 编辑器                  | ✅   | web `/datasets/:datasetCode`                                              |
| Dataset 列表 + 数据浏览器  | ✅   | web `/datasets` + `/datasets/:code/data`                                  |
| Swagger / OpenAPI          | ✅   | `/api/apps/:appCode/{openapi.json,docs}`                                  |

### 企业底座（P1）

| 模块                              | 状态 | 说明                                                      |
| --------------------------------- | ---- | --------------------------------------------------------- |
| Auth (register/login/jwt/session) | ✅   | `/api/auth/*` + JwtGuard + cookie                         |
| TenantGuard                       | ✅   | `common/tenant.guard.ts`                                  |
| Audit interceptor                 | ✅   | `common/audit.interceptor.ts`，traceparent 透传           |
| Rate limit                        | ✅   | `common/rate-limit.middleware.ts`（内存版，生产换 Redis） |
| Custom SQL                        | ✅   | `/api/sql/*`，#{param} 占位，riskLevel 分级               |
| OpenAPI HMAC-SHA256               | ✅   | `/api/access-keys/*` + 签名验证                           |
| ER 图可视化                       | ✅   | web `/datasources/:dsId/er`（reactflow）                  |
| Soft-delete + 乐观锁              | ✅   | DO JSON 声明字段自动生效                                  |

### AI-Native 生态（P2）

| 模块               | 状态 | 说明                                                            |
| ------------------ | ---- | --------------------------------------------------------------- |
| BFF 基础           | ✅   | node:vm 沙箱 + context.client.models/sql/userInfo               |
| KintsugiChats 问数 | ✅   | `/api/chats/ask` — NL → SQL (DeepSeek) → 执行                   |
| Kintsugi CLI       | ✅   | `packages/cli`，`kintsugi auth/dataset/sql/bff/api-pull/doctor` |
| Runtime CLI        | ✅   | `packages/runtime-cli`，只 exec 不 list                         |
| MCP Server         | ✅   | `packages/mcp-server`，stdio JSON-RPC                           |
| Skills 2.0 包      | ✅   | `packages/skills`，CLI 与 Runtime 两份 SOP                      |
| RBAC 基础          | ✅   | `/api/rbac/*`，wildcard grant 规则                              |

## 完整复刻第二轮（M3-M6 全线拉起）

2026-04-25 凌晨继续推进到完整功能版本。所有原本 ⏸️ 的条目都从骨架升级到"最小可用 + 有端到端 happy path"。

### P1 收尾（4/4）

| 模块                 | 状态 | 说明                                                                                                                       |
| -------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| 全局挂载中间件       | ✅   | `AuditInterceptor` 挂 APP_INTERCEPTOR；`RateLimitMiddleware` 通过 NestModule.configure 注册到 `/api/*`（排除 auth+health） |
| HMAC 路由接入        | ✅   | `HmacOrJwtGuard`（`access-key/hmac.guard.ts`）双通道认证；Instant API 可切换                                               |
| 前端 Auth 联调       | ✅   | `LoginPage` / `AuthContext` / `ProtectedRoute`；api.ts 自动注入 `Authorization: Bearer <token>`；顶栏用户 dropdown + 退出  |
| `@kintsugi/sdk` 补齐 | ✅   | 适配真实 server 路径；支持 cookie / token / accessKey 三种 auth；DataSetClient / BFF / SQL / Chats 全暴露；HMAC 签名流     |

### 业务功能（11/11 全做完）

| 模块                   | 代码位置                                                                 | 说明                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| schema 增量同步        | `apps/server/src/modules/dbagent/schema-diff.ts` + `DbAgentService.sync` | POST `/api/dbagent/datasources/:id/sync`；diff 上一次成功 snapshot 产出 added/removed/modifiedTables + changedColumns                                                       |
| ABAC + RLS 应用层      | `apps/server/src/modules/instant-api/rls.ts` + DO.dataRule               | Instant API 所有写读路径经 `baseExtraWhere(doJson, ctx)` → tenantField 强隔 + dataRule.scope ∈ {all,self,dept,role} 自动注 where；支持 `${user.xxx}` 插值                   |
| 分布式事务（单库 tx）  | `packages/db-scanner/src/dialect.ts` + pg/mysql 实现 + `bff-runtime.ts`  | `adapter.withTransaction(fn)`（pg 用 BEGIN/COMMIT + SAVEPOINT，mysql 用 START TRANSACTION）；BFF `ctx.client.tx(async () => ...)`                                           |
| OpenTelemetry          | `apps/server/src/tracing.ts`                                             | `OTEL_ENABLED=true` 启用；@opentelemetry/sdk-node + auto-instrumentations；OTLP HTTP exporter                                                                               |
| 资产导入/导出          | `modules/asset-transfer`                                                 | GET `/api/apps/:appCode/transfer/export` → zip bundle（dataset + page + menu + bff + sql + roles + 独立 `bff/*.js` / `sql/*.sql` 文件）；POST import with `?overwrite=true` |
| Text-to-Page           | `modules/pages` + prompts.ts                                             | POST `/api/apps/:appCode/pages/generate`；LLM 根据 DO 元数据产出单文件 React 子应用 jsx；写入 Page + ReactSubApp                                                            |
| React 子应用宿主       | `apps/web/src/pages/PageRunnerPage.tsx` + `PagesListPage.tsx`            | iframe + srcDoc + Babel standalone 即时编译；注入 `window.kintsugi.client.models[datasetCode]` + JWT；双 tab（预览 / 源码编辑）+ 发布 versioning                            |
| KintsugiReport AI 报表 | `modules/reports` + `ReportsPage.tsx`                                    | POST `/api/apps/:appCode/reports/ask`；LLM 产 `{sql, chart:{type,xField,yField,seriesField}}`；前端 echarts-for-react 渲 bar/line/pie/funnel/scatter/table                  |
| 飞书 Bridge            | `modules/feishu`                                                         | POST `/api/bridges/feishu/webhook?appCode=...`；支持 `url_verification` + `im.message.receive_v1` 文本消息 → 打 ChatsService → 回 `{reply: ...}`                            |
| 独立部署（Docker）     | `deploy/`                                                                | multi-stage Dockerfile.server + Dockerfile.web + nginx.conf（含 /api 反代）+ docker-compose.yml（含 postgres healthcheck）+ install.sh（up/down/logs）                      |
| 移动端 SDK             | `packages/mobile-sdk/{ios,android}`                                      | iOS Swift Package（KintsugiKit + Models.swift）支持 token + HMAC；Android Gradle module（OkHttp + kotlinx-serialization）对齐同形状 API；README 说明 OpenAPI codegen 路径   |

### ⏸️ 真正留到下一阶段

- **独立部署 Spring Boot 二方包**：Node.js 版 Docker 已 good，Java 栈整条 2-3 月工期保持 TODO（`packages/standalone-deploy/README.md` 保留）。
- **iOS/Android 打包发布到 Cocoapods / Maven Central**：源码已提供，发布流水线没做。
- **MCP Server 的复杂 tool set**（`write_bff` / `write_sql` / `preview_page`）：目前 6 个 tool 覆盖最常用路径，写操作只有 `execute_sql`；更完整的写工具下轮再加。
- **真正的 React 子应用沙箱**：当前 iframe + Babel-standalone 能隔离，但不是 qiankun/wujie 级别的 JS 沙箱 + 样式隔离；线上版本需换方案。
- **ABAC + PG RLS 真策略**：目前是应用层注入 extraWhere，`CREATE POLICY` SQL 产物和 PG SET LOCAL 联动未做。

## 目录结构一览

```
apps/
  server/                       NestJS + Prisma 后端
    src/
      modules/
        application/            应用列表 / 详情
        datasource/             DataSource CRUD + 连接测试
        dbagent/                扫描 + LLM 分批复核
        dataset/                Dataset + DO 编辑 + from-scan 落库
        instant-api/            Instant API v1（filter/getOne/...）
        openapi/                OpenAPI 3 + Swagger UI
        auth/                   JWT + bcrypt + cookie
        custom-sql/             sqlCode + #{param} + riskLevel
        access-key/             HMAC-SHA256
        bff/                    node:vm 沙箱
        chats/                  KintsugiChats NL→SQL
        rbac/                   User-Role-Permission
        health/
      common/
        crypto.ts
        tenant.guard.ts
        audit.interceptor.ts
        rate-limit.middleware.ts
  web/                          Vite + React + Ant Design + reactflow
    src/pages/
      HomePage / HealthPage
      DataSourceListPage / ScanHistoryPage / ScanResultPage / ErGraphPage
      DatasetListPage / DatasetDetailPage / DatasetDataPage
      ChatsPage
packages/
  shared/                       错误码、brand types、ID、pagination
  db-scanner/                   DialectAdapter + pg/mysql 适配器 + unsupported stub
  llm/                          LLM provider 抽象（DeepSeek/Qwen/OpenAI）
  sdk/                          TypeScript SDK
  cli/                          Kintsugi CLI（dev-time）
  runtime-cli/                  Kintsugi Runtime CLI（运行态 agent-only）
  mcp-server/                   MCP stdio server
  skills/             Skills 2.0 包
  text-to-page/                 ⏸️
  react-subapp-host/            ⏸️
  abac-rls/                     ⏸️
  distributed-tx/               ⏸️
  standalone-deploy/            ⏸️
  report/                 ⏸️
  mobile-sdk/                   ⏸️
  feishu-bridge/                ⏸️
  asset-transfer/               ⏸️
  incremental-sync/             ⏸️
```

## 如何上手

```bash
# 1. 起后端 + 前端
pnpm dev:server    # http://localhost:4000
pnpm dev:web       # http://localhost:5173

# 2. 注册 + 登录
curl -X POST http://localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"tenantCode":"demo","username":"alice","password":"alice123"}'

# 3. 创建数据源 + 扫描 + 落库 dataset（前端 UI 一条龙）

# 4. Instant API 访问
curl -X POST http://localhost:4000/api/apps/app-demo0001/ds/<datasetCode>/filter \
  -H 'content-type: application/json' \
  -d '{"pageSize":10}'

# 5. 问数
curl -X POST http://localhost:4000/api/chats/ask \
  -H 'content-type: application/json' \
  -d '{"appCode":"app-demo0001","question":"goods 按 type 分布"}'

# 6. CLI
cd <path-to-repo>
export KINTSUGI_API_BASE=http://localhost:4000
node packages/cli/bin/kintsugi.js dataset list -a app-demo0001

# 7. MCP
node packages/mcp-server/bin/mcp.js
# 然后从 MCP 客户端发 initialize / tools/list / tools/call
```
