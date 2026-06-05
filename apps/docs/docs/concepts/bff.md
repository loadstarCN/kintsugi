# BFF 沙箱

BFF（Backend for Frontend）让你在不离开 Kintsugi 的前提下写**自定义业务逻辑**。

适用场景：

- Instant API 9 个端点搞不定的复杂事务
- 多 dataset 跨表写入（保证一致性）
- 调用第三方 API 后再回写
- AI Agent 想"做一件事"而不是"读一行数据"

## 设计原则：进程级隔离

BFF 代码是**用户写的 JS**——可能恶意、可能 bug。我们用 child_process pool + vm 跑：

```
主进程（Nest）                       Worker 子进程
┌────────────┐    spawn          ┌─────────────────────┐
│ BffService │  ─────────────▶   │ node + vm sandbox   │
│            │     IPC           │                     │
│ 审批数据访问│ ◀───────────────  │ 用户 BFF 代码        │
│ + 限速     │                   │                     │
└────────────┘                   └─────────────────────┘
```

为什么不用 `worker_threads`：worker 是**线程**隔离不是**进程**隔离，共享 process 对象 / env / fd。攻击者 ctx-walk 拿到 worker realm 的 `require` 就能 `require('child_process').exec(...)` RCE。

## 安全模型

- 用户代码跑独立 child process
- env 只透传 `NODE_ENV`，**不传** JWT_SECRET / ENCRYPTION_KEY / DATABASE_URL
- 子进程内 vm 加固，不暴露 host primordial
- 即便逃出 vm 拿到子进程的 require，子进程**没 DB 凭据、没 Prisma 实例**
- 资源配额：`--max-old-space-size` + watchdog SIGKILL
- 所有数据访问走 IPC，主进程审批后回结果

## 写 BFF：示例

```js
// my-bff.js
exports.handler = async (ctx) => {
  const { input, userInfo, client, logger } = ctx;

  // 读 dataset（自动走 Instant API + ABAC + tenant 隔离）
  const goods = await client.models.goods.filter({
    where: [{ field: 'price', op: 'gte', value: 100 }],
    pageSize: 10,
  });

  // 跑 Custom SQL
  const stats = await client.sql.execute('sql_daily_stats', { date: '2026-05-01' });

  // 单库事务
  return await client.tx(async () => {
    await client.models.order.create({ goodsId: goods.data[0].id, qty: 1 });
    await client.models.inventory.update(goods.data[0].id, { stock_delta: -1 });
    return { ok: true };
  });
};
```

## ctx 形状

```ts
interface BffExecutionContext {
  userInfo: { userId: string; tenantCode: string; username: string } | null;
  input: unknown;
  client: {
    models: Record<string, ModelProxy>;
    sql: { execute(sqlCode: string, params?: object): Promise<unknown> };
    tx<T>(fn: () => Promise<T>): Promise<T>;
  };
  logger: { log; warn; error };
}
```

## tx 行为

- `client.tx(fn)` 内的所有 `client.*` 调用绑定到**同一连接**
- `BEGIN` 在第一次 dataset 调用时延迟启动（要先知道 dataSourceId）
- `fn` 正常返回 → `COMMIT`；抛错 → `ROLLBACK`
- **跨 dataSourceId 不支持**：tx 内调用第二个 dataSource 直接抛 `VALIDATION_FAILED`

## 调用 BFF

```bash
POST /api/bff/exec/:appCode/:scriptName
Content-Type: application/json

{ "input": { ... } }
```

返回：

```json
{ "data": <handler 的返回值>, "logs": [...] }
```

如果 handler 抛错：

```json
{ "code": "BFF_ERROR", "message": "...", "logs": [...] }
```

## 写 / 改 BFF

通过控制台或 API：

```bash
POST /api/bff
{
  "appCode": "app-xxx",
  "scriptName": "my-bff",
  "type": "ENDPOINT",
  "code": "exports.handler = async (ctx) => { ... }"
}
```

`type` 取值：

| type              | 触发时机                                          |
| ----------------- | ------------------------------------------------- |
| `ENDPOINT`        | 显式 POST `/api/bff/exec/...` 调用                |
| `BEFORE_HOOK`     | 绑 dataset：写操作前自动跑（`boundDataset` 必填） |
| `AFTER_HOOK`      | 绑 dataset：写操作后自动跑                        |
| `PUBLIC_FUNCTION` | 内部库函数；不直接对外                            |

## 限制

- 单次执行最长 30s（超时 SIGKILL）
- 每 worker 最多重用 100 次（`BFF_RECYCLE_AFTER`），防 V8 heap 累积
- 默认 4 个 worker 进程；`BFF_POOL_SIZE` 可调
- `Worker_threads` / `cluster` / `child_process` 在沙箱里不可用
- `fs` 受限（仅 `/tmp` 临时区，无外网读写权限）
- `fetch` 受 SSRF 黑白名单限制（同 DataSource SSRF 防护）

## AI 写 BFF

通过 [MCP Tools](/reference/mcp) 的 `write_bff` 工具，Agent 能直接生成并落库 BFF 脚本。
