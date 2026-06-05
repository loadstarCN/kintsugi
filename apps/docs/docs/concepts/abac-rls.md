# ABAC + RLS

Kintsugi 的行级权限**有两层**——应用层 + 数据库层——可以单独开任一层，也可以同时开。

## 应用层（默认开，不可关）

每次 Instant API / BFF 调用，server 在生成的 SQL 里**自动追加 WHERE**：

```sql
-- 用户原始请求 + 自动注入：
SELECT ... FROM goods
WHERE name LIKE '%foo%'                     -- 用户自己的 filter
  AND tenant_code = $kintsugi_tenant         -- ← DO.tenantField 注入
  AND owner_id = $kintsugi_user              -- ← DO.dataRule scope=self
  AND is_deleted = 0                         -- ← DO.softDeleteField
```

注入逻辑在 `compileRlsClauses(doJson, ctx.user)`，规则：

| DO 配置                                                                               | 注入                                     |
| ------------------------------------------------------------------------------------- | ---------------------------------------- |
| `tenantField: 'tenant_code'`                                                          | 强制 `tenant_code = ctx.user.tenantCode` |
| `dataRule.scope = 'self'`                                                             | `userField = ctx.user.userId`            |
| `dataRule.scope = 'dept'`                                                             | `field IN ctx.user.deptIds`              |
| `dataRule.scope = 'role'`, `rule = 'status = "active" AND owner_id = ${user.userId}"` | 编译表达式追加多条 clause                |

::: warning 应用层兜不住"绕过 Instant API 直连库"
SDK 走 Instant API → 安全；但客户 DBA 拿到业务库账号直接 `psql` 进去 → 应用层注入完全失效。
要彻底兜住，必须打开 DB 层。
:::

## 数据库层（PG only，需手动启用）

PostgreSQL 原生支持 `Row Level Security`：

```sql
ALTER TABLE goods ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods FORCE ROW LEVEL SECURITY;

CREATE POLICY "kintsugi_goods_tenant" ON goods
USING ("tenant_code" = current_setting('kintsugi.tenant', true)
       OR current_setting('kintsugi.bypass', true) = 'on');
```

`current_setting('kintsugi.tenant', true)` 读 PG 自定义 GUC（grand unified configuration）；返回 NULL 时 `current_setting` 用 `true` 防抛错。

### 怎么生成 policy SQL

```bash
GET /api/datasets/:datasetCode/rls-policy
```

输出：

```json
{
  "dialect": "postgres",
  "table": "goods",
  "schema": "public",
  "sql": "ALTER TABLE \"public\".\"goods\" ENABLE ROW LEVEL SECURITY;\n...",
  "dropSql": "DROP POLICY IF EXISTS ...",
  "policies": [
    { "name": "kintsugi_goods_tenant", "using": "...", "check": "..." },
    { "name": "kintsugi_goods_self", "using": "...", "check": "..." }
  ],
  "warnings": []
}
```

**Kintsugi 不替你跑这个 DDL**——把 SQL 给客户 DBA，他们 review 后自行 apply。

### Kintsugi 自己怎么不被 policy 挡

Server 在每条业务连接 connect 后会 `SET kintsugi.tenant/user_id/dept_ids`：

```sql
SET "kintsugi.tenant" = 'demo';
SET "kintsugi.user_id" = 'u-001';
SET "kintsugi.dept_ids" = 'd1,d2';
```

policy 的 `current_setting('kintsugi.tenant', true) = 'demo'` 命中，本租户的行可见，其他租户的行不可见。代码路径：

- `DataSourceService.openAdapter(id, sessionCtx)` 接收 ctx
- PG 方言时调 `applySessionGuc()` 跑 SET
- 非 PG 方言（mysql）no-op

### bypass 通道

policy 表达式都带 `OR current_setting('kintsugi.bypass', true) = 'on'`。

DBA 在跑数据迁移 / 紧急修数据时：

```sql
SET "kintsugi.bypass" = 'on';
-- 后续 DDL/DML 不被 policy 限制
```

::: danger 业务路径绝对不能开 bypass
应用代码任何路径都不应该 SET kintsugi.bypass = 'on'。这是给 DBA 的逃生口，不是 feature flag。
:::

## 推荐启用顺序

```
v0：只开应用层（默认）        — 出货态
v1：开 PG RLS 但不 FORCE     — 客户业务账号生效，应用账号仍 bypass
v2：FORCE RLS                 — 完全收敛，DBA 也要 SET bypass 才能跨权
```

## ABAC 表达式语法（dataRule.rule）

```
field <op> 'literal'           → "field" = 'literal'
field <op> ${user.userId}      → "field" = current_setting('kintsugi.user_id', true)
field <op> ${user.tenantCode}  → "field" = current_setting('kintsugi.tenant', true)
field1 <op> v1 AND field2 ...  → 多条 AND
```

支持的 op：`= != > >= < <=`。**不支持** OR / IN / 子查询/函数调用 —— 复杂规则用 BFF 解决。

## 测试覆盖

| 路径                  | 测试                             |
| --------------------- | -------------------------------- |
| `compileRlsClauses`   | `rls.spec.ts`（8 cases）         |
| `emitRlsPolicy`       | `rls-policy.spec.ts`（10 cases） |
| `applySessionGuc`     | `rls-policy.spec.ts`（4 cases）  |
| `emitSetLocalSnippet` | `rls-policy.spec.ts`（2 cases）  |

## HMAC（AccessKey）路径

### 默认（未绑 user）

```sql
SET "kintsugi.tenant" = '<tenant-of-app>';
-- kintsugi.user_id 不设
```

- tenant scope policy 命中（同租户 OK，跨租户挡）
- user-scope policy（`scope=self`）默认**不命中** —— `kintsugi.user_id` 是空字符串，policy USING 拒绝

这是给**系统级**集成用的，例如 ETL pipeline、数据同步服务。

### 绑了 user（boundUserId）

创建 access key 时传 `boundUserId`：

```bash
POST /api/access-keys
{
  "appCode": "app-shop0001",
  "boundUserId": "u-001",      // 把这条 key 绑给用户 u-001
  "expiresInDays": 90
}
```

绑了之后 HMAC 验签时一并注入 `user_id`：

```sql
SET "kintsugi.tenant" = '...';
SET "kintsugi.user_id" = 'u-001';
```

- scope=self policy 命中——这条 key 等同于"用户 u-001 在跑请求"
- audit log 也按 u-001 记录

### 选哪种

| 场景                                            | 用法           |
| ----------------------------------------------- | -------------- |
| 后端服务调内部 API，不区分谁触发                | 不绑 user      |
| 给最终用户发个人 token（Personal Access Token） | 绑 boundUserId |
| 第三方 OAuth 集成（每个 user 一份 token）       | 绑 boundUserId |

::: warning 跨租户绑定被拒
`assertUserInTenant` 会校验 boundUserId 与 app 同租户；不一致直接 FORBIDDEN。
:::

## 待补

- LLM 助手：根据自然语言描述生成 dataRule 表达式
- 自动 OAuth → 短期 access key 发放（per-user token 流程的工具化）
