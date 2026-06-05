# 系统架构

Kintsugi 是一个 **NestJS（后端）+ React（前端）+ pnpm monorepo** 的多租户业务平台。

## 数据流

```
                 ┌────────────────────────────────────────────────────┐
                 │                    Kintsugi 控制面                  │
                 │                                                    │
   客户业务库     │   ┌─────────────┐   ┌──────────┐   ┌─────────────┐ │
  (PG/MySQL/   ──┼──▶│  DBAgent    │──▶│ Dataset  │──▶│ Instant API │ │──▶ HTTP / SDK
   旧库)         │   │ 逆向扫描     │   │ + DO    │   │ /BFF/SQL    │ │──▶ MCP / CLI
                 │   └─────────────┘   └──────────┘   └─────────────┘ │──▶ Swagger
                 │           │             │                ▲          │
                 │           ▼             ▼                │          │
                 │   ┌─────────────────────────────────────┴────────┐ │
                 │   │       Kintsugi 元数据库（自有 PG/RDS）         │ │
                 │   │  Tenant / User / Role / App / Dataset / DO / │ │
                 │   │  Page / BFF / SQL / AccessKey / AuditLog    │ │
                 │   └──────────────────────────────────────────────┘ │
                 └────────────────────────────────────────────────────┘
```

## 关键约束

1. **元数据 ≠ 业务数据**
   - **元数据库**：Kintsugi 自有，存租户/应用/dataset 元信息/审计/RBAC——固定 PG
   - **业务库**：客户的，按 DataSource 记录连入；可以是 PG/MySQL/MariaDB/TiDB
2. **双层连接池**
   - 元数据 → Prisma + 长连接池
   - 业务库 → 每个用户请求开短连接（`openAdapter`），结束 close
3. **租户隔离三道墙**
   - HTTP 层：`TenantGuard` 看 JWT vs URL appCode
   - 查询层：`baseExtraWhere` 自动注入 `tenantField` filter
   - DB 层（可选）：PG RLS policy（emit + GUC SET）

## 技术栈一句话

| 模块     | 选型                                     | 备注                                |
| -------- | ---------------------------------------- | ----------------------------------- |
| 后端     | NestJS 10 + Prisma 5 + Express           | TypeScript                          |
| 前端     | Vite + React 18 + Ant Design + ReactFlow | TypeScript                          |
| 数据库   | PostgreSQL（元数据）；多方言（业务）     | 业务库扫描走 `@kintsugi/db-scanner` |
| LLM      | DeepSeek 默认；OpenAI 兼容协议           | provider 抽象在 `@kintsugi/llm`     |
| 限流     | 令牌桶；REDIS_URL 时切 Redis             | 默认内存版兜底                      |
| 认证     | JWT + cookie / Bearer / HMAC（OpenAPI）  | 三通道任选                          |
| 加密     | AES-256-GCM                              | DataSource 密码、AccessKey secret   |
| 追踪     | OpenTelemetry SDK                        | OTLP HTTP exporter                  |
| 测试     | vitest                                   | unit + 部分 integration             |
| 任务沙箱 | Node `vm` + child_process                | BFF 用                              |

## 仓库结构

```
apps/
  server/    NestJS 后端
  web/       Vite + React 控制台
  docs/      你正在看的这个站点（VitePress）
packages/
  shared/           错误码 / brand types / pagination
  db-scanner/       多方言 introspection
  llm/              LLM provider 抽象
  sdk/              @kintsugi/sdk（TS 客户端）
  cli/              kintsugi CLI（dev-time）
  runtime-cli/      运行态 agent-only CLI
  mcp-server/       MCP stdio JSON-RPC
  skills/ Skills 2.0
  mobile-sdk/       iOS Swift Package + Android Gradle module
deploy/
  docker-compose.yml      客户独立部署
  observability/          Grafana + Prometheus + runbook
  pm2/                    生产进程管理
docs/                     原产品资料抽取（reference only）
```

## 下一步

- **领域模型** → [Tenant / Application / Dataset](./tenant-application-dataset)
- **数据契约** → [DO（Dataset Object）](./do)
- **API 形态** → [Instant API](./instant-api)
- **权限体系** → [ABAC + RLS](./abac-rls)
- **扩展点** → [BFF 沙箱](./bff)
- **AI 接入** → [AI-Native 接入](./ai-native)
