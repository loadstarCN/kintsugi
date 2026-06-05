# Kintsugi （锦缮）

> **其他语言：** [English](./README.md) · **简体中文**

**给 Kintsugi 一个数据库连接字符串，它会逆向解析出业务模型，并围绕它生成一套 AI-Native 企业系统** —— 管理后台、每张表的 REST 接口、OpenAPI 文档、多租户 RBAC，以及一等公民的 AI 调用入口（CLI · MCP · Agent Skills）。

生成的产物是**真实、可审计的代码**，不是黑盒。标准 CRUD 自动生成；个性化的长尾逻辑用沙箱化的服务端函数（BFF）、带参数绑定的 Custom SQL，以及内嵌的 React 子应用来承接。

> **项目状态：** 早期、持续演进中。许多子系统处于"最小可用 + 端到端 happy path"阶段。请把它当作一个可以在其上构建、可以参与贡献的平台，而非开箱即用的成品。已完成项与待办项见 [`ROADMAP.md`](./ROADMAP.md)。

---

## 为什么是 Kintsugi

企业业务系统是多年沉淀下来的：文档丢失、没有声明外键、业务规则散落在代码里。Kintsugi 的核心思路是**资产盘活** —— 读取既有数据库，在不动线上系统的前提下还原其模型，并在其上投射一层现代化、可被 AI 调用的能力。

- **DBAgent 逆向解析** —— 多方言 introspection + 启发式外键推断 + LLM 复核，把不透明的数据库还原成 ER 图和带类型的业务模型。
- **白盒、可审计** —— 生成的 React / BFF / SQL 是真实文件，可以进 git、可 diff、可二次开发。
- **AI-Native，而非 AI-Embedded** —— 系统天生暴露 CLI、MCP、Skills，让 AI Agent 能*操作*业务，而不只是聊聊。
- **80 / 20** —— 80% 标准 CRUD 自动生成；20% 个性化逻辑用 BFF + Custom SQL + React 子应用扩展。

---

## 功能一览

| 领域            | 能力                                                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **数据库理解**  | 多方言 introspection（PostgreSQL、MySQL；其余留桩）、规则层外键候选识别、LLM 分批复核、增量 schema diff/sync、交互式 ER 图                          |
| **Instant API** | 每个 dataset 自动生成 REST：`filter / getOne / create / update / delete / batchCreate / aggregate / getSelectOptions`，带软删除、乐观锁、字段白名单 |
| **数据建模**    | Dataset（Domain Object）编辑器、数据浏览器、一键"从扫描结果落库 dataset"                                                                            |
| **接口面**      | 每个应用的 OpenAPI 3 + Swagger UI；TypeScript SDK；iOS / Android SDK 脚手架                                                                         |
| **企业底座**    | JWT + session 鉴权、多租户隔离、审计拦截器、速率限制、AES-256-GCM 落盘加密、RBAC、应用层 ABAC / RLS                                                 |
| **可扩展性**    | BFF（`node:vm` 沙箱）+ 受限 client；Custom SQL 带 `#{param}` 绑定与风险分级；HMAC-SHA256 签名 AccessKey                                             |
| **AI 能力面**   | 自然语言问数（NL → SQL）、AI 报表（NL → SQL + 图表规格）、Text-to-Page（LLM 生成 React 子应用）、CLI、MCP server、Agent Skills                      |
| **运维**        | OpenTelemetry 链路追踪、资产导入/导出 bundle、Docker / docker-compose 部署、IM Bridge（如飞书 webhook）                                             |

---

## 架构

```
            ┌──────────────────────────── AI 调用面 ──────────────────────────────┐
            │   kintsugi CLI · kintsugi-runtime · MCP server · Agent Skills        │
            └─────────────────────────────────┬───────────────────────────────────┘
                                              │
   浏览器 ── apps/web (React + AntD) ──▶ apps/server (NestJS + Prisma) ──▶ 元数据库 (PostgreSQL)
                                              │
                              ┌───────────────┼────────────────┐
                              ▼               ▼                ▼
                          DBAgent         Instant API       BFF / Custom SQL
                      (introspect +      (自动 CRUD +       (沙箱逻辑 +
                       LLM 复核)          OpenAPI)          参数化 SQL)
                              │
                              ▼
                     你既有的业务数据库 (PostgreSQL / MySQL / …)
```

Kintsugi 维护一个**自己的元数据库**（数据源、dataset/DO、页面、BFF 脚本、SQL、角色、审计）。它再**向外**连接你既有的业务数据库，用于 introspection 以及对外提供 Instant API。

---

## 仓库结构

