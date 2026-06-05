# apps/server/scripts

调试 / 一次性运维脚本。**不要再硬编码 DB 凭证**——共享 `_pg-creds.mjs` 强制走 env。

## 长期保留（package.json 有 npm script）

| 脚本                            | 用途                                       | 调用                                             |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `bootstrap-demo.ts`             | 把 demo 租户 + 应用一键起出来              | `pnpm --filter @kintsugi/server bootstrap:demo`  |
| `dbagent-eval.ts`               | DBAgent 关系推理离线评估 + 22 fixture      | `pnpm --filter @kintsugi/server dbagent:eval`    |
| `llm-eval.ts`                   | LLM prompt 模板回归（mock 模式 = CI 默认） | `pnpm --filter @kintsugi/server llm:eval`        |
| `check-platform-spec.ts`        | OpenAPI snapshot drift CI gate             | `pnpm --filter @kintsugi/server spec:check`      |
| `cleanup-bcrypt-access-keys.ts` | 清掉旧版 bcrypt access key 残留            | `pnpm --filter @kintsugi/server bcrypt:cleanup`  |
| `test-introspect.ts`            | 诊断 db-scanner introspect 性能            | `pnpm --filter @kintsugi/server test:introspect` |

## 一次性诊断脚本（无 npm script，直接跑）

跑法：`node -r @swc-node/register apps/server/scripts/<file>` 或 `node apps/server/scripts/<file>.mjs`。

**前置**：在 `.env` 设 `DEBUG_PG_HOST` / `DEBUG_PG_USER` / `DEBUG_PG_PASSWORD`（或 `DEBUG_DATABASE_URL`），脚本通过 `_pg-creds.mjs` 共享 helper 读取。

| 脚本                         | 用途                                            |
| ---------------------------- | ----------------------------------------------- |
| `check-db.mjs`               | 列出 RDS 上 goods% 数据库（quick sanity check） |
| `inspect-accounts.mjs`       | 看 `goods_test.accounts` 表结构 + 前 3 行       |
| `probe-goods-test.mjs`       | 列 `goods_test` 全部 public table               |
| `scan-pii-candidates.mjs`    | 用正则扫 PII 字段候选（name/email/phone/...）   |
| `redact-accounts.mjs`        | 脱敏 `goods_test.accounts` 表（destructive）    |
| `redact-all-pii.mjs`         | 批量脱敏 `goods_test` 多表（destructive）       |
| `list-ds.ts`                 | 列元数据库的 datasource                         |
| `switch-ds-to-goods-test.ts` | 把 datasource 切到 goods_test                   |
| `test-bff-worker.ts`         | BFF worker pool 冒烟                            |
| `test-readonly.ts`           | 验证业务库 read-only 连接行为                   |

> **destructive 脚本** 会改业务表数据，跑之前确认连的是 `goods_test` 不是生产 `goods`。

## 凭证泄漏 incident

历史 init commit 里曾把 RDS 凭证 `mart / uur0fG66a3TpYW9idrgY @ pgm-uf62fqy9bb0r51539o`
写死在多个 `.mjs` 里。round-9 已：

1. 改读 env via `_pg-creds.mjs`
2. ⚠️ 凭证仍在 git history 里，需要外部 rotate RDS 密码 + 决定是否 BFG 清史
