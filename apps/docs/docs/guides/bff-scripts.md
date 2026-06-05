# 写 BFF 脚本

BFF 是用户写的 JS，在沙箱里跑，能调 dataset / SQL / 第三方 API，并保证事务一致性。

::: tip 先看
[BFF 沙箱](/concepts/bff) 介绍了进程隔离 + 安全模型。这一篇专讲**怎么写**。
:::

## 最小例子

```js
exports.handler = async (ctx) => {
  return { hello: ctx.userInfo?.username ?? 'anon', input: ctx.input };
};
```

落库：

```bash
curl -X POST http://localhost:4000/api/bff \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "appCode": "app-shop0001",
    "scriptName": "hello",
    "type": "ENDPOINT",
    "code": "exports.handler = async (ctx) => ({ hello: ctx.userInfo?.username });"
  }'
```

调用：

```bash
curl -X POST http://localhost:4000/api/bff/exec/app-shop0001/hello \
  -H "authorization: Bearer $TOKEN" \
  -d '{"input":{}}'
# → { "data": { "hello": "alice" }, "logs": [] }
```

## ctx API 速览

```ts
{
  userInfo: { userId, tenantCode, username } | null,
  input: <调用方传的 body.input>,

  client: {
    // 9 个 Instant API 端点的 typed proxy
    models: {
      goods: {
        filter(req): Promise<{ data, page, pageSize, total }>,
        getOne(id): Promise<row>,
        create(data): Promise<row>,
        update(id, data): Promise<row>,
        delete(id): Promise<{ ok, softDeleted }>,
      },
      // ... 每张 dataset 一个 entry
    },

    sql: {
      execute(sqlCode, params): Promise<{ data, rowCount, riskLevel }>,
    },

    // 单库事务：fn 内 client.* 调用绑定到同一连接
    tx<T>(fn: () => Promise<T>): Promise<T>,
  },

  logger: {
    log(...args), warn(...args), error(...args)
  }
}
```

## tx 用法

```js
exports.handler = async (ctx) => {
  return await ctx.client.tx(async () => {
    const order = await ctx.client.models.order.create({ ... });
    await ctx.client.models.inventory.update(itemId, { stock_delta: -1 });
    return { orderId: order.id };
  });
};
```

抛错 → 自动 ROLLBACK。

::: warning 跨 dataSourceId 不允许
tx 内只能访问**同一个 dataSource** 的 dataset。`order` 和 `inventory` 必须挂同一个 DataSource，否则抛 `VALIDATION_FAILED`。
要做跨库就只能"补偿事务"：业务层手动两阶段。
:::

## 调第三方 API

```js
exports.handler = async (ctx) => {
  const r = await fetch('https://api.example.com/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uid: ctx.input.uid }),
  });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return await r.json();
};
```

`fetch` 在沙箱里可用，但受 SSRF 黑白名单限制（默认拒绝内网 IP，防 ec2 metadata 被打）。

## 类型：四种 BFF

| type              | 触发                                               | 用法                 |
| ----------------- | -------------------------------------------------- | -------------------- |
| `ENDPOINT`        | `POST /api/bff/exec/:appCode/:scriptName` 显式调用 | 自定义业务逻辑       |
| `BEFORE_HOOK`     | 绑 dataset：写操作（create/update/delete）前自动跑 | 校验、补字段、审批   |
| `AFTER_HOOK`      | 绑 dataset：写操作后自动跑                         | 通知、推消息、写日志 |
| `PUBLIC_FUNCTION` | 内部库函数；不直接对外                             | 给其他 BFF 复用      |

`BEFORE_HOOK` / `AFTER_HOOK` 必须填 `boundDataset`：

```json
{
  "type": "BEFORE_HOOK",
  "boundDataset": "<datasetCode of order>",
  "code": "exports.handler = async (ctx) => { /* ctx.input 是即将创建/更新的数据 */ }"
}
```

before hook 抛错 → 操作被拒；before hook 改 `ctx.input` → 改后的值落库。

## 沙箱限制

- 单次最长 30s（超时 SIGKILL）
- env 只透传 `NODE_ENV`，不传 DB / JWT secret
- `child_process` / `worker_threads` / `cluster` 不可用
- `fs` 仅 `/tmp` 临时区
- `fetch` 受 SSRF 防护
- 内存：`--max-old-space-size=512`（默认 512MB；可调）
- 跑满 100 次（`BFF_RECYCLE_AFTER`）的 worker 强制重启

## 调试

`ctx.logger.log/warn/error` 的内容会回到 server 响应的 `logs` 数组：

```js
exports.handler = async (ctx) => {
  ctx.logger.log('input:', ctx.input);
  // ...
  ctx.logger.warn('this happens 3% of the time');
};
```

## AI 写 BFF

通过 [MCP Tool](/reference/mcp) `write_bff`：

```json
{
  "name": "write_bff",
  "arguments": {
    "appCode": "app-shop0001",
    "scriptName": "auto-tag-vip",
    "type": "AFTER_HOOK",
    "boundDataset": "<datasetCode of user>",
    "code": "exports.handler = async (ctx) => { if (ctx.input.totalSpent > 10000) await ctx.client.models.tag.create({user_id: ctx.input.id, tag: 'vip'}); };"
  }
}
```

Agent 自己写 + 落库；人 review 后启用。

## 排障

| 错误                             | 含义                                                  |
| -------------------------------- | ----------------------------------------------------- |
| `BFF_TIMEOUT`                    | 超 30s 被 SIGKILL                                     |
| `BFF_OOM`                        | 超 max-old-space-size                                 |
| `cross dataSource not supported` | tx 内调了第二个库                                     |
| `worker dead`                    | 子进程崩了——通常 syntax error 或 require 不存在的模块 |
| `unknown model X`                | dataset 不在当前 application 下 / 已 isDeleted        |
