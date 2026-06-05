# Instant API

每张 Dataset 自动得到 9 个 HTTP 端点，**不需要写任何代码**。

## URL 形态

```
/api/apps/:appCode/ds/:datasetCode/<action>
```

`appCode` 是为了让 `TenantGuard` 卡死租户边界；`datasetCode` 是 32 字符的全局唯一码。

## 9 个端点

| Method | Action                           | 说明                                     |
| ------ | -------------------------------- | ---------------------------------------- |
| POST   | `filter`                         | 列表 + 分页 + filter + orderBy（默认）   |
| GET    | `:id`                            | 单条获取（按 PK）                        |
| POST   | （无）                           | 创建                                     |
| PATCH  | `:id`                            | 更新                                     |
| DELETE | `:id`                            | 删除（软删除优先）                       |
| POST   | `batchCreate`                    | 批量插入                                 |
| POST   | `aggregate`                      | group by + 聚合（count/sum/avg/min/max） |
| GET    | `options/:field`                 | 用于下拉框：枚举值或 `SELECT DISTINCT`   |
| —      | （上面 9 项的 OpenAPI 自动生成） | swagger UI                               |

## filter 请求结构

```json
{
  "where": [
    { "field": "status", "op": "eq", "value": "active" },
    { "field": "amount", "op": "gte", "value": 100 },
    { "field": "name", "op": "like", "value": "%foo%" }
  ],
  "orderBy": [{ "field": "createdAt", "direction": "desc" }],
  "page": 1,
  "pageSize": 20,
  "includeDeleted": false
}
```

支持的 op：

```
eq, ne, gt, gte, lt, lte, like, notLike, in, notIn, isNull, isNotNull, between
```

## 自动注入

每条 SQL 查询前会**自动追加** `extraWhere`：

1. **tenantField 强隔**：`tenantField = ctx.user.tenantCode`
2. **softDelete 兜底**：`softDeleteField = 0`（除非 `includeDeleted: true`）
3. **dataRule 编译**：scope `self/dept/role` → 对应 filter

详见 [ABAC + RLS](./abac-rls)。

## 安全保障

- **列白名单**：`columns` 必须来自 `DO.fields`；非法字符 / DO 没声明的列直接 reject
- **参数化**：`adapter.placeholder($1 / ?)`；不拼字符串，SQL 注入零路径
- **DELETE without WHERE 拒绝**：`SqlBuilder.buildDelete` 显式检查
- **PG GUC 注入**：连接建立后 `SET kintsugi.tenant/user_id/dept_ids`，让客户启用的 RLS policy 知道当前 session 是谁

## 响应形态

```json
{
  "data": [...],
  "page": 1,
  "pageSize": 20,
  "total": 142
}
```

错误：

```json
{
  "code": "VALIDATION_FAILED",
  "message": "field 'foo' not in DO",
  "detail": { ... }
}
```

错误码列表：

| code                         | HTTP | 含义                                   |
| ---------------------------- | ---- | -------------------------------------- |
| `NOT_FOUND`                  | 404  | dataset / appCode 不存在               |
| `FORBIDDEN`                  | 403  | 跨 tenant / 跨 app                     |
| `VALIDATION_FAILED`          | 400  | 字段校验                               |
| `BLOCKED_BY_CONCURRENT_EDIT` | 409  | 乐观锁冲突                             |
| `RATE_LIMITED`               | 429  | 触发限流                               |
| `LLM_UPSTREAM_ERROR`         | 502  | LLM 服务异常（仅 chats/reports/pages） |

## 三种认证方式

| 通道           | Header                                               | 适用场景       |
| -------------- | ---------------------------------------------------- | -------------- |
| Cookie session | `Cookie: kintsugi_session=...`                       | 控制台浏览器   |
| Bearer token   | `Authorization: Bearer <jwt>`                        | SDK、CLI、cURL |
| HMAC AccessKey | `X-Access-Key`/`X-Signature`/`X-Timestamp`/`X-Nonce` | OpenAPI、Agent |

HMAC 详见 [HMAC 签名规范](/guides/hmac)。

## SDK

`@kintsugi/sdk` 把 9 个端点包成 typed client：

```ts
import { createClient } from '@kintsugi/sdk';

const k = createClient({ baseUrl: 'http://localhost:4000', token: '...' });
const r = await k.dataset('goods').filter({ where: [{ field: 'price', op: 'gte', value: 10 }] });
const one = await k.dataset('goods').getOne('123');
const created = await k.dataset('goods').create({ name: 'foo', price: 99 });
```

## 限制

- LIMIT 上限 1000（cap 在 `SqlBuilder`）
- 跨表 JOIN 最多 5 层（DO.relations 链 + Instant API JOIN 层级）
- 复合 PK 的批量 update 暂不支持，需走 BFF 自定义
