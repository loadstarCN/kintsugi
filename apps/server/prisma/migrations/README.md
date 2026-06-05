# Prisma Migrations

## 历史

`20260503000000_initial_baseline/migration.sql` 是从当前生产 schema dump 出来的 **baseline**。
在此之前的所有 schema 都是 `prisma db push` 直接推到 RDS 的，没有审计记录。

## 日常工作流（schema 要改时）

**不要再用 `db push`**（除了"本地完全独立的开发库 + 知道自己在干嘛"的场景）。流程：

```bash
# 1. 改 prisma/schema.prisma
# 2. 在本地起一个干净的 PG（pg_ctl init / docker run --rm postgres）让 prisma 跑 dev migration
DATABASE_URL=postgresql://localhost:5432/kintsugi_migrate_local \
  pnpm --filter @kintsugi/server exec prisma migrate dev --create-only --name <短描述>

# 3. 生成的 SQL 在 prisma/migrations/<timestamp>_<name>/migration.sql
#    肉眼 review：CREATE INDEX CONCURRENTLY 漏没？DROP COLUMN 数据丢没？
#    改不掉的 destructive 步骤手工拆成两次 release（"先加新列" → "再清旧列"）

# 4. commit、PR、合并
git add prisma/migrations/<timestamp>_<name> prisma/schema.prisma
```

## 上线（prod / staging）

远端托管 PostgreSQL 用户没 CREATEDB 权限，跑不了 `prisma migrate dev`；用 `deploy` 子命令：

```bash
# 在 server 机器（或 CI deploy job）：
pnpm --filter @kintsugi/server exec prisma migrate deploy
```

`migrate deploy` 只**应用**未被记录的 migration，不会创建新 migration、不会
drop/recreate database。Idempotent；可以 stale-restart 反复跑。

## 接管旧库（baseline）

第一次部署到一个**已经存在 schema** 的 RDS（典型场景：之前用 db push 的库要切到 migration 流），
要先 baseline 防止 prisma 试图重跑 init：

```bash
pnpm --filter @kintsugi/server exec prisma migrate resolve \
  --applied 20260503000000_initial_baseline
```

resolve 之后 `_prisma_migrations` 元表里会有一条已 applied 记录；
之后 `migrate deploy` 才会从它之后开始。

## 灾难恢复 / DR 库新建

DR 演练或主库炸了从备份新建实例时，新库通常**已经**含全部 schema 了
（备份是 logical dump）。流程：

1. 新实例从备份恢复 → schema 已存在
2. `migrate resolve --applied 20260503000000_initial_baseline`
3. `migrate deploy` 跑后续 migration（如果备份点 < 最新 schema）

## `db push` 残留

`apps/server/package.json` 里仍保留 `prisma:push` script，是给：

- 本地开发起干净库快速启动用
- 紧急情况下"先改了 schema 但没 migration 文件"的临时手段

**生产环境永远不要用 `prisma:push`**——它绕过 `_prisma_migrations` 表，
其他实例下次 `migrate deploy` 时不会知道你改了什么。
