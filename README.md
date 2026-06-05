# Kintsugi （锦缮）

> **Read this in other languages:** **English** · [简体中文](./README.zh-CN.md)

**Point Kintsugi at a database connection string, and it reverse-engineers the schema into a business model and generates an AI-Native enterprise system around it** — admin console, REST API for every table, OpenAPI docs, multi-tenant RBAC, and first-class AI entry points (CLI · MCP · Agent Skills).

The generated artifacts are real, auditable code — not a black box. Standard CRUD is generated automatically; the long tail of custom logic is handled with sandboxed server-side functions (BFF), parameterized Custom SQL, and embedded React sub-apps.

> **Project status:** early-stage / actively evolving. Many subsystems are at "minimal viable with an end-to-end happy path." Treat it as a platform to build on and contribute to, not a turnkey product. See [`ROADMAP.md`](./ROADMAP.md) for what is done and what is pending.

---

## Why Kintsugi

Legacy business systems accumulate over years: missing docs, no declared foreign keys, undocumented business rules. Kintsugi's core idea is **asset reactivation** — read an existing database, recover its model without touching the running system, and project a modern, AI-callable layer on top of it.

- **DBAgent reverse engineering** — multi-dialect introspection + heuristic foreign-key inference + LLM-assisted review turns an opaque database into an ER graph and a typed business model.
- **White-box, auditable output** — generated React / BFF / SQL are real files you can commit, diff, and extend.
- **AI-Native, not AI-embedded** — the system exposes CLI, MCP, and Skills so AI agents can _operate_ the business, not just chat about it.
- **80 / 20** — 80% standard CRUD is auto-generated; the 20% of bespoke logic uses BFF + Custom SQL + React sub-apps.

---

## Features

| Area                       | Capabilities                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database understanding** | Multi-dialect introspection (PostgreSQL, MySQL; others stubbed), rule-based FK candidate detection, LLM batched review, incremental schema diff/sync, interactive ER graph              |
| **Instant API**            | Auto-generated REST per dataset: `filter / getOne / create / update / delete / batchCreate / aggregate / getSelectOptions`, with soft-delete, optimistic locking, and field allow-lists |
| **Data modeling**          | Dataset (Domain Object) editor, data browser, one-click "dataset from scan"                                                                                                             |
| **API surface**            | OpenAPI 3 + Swagger UI per app; TypeScript SDK; iOS / Android SDK scaffolds                                                                                                             |
| **Enterprise baseline**    | JWT + session auth, multi-tenant guard, audit interceptor, rate limiting, AES-256-GCM encryption at rest, RBAC, application-layer ABAC / RLS                                            |
| **Extensibility**          | BFF (sandboxed JS via `node:vm`) with a scoped client; Custom SQL with `#{param}` binding and risk grading; HMAC-SHA256 signed access keys                                              |
| **AI surface**             | Natural-language querying (NL → SQL), AI reports (NL → SQL + chart spec), Text-to-Page (LLM generates a React sub-app), CLI, MCP server, Agent Skills                                   |
| **Operations**             | OpenTelemetry tracing, asset import/export bundles, Docker / docker-compose deploy, IM bridge (e.g. Feishu webhook)                                                                     |

---

## Architecture

```
            ┌──────────────────────────── AI surface ────────────────────────────┐
            │   kintsugi CLI · kintsugi-runtime · MCP server · Agent Skills        │
            └─────────────────────────────────┬───────────────────────────────────┘
                                              │
  Browser ── apps/web (React + AntD) ──▶ apps/server (NestJS + Prisma) ──▶ Metadata DB (PostgreSQL)
                                              │
                              ┌───────────────┼────────────────┐
                              ▼               ▼                ▼
                        DBAgent          Instant API        BFF / Custom SQL
                     (introspect +      (auto CRUD +        (sandboxed logic +
                      LLM review)        OpenAPI)            parameterized SQL)
                              │
                              ▼
                   Your existing business databases (PostgreSQL / MySQL / …)
```

Kintsugi keeps a **metadata database** of its own (datasources, datasets/DOs, pages, BFF scripts, SQL, roles, audit). It connects _out_ to your existing business databases to introspect and to serve the Instant API.

---

## Monorepo layout

