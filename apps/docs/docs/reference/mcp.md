# MCP Tools 参考

`packages/mcp-server` 是 stdio JSON-RPC server，实现 [MCP](https://modelcontextprotocol.io/) 1.x 的最小子集（initialize / tools/list / tools/call），手写不依赖 `@modelcontextprotocol/sdk`。

## 启动

```bash
node packages/mcp-server/bin/mcp.js
```

需要环境变量：

```bash
KINTSUGI_API_BASE=http://localhost:4000
KINTSUGI_TOKEN=<jwt>           # 或者用 access key（HMAC）但目前 MCP 走 token
```

## Claude Desktop / Cursor 配置

```json
{
  "mcpServers": {
    "kintsugi": {
      "command": "node",
      "args": ["/path/to/kintsugi/packages/mcp-server/bin/mcp.js"],
      "env": {
        "KINTSUGI_API_BASE": "http://localhost:4000",
        "KINTSUGI_TOKEN": "<jwt>"
      }
    }
  }
}
```

## 工具清单

### 读工具

#### `list_datasets`

列出 application 下所有 dataset。

```json
{ "appCode": "app-shop0001" }
```

返回：dataset 数组，含 `datasetCode / tableName / alias / version`。

#### `get_dataset_detail`

拉单个 dataset 完整 DO JSON。

```json
{ "datasetCode": "ds_xxx" }
```

#### `validate_sql_content`

不执行，只校验 SQL 语法 + 返回 riskLevel + 占位符列表。

```json
{ "content": "SELECT * FROM goods WHERE price >= #{min}" }
```

返回：

```json
{
  "valid": true,
  "riskLevel": "low",
  "placeholders": ["min"]
}
```

#### `execute_sql`

跑预存 Custom SQL。

```json
{
  "sqlCode": "sq_xxx",
  "params": { "min": 100 }
}
```

actor 自动是 `'ai'`（受 BLOCKED_BY_AI + readonly tx 兜底）。critical SQL 直接拒绝。

#### `ask_chat`

NL → SQL 问数。

```json
{
  "appCode": "app-shop0001",
  "question": "本月销售额 top 10 商品"
}
```

返回：`{ sql, explanation, data, rowCount }`。

#### `list_bff_scripts`

列 BFF 脚本。

```json
{ "appCode": "app-shop0001" }
```

### 写工具

::: warning 写工具需要 RBAC 写权限
MCP 调用走 `KINTSUGI_TOKEN`，server 仍按 token 持有者的 grants 校验。
给只读 token 给低权限 Agent，写 token 给可信 Agent。
:::

#### `write_bff`

新建 / 更新 BFF 脚本（按 `appCode + scriptName` upsert）。

```json
{
  "appCode": "app-shop0001",
  "scriptName": "place-order",
  "type": "ENDPOINT",
  "code": "exports.handler = async (ctx) => { ... }",
  "boundDataset": "ds_xxx", // BEFORE_HOOK / AFTER_HOOK 必填
  "submitter": "ai-agent"
}
```

`type` 取值：`BEFORE_HOOK` / `AFTER_HOOK` / `ENDPOINT` / `PUBLIC_FUNCTION`。

#### `write_sql`

新建（不传 sqlCode）或更新（传 sqlCode）Custom SQL。

```json
{
  "appCode": "app-shop0001",
  "sqlName": "daily_revenue",
  "content": "SELECT ...",
  "dataSourceId": "ds-uuid",
  "paramsSchema": { "start": { "type": "datetime", "required": true } },
  "sqlCode": "sq_xxx" // 可选；传则 PATCH，不传则 POST
}
```

#### `update_dataset_do`

修改 DO JSON（带乐观锁）。

```json
{
  "datasetCode": "ds_xxx",
  "doJson": { ... 完整 DoJson ... },
  "expectedVersion": 3
}
```

`expectedVersion` 必须先 `get_dataset_detail` 拿到。冲突返回 `BLOCKED_BY_CONCURRENT_EDIT`，Agent 应 reload 后重试。

#### `get_rls_policy`

输出 dataset 对应的 PG RLS policy 建议 SQL（不执行 DDL）。

```json
{ "datasetCode": "ds_xxx" }
```

返回 `{ sql, dropSql, policies, warnings }`。仅 PG 方言；其他抛 `VALIDATION_FAILED`。

## 协议细节

JSON-RPC 2.0 over stdio（每行一条 JSON）。

### initialize

请求：

```json
{ "jsonrpc": "2.0", "id": 1, "method": "initialize" }
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": { "name": "kintsugi-mcp", "version": "0.0.1" }
  }
}
```

### tools/list

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

响应：tools 数组，每条带 `name / description / inputSchema`（JSON Schema）。

### tools/call

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "list_datasets",
    "arguments": { "appCode": "app-shop0001" }
  }
}
```

响应：

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "{...JSON.stringify 后的 server 响应...}" }]
  }
}
```

## 排障

| 现象             | 原因                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| Agent 看不到工具 | 检查 host 配的 `command + args` 路径；stderr 看 `[kintsugi-mcp] stdio ready` |
| 调工具 401       | `KINTSUGI_TOKEN` 失效 / 过期                                                 |
| 调写工具 403     | token 持有者没 `*:write` 权限                                                |
| 工具调用超时     | host 默认 30s 超时；某些写操作 + LLM 路径需更长                              |

## 自定义工具

想加新工具：编辑 `packages/mcp-server/src/index.ts` 的 `TOOLS` 数组 + `callTool` switch；不需要重新声明协议。

## Skills 包（互补）

`packages/skills` 是 [Skills 2.0](https://docs.anthropic.com/) 包，告诉 Agent **怎么用**这些工具：

- 工作流 SOP（"如何修订 DO" / "如何排查 BFF 报错"）
- 命令例子库
- 提示词模板

Agent host 加载 skill 后会主动调用对应工具。
