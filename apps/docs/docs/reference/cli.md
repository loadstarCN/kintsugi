# CLI 参考（kintsugi）

`packages/cli` 是 dev-time 命令行：开应用、调 dataset、跑 SQL、写 BFF、拉 OpenAPI。

## 安装与配置

```bash
# 当前是 monorepo 内嵌；后续会 npm publish
node packages/cli/bin/kintsugi.js --help

# 全局软链
ln -s "$(pwd)/packages/cli/bin/kintsugi.js" ~/.local/bin/kintsugi
chmod +x ~/.local/bin/kintsugi
```

环境变量：

```bash
export KINTSUGI_API_BASE=http://localhost:4000
export KINTSUGI_TOKEN=<jwt>            # 或者用 kintsugi auth login
```

## 命令总览

```
kintsugi <command> [options]

命令：
  auth         认证（login / logout / whoami）
  dataset      Dataset CRUD（list / show / update-do）
  sql          Custom SQL 管理（list / show / exec / save）
  bff          BFF 脚本管理（list / show / save / exec）
  api-pull     拉应用 OpenAPI → 生成 TypeScript SDK
  doctor       诊断（连接 / 版本 / 配置）
```

## auth

```bash
kintsugi auth login -t demo -u alice -p alice123
# → 拿到 JWT 写入 ~/.kintsugi/credentials

kintsugi auth whoami
# → { userId: '...', username: 'alice', tenantCode: 'demo' }

kintsugi auth logout
# → 撤销 JWT + 清本地凭据
```

## dataset

```bash
# 列表
kintsugi dataset list -a app-shop0001

# 详情（含 DO JSON）
kintsugi dataset show -a app-shop0001 -d ds_xxx

# 修改 DO（注意带 expectedVersion）
kintsugi dataset update-do -d ds_xxx -v 3 -f ./goods-do.json
```

## sql

```bash
# 列表
kintsugi sql list -a app-shop0001

# 详情
kintsugi sql show -c sq_xxx

# 执行
kintsugi sql exec -c sq_xxx --params '{"category":"food"}'

# 保存（新增 / 更新）
kintsugi sql save -a app-shop0001 -n daily_revenue -f ./daily.sql --params-schema ./schema.json
```

## bff

```bash
# 列表
kintsugi bff list -a app-shop0001

# 详情
kintsugi bff show -a app-shop0001 -n place-order

# 保存
kintsugi bff save -a app-shop0001 -n place-order -t ENDPOINT -f ./place-order.js

# 执行
kintsugi bff exec -a app-shop0001 -n place-order --input '{"goodsId":1,"qty":2}'
```

## api-pull

把指定 application 的 OpenAPI 拉下来 + 生成本地 TypeScript SDK：

```bash
kintsugi api-pull -a app-shop0001 -o ./generated/sdk
# → 生成 3 个文件：
#   ./generated/sdk/openapi.json     (原始 spec)
#   ./generated/sdk/types.ts         (openapi-typescript 派生的 paths/components)
#   ./generated/sdk/client.ts        (typed dataset/sql/bff/chats client)
```

老路径兼容（只想拉 spec 不要 codegen）：

```bash
kintsugi api-pull -a app-shop0001 -o openapi.json    # -o 是 .json → 只写 spec
kintsugi api-pull -a app-shop0001 --spec-only        # 等价
```

后续在你的代码：

```ts
import { createClient } from './generated/sdk/client';

const k = createClient({ baseUrl: 'http://localhost:4000', token: '...' });

// dataset 是 typed proxy，全 typed
const r = await k.dataset<Goods>('goods').filter({
  where: [{ field: 'price', op: 'gte', value: 100 }],
  pageSize: 20,
});
// r: { data: Goods[], page, pageSize, total }

// SQL / BFF / Chats 也都包了
await k.sql.execute('daily_revenue', { date: '2026-05-01' });
await k.bff.exec('place-order', { goodsId: 1, qty: 2 });
await k.chats.ask('本月销售 top 10');
```

::: tip 重新生成
server 改了 dataset 字段 / 加了端点 → 重跑一次 `api-pull`，types.ts 自动跟上。
建议把 `./generated/sdk/` 加进 `.gitignore`，CI 跑 api-pull 重生即可。
:::

## doctor

```bash
kintsugi doctor

✓ Node.js 22.11.0
✓ pnpm 9.12.0
✓ KINTSUGI_API_BASE=http://localhost:4000
✓ Server health OK (4000/api/health)
✓ Auth OK (logged in as alice@demo)
✗ Redis backend not active (REDIS_URL not set)
✗ OTel disabled (OTEL_ENABLED != 'true')
```

排查环境配置 / 网络问题首选。

## 退出码

| code | 含义            |
| ---- | --------------- |
| 0    | success         |
| 1    | 通用错误        |
| 2    | 参数错误        |
| 3    | 认证失败 / 401  |
| 4    | 权限不足 / 403  |
| 5    | 未找到 / 404    |
| 6    | 网络 / 上游错误 |

## Runtime CLI

`packages/runtime-cli` 是给运行态 agent 的精简版，**只能 exec 不能 list**：

```bash
runtime-cli sql.exec sq_xxx --params '{"category":"food"}'
runtime-cli bff.exec app-shop0001 place-order --input '{"goodsId":1}'
```

设计意图：runtime token 泄露的爆炸半径限制在"能跑预存脚本"，不能"枚举 / 修改"。