```
apps/
  server/     NestJS + Prisma backend (metadata, DBAgent, Instant API, BFF, auth, RBAC)
  web/        Vite + React + Ant Design + reactflow console
  docs/       VitePress documentation site
packages/
  shared/      Shared types, error codes, ID generation, pagination
  db-scanner/  DialectAdapter abstraction + PostgreSQL / MySQL adapters
  llm/         Pluggable LLM provider abstraction (OpenAI-compatible; DeepSeek by default)
  sdk/         @kintsugi/sdk — Instant API / BFF / SQL / Chats client
  cli/         @kintsugi/cli — dev-time CLI (bin: kintsugi)
  runtime-cli/ @kintsugi/runtime-cli — runtime agent CLI, exec-only (bin: kintsugi-runtime)
  mcp-server/  MCP stdio server
  skills/      Agent Skills package (dev-time + runtime SOPs)
  mobile-sdk/  iOS (Swift) + Android (Kotlin) SDK scaffolds
  feishu-bridge/ IM bridge package
  …            see ROADMAP.md for the full list
```

---

## Quick start

### Prerequisites

| Component   | Version | Notes                                                                  |
| ----------- | ------- | ---------------------------------------------------------------------- |
| Node.js     | ≥ 20.10 | 22 LTS recommended                                                     |
| pnpm        | ≥ 9     | `corepack enable && corepack prepare pnpm@9.12.0 --activate`           |
| PostgreSQL  | 13+     | Used for Kintsugi's own metadata. A managed/remote instance is fine.   |
| LLM API key | —       | DeepSeek by default (OpenAI-compatible); any compatible provider works |

> Docker is optional for local development — every process runs natively. A Docker deployment is provided under `deploy/`.

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set at least:
#   METADATA_DATABASE_URL   PostgreSQL connection string for Kintsugi's metadata DB
#   LLM_API_KEY             your LLM provider API key
#   SESSION_SECRET / JWT_SECRET / ENCRYPTION_KEY   (>= 32 bytes each in production)
#
# Tip: if your DB password contains special characters, URL-encode it:
#   node -e "console.log(encodeURIComponent('your-password'))"

# 3. Generate the Prisma client and apply migrations to the metadata DB
pnpm --filter @kintsugi/server prisma:generate
pnpm --filter @kintsugi/server prisma:migrate
```

### Run

```bash
# Terminal 1 — backend
pnpm dev:server     # http://localhost:4000

# Terminal 2 — frontend
pnpm dev:web        # http://localhost:5173  (proxies /api/* to :4000)
```

Then, from the console: add a data source → run a DBAgent scan → save a dataset → call the Instant API or ask a natural-language question.

---

## Configuration

All configuration is via environment variables; see [`.env.example`](./.env.example) for the full, documented list. Highlights:

- **`METADATA_DATABASE_URL`** — PostgreSQL connection string for Kintsugi's metadata DB (use `sslmode=require` in production).
- **`SESSION_SECRET` / `JWT_SECRET` / `ENCRYPTION_KEY`** — secrets. In production these are validated to be ≥ 32 bytes and the server fails fast otherwise. `ENCRYPTION_KEY` (AES-256-GCM) protects datasource passwords, webhook secrets, and access-key secrets — **losing it makes all encrypted data unrecoverable**.
- **`LLM_PROVIDER` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY`** — the LLM backend. Defaults to DeepSeek (OpenAI-compatible). Switch providers by changing env vars only.
- **`REDIS_URL`** — optional; enables Redis-backed rate limiting (the in-memory limiter is the default for development).

---

## Development

```bash
pnpm build         # build all packages and apps
pnpm typecheck     # typecheck the whole workspace
pnpm test          # run unit tests (vitest)
pnpm lint          # eslint, zero-warning gate
pnpm dev:docs      # run the VitePress docs site locally
pnpm --filter @kintsugi/server prisma:studio   # browse the metadata DB
```

---

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the current status and what is intentionally deferred (e.g. a Spring Boot standalone package, true PG row-level-security policies, a production-grade React sub-app sandbox, and mobile SDK publishing pipelines).

---

## Contributing

Issues and pull requests are welcome. Before opening a PR, please run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. For larger changes, open an issue first to discuss the design.

---

## License

Kintsugi is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [`LICENSE`](./LICENSE) for the full text.

In short: you may use, modify, and redistribute this software, but if you run a modified version to provide a network service, you must also make the corresponding source available to its users under the same license.
