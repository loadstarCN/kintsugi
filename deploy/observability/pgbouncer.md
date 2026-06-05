# pgBouncer 接入

为什么需要：

- Kintsugi server 单实例 Prisma 默认连接数 = `num_cpus * 2 + 1`（4 核机器约 9 条）。
- 上 PM2 多 worker / docker-compose 扩到 N 实例后连接数线性放大；托管 PostgreSQL 标准版默认 `max_connections` 仅几百，扩两台就紧张。
- 业务库（DataSource）的 adapter 是**短连接**（每请求开/关），瞬时风暴时也会顶到 RDS 连接上限。
- pgBouncer 负责把 N 个 client 短连接复用到 M 条上游长连接，M ≪ N。

不解决的事：

- pgBouncer 不替代 Prisma 自己的池——它**在两者之间**。
- 不解决慢查询；不替代 RDS 主从读写分离。

## 部署形态（推荐）

```
[Kintsugi server x N]      [Customer biz DB]
       │                          ▲
       ▼                          │
   pgBouncer (元数据用)        adapter 短连接 → 也可走另一个 pgBouncer
       │
       ▼
   托管 PostgreSQL PG (元数据)
```

- 元数据库前的 pgBouncer 是必装。
- 业务库前的 pgBouncer **可选**——客户的 DBA 决定，我们不强制。

## 模式选择：**transaction pooling**

```ini
[pgbouncer]
listen_addr = *
listen_port = 6432
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt

# Kintsugi 用 prisma：transaction 模式安全；session 模式必要时切回（见下）
pool_mode = transaction
default_pool_size = 25
max_client_conn = 1000

server_reset_query = DISCARD ALL
ignore_startup_parameters = extra_float_digits

[databases]
kintsugi = host=your-pg-host.example.com port=5432 dbname=kintsugi
```

`auth_file`（明文 SCRAM 用户）：

```
"kintsugi" "SCRAM-SHA-256$..."
```

## Prisma 配套

### 1. 必加 `?pgbouncer=true`

Prisma 的 connection string 必须显式声明走 pgbouncer，否则它会发 prepared statements，transaction-pooling 模式下会崩：

```bash
METADATA_DATABASE_URL="postgresql://kintsugi:URL_ENCODED@pgbouncer-host:6432/kintsugi?pgbouncer=true&sslmode=disable&connection_limit=20"
```

- `pgbouncer=true`：禁用 prisma 的 prepared statement 缓存。
- `connection_limit`：单 prisma 实例对 pgbouncer 拉的连接数，应 ≤ pgbouncer 的 `default_pool_size`。
- `sslmode=disable`：托管 PostgreSQL 不开 SSL，保持。

### 2. Prisma migrate / db push 用 directUrl

Prisma migrate 需要 advisory lock + DDL，必须直连 RDS（不能走 transaction-mode pgbouncer）。
schema.prisma:

```prisma
datasource db {
  provider     = "postgresql"
  url          = env("METADATA_DATABASE_URL")
  directUrl    = env("METADATA_DIRECT_URL")
}
```

`.env`：

```bash
METADATA_DATABASE_URL="postgresql://...:6432/kintsugi?pgbouncer=true&..."
METADATA_DIRECT_URL="postgresql://...:5432/kintsugi?sslmode=disable"
```

Migration 路径（push / migrate）走 `directUrl`，运行时走 `url`。

## Transaction pooling 的禁区

不能在同一个连接上跨语句保留 server 状态。Kintsugi 当前没用以下功能，所以安全：

- ❌ `LISTEN/NOTIFY`（PG 通知通道）—— 没用
- ❌ `SET LOCAL` 在事务外 —— 我们的 RLS GUC 注入 (`applySessionGuc`) 用的是 `SET`
  （session 级），跑在每条业务库连接的 connect 之后——业务库是另一个 pgBouncer 或直连，
  **元数据库连接不需要 SET GUC**。所以这条不影响。
- ❌ 临时表（`CREATE TEMP TABLE`）跨事务 —— 没用
- ❌ Prisma `$transaction([...])` 大于 30s —— 我们的事务都很短

如果将来要用上述，把对应路径切回 `pool_mode = session` 或绕开 pgbouncer 直连。

## 容量规划

| 场景                | pgBouncer `default_pool_size` | RDS `max_connections` | Prisma `connection_limit` |
| ------------------- | ----------------------------- | --------------------- | ------------------------- |
| 单 server / 4 核    | 10                            | 200（标准版）         | 9                         |
| 3 个 server / 4 核  | 25                            | 200                   | 9（每实例）               |
| 10 个 server / 4 核 | 50                            | 500（独享版）         | 9（每实例）               |

经验值：upstream pool ≈ 客户端实例数 × 平均并发查询数 / pgBouncer 复用率（80% 起步）。

## 监控

通过 `kintsugi_db_conn_in_flight` metric 看业务库的实时连接数（业务库 adapter）。
pgBouncer 自身的 metrics 走 `pgbouncer_exporter` 暴露给 Prometheus：

```yaml
# prometheus.yml
- job_name: 'pgbouncer'
  static_configs:
    - targets: ['pgbouncer-exporter:9127']
```

报警：见 `prometheus-rules.yaml`，关键的两条：

- `KintsugiBusinessDbConnLeak`（业务库连接泄漏）
- `KintsugiHighErrorRate5m`（pgBouncer 连不上时也会冒）

## 排障

| 现象                                                                              | 原因                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `prepared statement "S_1" does not exist`                                         | 没加 `?pgbouncer=true`，Prisma 的 PS 在 transaction 切换连接后失效               |
| `current transaction is aborted, commands ignored until end of transaction block` | 事务内某条失败但没 catch，pgBouncer 复用了这条 server 连接给下个 client          |
| migrate 卡住                                                                      | `migrate` 走了 pgBouncer，advisory lock 拿不到 → 用 `directUrl`                  |
| `password authentication failed`                                                  | `auth_file` 没配 SCRAM 哈希；用 `pg_dump` 拿 `pg_shadow.passwd` 抄进去           |
| 连接耗尽 5xx                                                                      | `default_pool_size` 太小；放宽并加 `kintsugi_db_conn_in_flight` panel 看真实需求 |

## 不接 pgBouncer 也能跑

如果你的 Kintsugi 实例只有 1-2 个 + 客户业务库不大，跳过 pgBouncer 也 OK。
本文档是给上规模后的部署形态做参考，不是"必须走"的步骤。
