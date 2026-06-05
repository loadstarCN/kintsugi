# Instant API 参考

每张 Dataset 自动得到 9 个端点。完整 swagger UI：

```
http://localhost:4000/api/apps/:appCode/docs
```

OpenAPI JSON：

```
http://localhost:4000/api/apps/:appCode/openapi.json
```

下面是手册形式的精简版。

## 路由前缀

```
/api/apps/:appCode/ds/:datasetCode/<action>
```

`appCode` 让 `TenantGuard` 卡死租户边界；`datasetCode` 是 32 字符全局唯一码。

## 1. POST `/filter` — 列表 + 筛选 + 分页

请求：

```json
{
  "where": [
    { "field": "status", "op": "eq", "value": "active" },
    { "field": "amount", "op": "gte", "value": 100 }
  ],
  "orderBy": [{ "field": "createdAt", "direction": "desc" }],
  "page": 1,
  "pageSize": 20,
  "includeDeleted": false
}
```

支持的 op：

| op                          | 说明                               |
| --------------------------- | ---------------------------------- |
| `eq` / `ne`                 | = / !=                             |
| `gt` / `gte` / `lt` / `lte` | 大小比较                           |
| `like` / `notLike`          | LIKE / NOT LIKE（要 `%` 自己加）   |
| `in` / `notIn`              | 数组；空数组语义化为 `1=0` / `1=1` |
| `isNull` / `isNotNull`      | NULL 判断                          |
| `between`                   | `value: [min, max]`                |

响应：

```json
{
  "data": [...],
  "page": 1,
  "pageSize": 20,
  "total": 142
}
```

`pageSize` 上限 1000（cap 在 SqlBuilder）。

## 2. GET `/:id` — 单条获取

按 PK；复合 PK 用 `;` 分隔：

```
GET /api/apps/X/ds/Y/123             # 单 PK
GET /api/apps/X/ds/Y/2026;05;A100    # 复合 PK
```

未找到 → 404 + `code: NOT_FOUND`。

## 3. POST `/` — 创建

```json
{ "name": "foo", "price": 99 }
```

响应（PG 走 RETURNING \*，MySQL 后续 SELECT）：

```json
{ "ok": true, "row": { "id": 123, "name": "foo", ... } }
```

## 4. PATCH `/:id` — 更新

```json
{ "price": 109 }
```

`expectedVersion` 字段（如 DO.versionField 配置）→ 乐观锁；冲突 409 + `code: BLOCKED_BY_CONCURRENT_EDIT`。

## 5. DELETE `/:id` — 删除

DO 配 `softDeleteField` → 自动转 UPDATE 设 `softDeleteField = 1`。
没配 → 真 DELETE。

```json
{ "ok": true, "softDeleted": true }
```

## 6. POST `/batchCreate` — 批量插入

```json
{
  "rows": [{ "name": "foo" }, { "name": "bar" }]
}
```

走单库 tx；任一行失败整批 ROLLBACK。

```json
{ "created": 2 }
```

## 7. POST `/aggregate` — 聚合

```json
{
  "groupBy": ["category"],
  "aggregates": [
    { "field": "id", "op": "count" },
    { "field": "amount", "op": "sum", "alias": "total" }
  ],
  "where": [...],
  "orderBy": [{"field":"total","direction":"desc"}],
  "limit": 100
}
```

支持的 op：`count` / `sum` / `avg` / `min` / `max`。

```json
{ "data": [{"category":"food","count":42,"total":1230.50}, ...] }
```

## 8. GET `/options/:field` — 下拉框选项

```
GET /api/apps/X/ds/Y/options/status
```

如果 DO.fields[].enumValues 配了 → 直接返回。
否则 → `SELECT DISTINCT field FROM table LIMIT 200`。

```json
{
  "options": [
    { "value": "active", "label": "active" },
    { "value": "off", "label": "off" }
  ]
}
```

## 9. Swagger / OpenAPI（自动生成，不算"端点"但官方门面）

```
GET /api/apps/:appCode/openapi.json
GET /api/apps/:appCode/docs           # Swagger UI
```

OpenAPI 3.0 spec，包含所有 dataset 的所有端点 + DO 推断的字段 schema。

## 自动注入的 WHERE

每条查询都被 server 追加：

1. **tenantField**：`tenant_code = ctx.user.tenantCode`（如 DO 声明）
2. **softDelete**：`is_deleted = 0`（如 DO 声明且 includeDeleted=false）
3. **dataRule**：scope `self/dept/role` 编译后的 filter

详见 [ABAC + RLS](/concepts/abac-rls)。

## 错误码总表

| code                         | HTTP | 含义                                            |
| ---------------------------- | ---- | ----------------------------------------------- |
| `NOT_FOUND`                  | 404  | dataset / appCode / id 不存在                   |
| `FORBIDDEN`                  | 403  | 跨 tenant / 跨 app / RBAC 拒绝 / actor 不允许   |
| `VALIDATION_FAILED`          | 400  | 字段校验、类型不匹配、SQL 语法、占位符未绑定等  |
| `BLOCKED_BY_CONCURRENT_EDIT` | 409  | 乐观锁冲突                                      |
| `RATE_LIMITED`               | 429  | 触发限流；响应有 `Retry-After` header           |
| `LLM_UPSTREAM_ERROR`         | 502  | LLM 服务异常（仅 chats / reports / pages 路径） |
| `BFF_ERROR`                  | 500  | BFF 沙箱抛错                                    |
| `INTERNAL_ERROR`             | 500  | 兜底；server 日志查 stack                       |

## 三种认证

| 通道   | Header                                                     | 示例             |
| ------ | ---------------------------------------------------------- | ---------------- |
| Cookie | `Cookie: kintsugi_session=<jwt>`                           | 控制台浏览器     |
| Bearer | `Authorization: Bearer <jwt>`                              | SDK / CLI / cURL |
| HMAC   | `X-Access-Key` / `X-Signature` / `X-Timestamp` / `X-Nonce` | OpenAPI / Agent  |

详见 [HMAC 签名规范](/guides/hmac)。

## 限流

| scope             | 默认配额 | 环境变量                         |
| ----------------- | -------- | -------------------------------- |
| 通用（每分钟）    | 600      | `RATE_LIMIT_PER_MIN`             |
| 通用（每小时）    | 10000    | `RATE_LIMIT_PER_HOUR`            |
| 通用（每天）      | 100000   | `RATE_LIMIT_PER_DAY`             |
| 登录暴破          | 5/min    | `LOGIN_RATE_LIMIT_PER_MIN`       |
| AccessKey 创建    | 10/min   | `ACCESS_KEY_CREATE_RATE_PER_MIN` |
| AI 端点（每分钟） | 10       | `AI_RATE_LIMIT_PER_MIN`          |
| AI 端点（每小时） | 200      | `AI_RATE_LIMIT_PER_HOUR`         |

Redis-backed（`REDIS_URL` 设置后自动接管）。

响应头：`X-RateLimit-Scope` / `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `Retry-After`。
