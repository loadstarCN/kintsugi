# 安装与启动

Kintsugi 的本地开发环境**不依赖 Docker**——所有进程原生跑。

## 前置要求

| 组件             | 版本        | 说明                                                         |
| ---------------- | ----------- | ------------------------------------------------------------ |
| Node.js          | ≥ 22 LTS    | 推荐用 [Volta](https://volta.sh) 管多版本                    |
| pnpm             | ≥ 9         | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| PostgreSQL       | 13+（远端） | 元数据库；本机不装，连托管 PostgreSQL / 自建均可             |
| DeepSeek API Key | —           | https://platform.deepseek.com/                               |
| Redis（可选）    | 6+          | 限流跨实例共享；不配置则用进程内内存版                       |

## 1. 拉代码

```bash
git clone https://github.com/LoadstarCN/kintsugi
cd kintsugi
pnpm install
```

## 2. 配 `.env`

复制模板：

```bash
cp .env.example .env
```

填以下三组：

```bash
# 元数据库（注意密码 URL 编码 + sslmode=disable 适用于托管 PostgreSQL）
METADATA_DATABASE_URL="postgresql://user:URL_ENCODED_PWD@host:5432/kintsugi?sslmode=disable"

# LLM provider（默认 DeepSeek）
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-v4-flash
LLM_API_KEY=sk-xxxxxx

# Redis 可选；不填走内存版
REDIS_URL=redis://user:URL_ENCODED_PWD@redis-host:6379/0
REDIS_KEY_NAMESPACE=kintsugi-prod-zk3p9wq2x7
```

::: tip 密码含特殊字符必须 URL 编码
`@` → `%40` / `:` → `%3A` / `/` → `%2F` / `#` → `%23` / `=` → `%3D` / `^` → `%5E`

一键转：

```bash
node -e "console.log(encodeURIComponent('你的密码'))"
```

:::

::: warning 托管 PostgreSQL 必须加 `?sslmode=disable`
RDS PG 默认不开 SSL；Prisma 默认要求 SSL，握手失败会被报成 P1001（"can't reach"）
误导性错误。加 `?sslmode=disable` 即解。
:::

## 3. 推 schema 到元数据库

**首次本地起干净库**：

```bash
pnpm --filter @kintsugi/server prisma:push
```

**部署到生产 RDS**（schema 通过 commit 进 git 的 migration 文件管理，可审计）：

```bash
# 已有 schema 的库（之前用 db push 或 baseline 时机）：先告诉 prisma 起点
pnpm --filter @kintsugi/server prisma:resolve-baseline

# 之后每次升级都跑 deploy（idempotent，可反复）
pnpm --filter @kintsugi/server prisma:deploy
```

::: tip 改 schema 怎么办
本地起一个独立 PG 库，用 `prisma:migrate:create --name <短描述>` 生成 migration
SQL，肉眼 review 后 commit。**不要用 `prisma:push` 直接改生产**——会绕过
`_prisma_migrations` 表，其他实例不知道你改了什么。详见
[`prisma/migrations/README.md`](https://github.com/LoadstarCN/kintsugi/blob/main/apps/server/prisma/migrations/README.md)。
:::

## 4. 启动

两个终端：

```bash
# Terminal 1
pnpm dev:server     # http://localhost:4000

# Terminal 2
pnpm dev:web        # http://localhost:5173
```

前端 `/api/*` 自动代理到 4000。

## 5. 注册第一个租户 + 用户

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"tenantCode":"demo","username":"alice","password":"alice123456"}'
```

返回 `{ token: "..." }`，可以直接用，也可以浏览器开 http://localhost:5173 用同样的账号密码登录。

## 上规模后的部署形态

单机本地开发完全用不上 pgBouncer，但做生产 / 多实例部署时务必接一个连接池：
N 个 Kintsugi server 单实例的 Prisma 池叠加起来很容易顶到 RDS 的 `max_connections`
上限。详见 [pgBouncer 接入指南](https://github.com/LoadstarCN/kintsugi/blob/main/deploy/observability/pgbouncer.md)。

## 排障

| 现象                                                  | 原因                                 | 解法                                                                   |
| ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------- |
| `P1001 Can't reach database server`                   | sslmode 没加                         | URL 加 `?sslmode=disable`                                              |
| `P3014 ... shadow database`                           | RDS 用户无 CREATEDB                  | 用 `prisma:migrate:create` 在本地建 migration，prod 跑 `prisma:deploy` |
| `[rate-limit] using Redis backend` 没出现             | REDIS_URL 没生效 / 白名单没加机器 IP | 检查 .env 拼写、托管 Redis 控制台白名单                                |
| 启动报 `ENCRYPTION_KEY or SESSION_SECRET must be set` | session secret 没配                  | `.env` 填 `SESSION_SECRET="32+ 位随机串"`                              |

下一步 → [5 分钟 quickstart](./quickstart)
