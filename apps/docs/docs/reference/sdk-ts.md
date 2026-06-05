# TypeScript SDK

`@kintsugi/sdk` 把 server 的 HTTP API 包成 typed client。

## 安装

```bash
# monorepo 内
pnpm add @kintsugi/sdk

# 外部项目（待 publish）
# npm install @kintsugi/sdk
```

## 创建 client

### JWT（最常见）

```ts
import { createClient } from '@kintsugi/sdk';

const k = createClient({
  baseUrl: 'http://localhost:4000',
  auth: { mode: 'token', token: '<jwt>' },
});
```

### Bearer 简写

```ts
const k = createClient({ baseUrl: '...', token: '<jwt>' });
// 等价于 auth: { mode: 'token', token }
```

### Cookie（浏览器）

```ts
const k = createClient({
  baseUrl: '/', // 同源相对路径
  auth: { mode: 'cookie' }, // 浏览器自动带 kintsugi_session cookie
});
```

### HMAC（OpenAPI / Agent）

```ts
const k = createClient({
  baseUrl: 'https://api.example.com',
  auth: {
    mode: 'hmac',
    accessKey: 'ak_xxx',
    secretKey: 'sk_xxx',
  },
});
```

SDK 自动算 HMAC 签名 + 发 4 个 header（详见 [HMAC](/guides/hmac)）。

## Dataset 客户端

```ts
const goods = k.dataset('goods');

// filter
const r = await goods.filter({
  where: [
    { field: 'price', op: 'gte', value: 100 },
    { field: 'name', op: 'like', value: '%foo%' },
  ],
  orderBy: [{ field: 'createdAt', direction: 'desc' }],
  page: 1,
  pageSize: 20,
});
// r: { data: Row[], page, pageSize, total }

// getOne
const one = await goods.getOne('123');

// create
const created = await goods.create({ name: 'foo', price: 99 });

// update
const updated = await goods.update('123', { price: 109 });

// delete
const deleted = await goods.delete('123');
// → { ok: true, softDeleted: boolean }

// batchCreate
const batch = await goods.batchCreate([{ name: 'a' }, { name: 'b' }]);
// → { created: 2 }

// aggregate
const agg = await goods.aggregate({
  groupBy: ['category'],
  aggregates: [{ field: 'id', op: 'count' }],
});

// options
const opts = await goods.options('status');
// → { options: [{value, label}, ...] }
```

## Custom SQL

```ts
const r = await k.sql.execute('daily_revenue', {
  start: '2026-05-01',
  end: '2026-05-04',
});
// r: { data, rowCount, riskLevel }
```

## BFF

```ts
const r = await k.bff.exec('app-shop0001', 'place-order', {
  goodsId: 1,
  qty: 2,
});
// r: { data: <handler return>, logs: string[] }
```

## Chats（NL → SQL）

```ts
const r = await k.chats.ask('app-shop0001', 'goods 按 type 分布');
// r: { sql, explanation, data, rowCount }
```

## 类型

类型现在**从 server 的 platform OpenAPI spec 自动派生**——不再手写。

机制：

- server 暴露 `GET /api/openapi.platform.json`（稳定平台 API 形状，与 per-app 的 Instant API 不同）
- SDK 的 `pnpm gen` 拉这份 spec → openapi-typescript → `src/generated/api-types.ts`
- `pnpm build` 之前自动跑 gen（prebuild hook）
- 没有 server 也能 build：fallback 到 checked-in 的 `spec/openapi.platform.json` 快照

外部用法不变：

```ts
import type {
  CreateClientOptions,
  FilterRequest,
  FilterClause,
  FilterOp,
  LoginRequest,
  LoginResponse,
  AccessKeyPublic,
  // 高级用户：直接拿原始 OpenAPI 派生
  paths,
  components,
  ApiSchemas,
} from '@kintsugi/sdk';
```

**server 改字段时**：

```bash
pnpm dev:server                          # 本地起 server
pnpm --filter @kintsugi/sdk gen          # 拉新 spec + 重生类型
git diff packages/sdk/spec packages/sdk/src/generated   # 看漂移
```

PR 里能看到 spec snapshot + 派生类型同时变化——drift 一目了然。

::: tip 维护契约
`apps/server/src/modules/openapi/platform-spec.ts` 是手写的契约源。
加 controller 端点时同时改这个文件；CI 不强制 controller↔spec 一致（无法静态判断），靠 PR review。
:::

## 错误处理

SDK 遇到非 2xx 抛 `KintsugiApiError`：

```ts
import { KintsugiApiError } from '@kintsugi/sdk';

try {
  await goods.update('123', { price: 109 });
} catch (err) {
  if (err instanceof KintsugiApiError) {
    console.log(err.code); // 'BLOCKED_BY_CONCURRENT_EDIT'
    console.log(err.status); // 409
    console.log(err.message);
    console.log(err.detail); // 后端附加信息
  }
}
```

`code` 的全集见 [Instant API 错误码](/reference/instant-api#错误码总表)。

## 限流响应

429 时 `KintsugiApiError.detail` 含 `resetAt` (epoch ms)：

```ts
catch (err) {
  if (err.code === 'RATE_LIMITED') {
    const wait = err.detail.resetAt - Date.now();
    await sleep(wait);
    return retry();
  }
}
```

## 浏览器 vs Node

SDK 用 fetch（Node 18+ / 现代浏览器原生支持）。两端通用。

## Tree-shaking

SDK 没用 default export，命名导入即可保证 dead-code 被裁掉：

```ts
import { createClient } from '@kintsugi/sdk'; // ✓ 只引入 createClient
// 不要：import sdk from '@kintsugi/sdk';       // ✗ 引入整个模块
```

## 移动端 SDK 等价

| 功能           | TypeScript                   | iOS Swift                         | Android Kotlin                    |
| -------------- | ---------------------------- | --------------------------------- | --------------------------------- |
| createClient   | `createClient(opts)`         | `KintsugiClient(opts)`            | `KintsugiClient.create(opts)`     |
| dataset filter | `k.dataset('x').filter(req)` | `client.dataset("x").filter(req)` | `client.dataset("x").filter(req)` |
| HMAC           | `auth: { mode: 'hmac' }`     | `Auth.hmac(ak, sk)`               | `Auth.Hmac(ak, sk)`               |

详见 `packages/mobile-sdk/` 下两个 README。