```
apps/
  server/     NestJS + Prisma 后端（元数据、DBAgent、Instant API、BFF、鉴权、RBAC）
  web/        Vite + React + Ant Design + reactflow 控制台
  docs/       VitePress 文档站
packages/
  shared/      共享类型、错误码、ID 生成、分页
  db-scanner/  DialectAdapter 抽象 + PostgreSQL / MySQL 适配器
  llm/         可插拔 LLM provider 抽象（OpenAI 兼容；默认 DeepSeek）
  sdk/         @kintsugi/sdk —— Instant API / BFF / SQL / Chats 客户端
  cli/         @kintsugi/cli —— 开发态 CLI（bin: kintsugi）
  runtime-cli/ @kintsugi/runtime-cli —— 运行态 agent CLI，只 exec 不 list（bin: kintsugi-runtime）
  mcp-server/  MCP stdio server
  skills/      Agent Skills 包（开发态 + 运行态 SOP）
  mobile-sdk/  iOS (Swift) + Android (Kotlin) SDK 脚手架
  feishu-bridge/ IM Bridge 包
  …            完整列表见 ROADMAP.md
```

---

## 快速开始

### 前置要求

| 组件        | 版本    | 说明                                                         |
| ----------- | ------- | ------------------------------------------------------------ |
| Node.js     | ≥ 20.10 | 建议 22 LTS                                                  |
| pnpm        | ≥ 9     | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| PostgreSQL  | 13+     | 用作 Kintsugi 自身的元数据库；远端/托管实例即可              |
| LLM API Key | —       | 默认 DeepSeek（OpenAI 兼容）；任何兼容 provider 均可         |

> 本地开发不强制 Docker，所有进程本地原生起。`deploy/` 下提供了一套 Docker 部署。

### 初始化

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，至少填：
#   METADATA_DATABASE_URL   Kintsugi 元数据库的 PostgreSQL 连接串
#   LLM_API_KEY             你的 LLM provider API key
#   SESSION_SECRET / JWT_SECRET / ENCRYPTION_KEY   （生产环境各需 >= 32 字节）
#
# 提示：密码含特殊字符时先做 URL 编码：
#   node -e "console.log(encodeURIComponent('你的密码'))"

# 3. 生成 Prisma 客户端并把 migration 应用到元数据库
pnpm --filter @kintsugi/server prisma:generate
pnpm --filter @kintsugi/server prisma:migrate
```

### 启动

```bash
# 终端 1 —— 后端
pnpm dev:server     # http://localhost:4000

# 终端 2 —— 前端
pnpm dev:web        # http://localhost:5173 （/api/* 自动代理到 :4000）
```

随后在控制台里：新建数据源 → 跑 DBAgent 扫描 → 落库 dataset → 调用 Instant API 或自然语言问数。

---

## 配置

所有配置走环境变量，完整带注释的清单见 [`.env.example`](./.env.example)。要点：

- **`METADATA_DATABASE_URL`** —— Kintsugi 元数据库的 PostgreSQL 连接串（生产强制 `sslmode=require`）。
- **`SESSION_SECRET` / `JWT_SECRET` / `ENCRYPTION_KEY`** —— 密钥。生产环境会校验 ≥ 32 字节，否则启动 fail-fast。`ENCRYPTION_KEY`（AES-256-GCM）用于加密数据源密码、webhook secret、accessKey secret —— **丢失则所有加密数据无法恢复**。
- **`LLM_PROVIDER` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY`** —— LLM 后端。默认 DeepSeek（OpenAI 兼容）。换 provider 只改环境变量。
- **`REDIS_URL`** —— 可选；启用后速率限制走 Redis（默认内存版，适合开发）。

---

## 开发命令

```bash
pnpm build         # 构建全部包与应用
pnpm typecheck     # 全 workspace typecheck
pnpm test          # 单元测试（vitest）
pnpm lint          # eslint，零警告门禁
pnpm dev:docs      # 本地起 VitePress 文档站
pnpm --filter @kintsugi/server prisma:studio   # 浏览元数据库
```

---

## Roadmap

当前状态与刻意延后的事项见 [`ROADMAP.md`](./ROADMAP.md)（例如 Spring Boot 独立部署二方包、真正的 PG 行级安全策略、生产级 React 子应用沙箱、移动端 SDK 发布流水线等）。

---

## 贡献

欢迎 issue 与 PR。提 PR 前请先跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`。较大的改动建议先开 issue 讨论设计。

---

## 许可证

Kintsugi 采用 **GNU Affero General Public License v3.0**（AGPL-3.0）。完整条款见 [`LICENSE`](./LICENSE)。

简言之：你可以使用、修改、再分发本软件，但如果你运行修改后的版本对外提供网络服务，你必须以同样的许可证向其用户提供对应的源代码。
