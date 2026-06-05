# 写 Custom SQL

Custom SQL 是平台的"逃生口"——Instant API + BFF 都搞不定的时候用原生 SQL。

适用：

- 复杂报表（多 JOIN + 子查询 + 窗口函数）
- 批量数据维护
- 跨表事务（一条复杂 SQL 比多个 BFF 调用更原子）

## 占位符

Kintsugi 用 `#{name}` 占位符，**不是** `?` 也**不是** `$1`：

```sql
SELECT id, name, price
FROM goods
WHERE category = #{category}
  AND price BETWEEN #{minPrice} AND #{maxPrice}
ORDER BY created_at DESC
LIMIT #{limit}
```

server 在执行前自动转换：

- pg 方言 → `$1, $2, $3, $4`
- mysql 方言 → `?, ?, ?, ?`

不存在 SQL 注入风险——参数永远走 prepared statement。

## paramsSchema

声明参数类型 + 必填，server 验证后才执行：

```json
{
  "category": { "type": "string", "required": true },
  "minPrice": { "type": "number", "required": true, "default": 0 },
  "maxPrice": { "type": "number", "required": true },
  "limit": { "type": "number", "required": false, "default": 100 }
}
```

支持的 type：`string` / `number` / `int` / `bool` / `datetime` / `date`。

## 落库

```bash
curl -X POST http://localhost:4000/api/sql \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "appCode": "app-shop0001",
    "dataSourceId": "<dsId>",
    "sqlName": "goods_by_category",
    "content": "SELECT ... WHERE category = #{category} ...",
    "paramsSchema": { "category": {"type":"string","required":true}, "limit": {"type":"number","default":100} }
  }'
```

返回 `{ sqlCode: "sq_xxx" }`。

## 执行

```bash
curl -X POST http://localhost:4000/api/sql/sq_xxx/execute \
  -H "authorization: Bearer $TOKEN" \
  -d '{"params":{"category":"electronics"}}'
# → { data: [...], rowCount: 23, riskLevel: "low" }
```

## riskLevel 自动分类

server 看 SQL 内容自动打标签：

| 关键词命中                                                    | riskLevel  | 谁能跑                                     |
| ------------------------------------------------------------- | ---------- | ------------------------------------------ |
| 仅 `SELECT`                                                   | `low`      | 任何人；强制 READ ONLY tx                  |
| `INSERT` / `UPDATE` / `MERGE`                                 | `medium`   | human actor（JWT 路径）                    |
| `DELETE` / `TRUNCATE` / `DROP` / `ALTER` / `GRANT` / `REVOKE` | `critical` | 仅 human actor + 显式 sqlSafe=false 才允许 |

### actor 区分

| 通道                              | actor   | 限制                                                                                                |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| JWT（控制台 / SDK token）         | `human` | medium 可跑、critical 可跑                                                                          |
| AccessKey（HMAC OpenAPI / Agent） | `ai`    | medium 跑 readonly tx；critical 拒绝；命中 BLOCKED_BY_AI 关键字（`drop`/`truncate`/`grant` 等）拒绝 |

::: danger 不能从 body 传 actor
之前 v0 接受 `body.actor`，被 round-5 hardening 修掉了——server 端从 auth context 派生，无法被客户端伪造。
:::

## sqlSafe 模式

调用时传 `sqlSafe: true`，遇到拒绝 / 出错时**返回结构化错误**而不是抛异常：

```json
{
  "params": {...},
  "sqlSafe": true
}
```

返回：

```json
{
  "data": null,
  "error": "AI actor cannot execute critical SQL",
  "rowCount": 0,
  "riskLevel": "critical"
}
```

适合 Agent 调用——它能根据 error 字段决定下一步。

## RLS GUC 注入

跑 SQL 时如果你的 user ctx 有 `tenantCode` / `userId`，server 自动在 PG 连接上 SET GUC：

```sql
SET "kintsugi.tenant" = 'demo';
SET "kintsugi.user_id" = 'u-001';
-- 你的 SQL ...
```

客户启用了 RLS policy 时这个能让 Custom SQL 也"知道当前是谁在跑"，不会被自己的 policy 挡掉。

## 在 BFF 里调

```js
exports.handler = async (ctx) => {
  const r = await ctx.client.sql.execute('goods_by_category', { category: 'food' });
  return r.data;
};
```

tx 内调用绑定外层连接，不另开。

## AI 写 SQL

通过 [MCP Tool](/reference/mcp) `write_sql` 创建 / 更新；`execute_sql` 跑：

```json
{
  "name": "write_sql",
  "arguments": {
    "appCode": "app-shop0001",
    "sqlName": "goods_by_category",
    "content": "SELECT ...",
    "paramsSchema": {...}
  }
}
```

::: tip 让 Agent 先 validate 再 execute
推荐让 Agent 先调 `validate_sql_content`：返回 riskLevel + 占位符列表 + 语法错误。pass 后再 `execute_sql`。
:::

## 排障

| 错误                                   | 含义                                  |
| -------------------------------------- | ------------------------------------- |
| `placeholder #{x} not in paramsSchema` | params 没声明却出现在 SQL             |
| `param x type mismatch`                | 实参类型不符 schema                   |
| `AI actor cannot execute critical SQL` | 用 access key 想跑 DROP / TRUNCATE 等 |
| `placeholder #{x} not bound`           | params 缺值                           |
