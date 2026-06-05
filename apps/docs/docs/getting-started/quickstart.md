# 5 分钟 quickstart

跑通完整链路：连一个旧库 → 扫描 → 落 Dataset → Instant API 调用。

::: tip 前提
已经按 [安装](./installation) 起好 server (4000) + web (5173)，注册过用户。
:::

## 1. 拿 token

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"tenantCode":"demo","username":"alice","password":"alice123456"}' \
  | jq -r .token)
```

## 2. 创建 Application

```bash
curl -X POST http://localhost:4000/api/applications \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"appCode":"app-demo0001","name":"Demo App"}'
```

## 3. 接入业务库

业务库可以是任何 PG / MySQL：

```bash
curl -X POST http://localhost:4000/api/datasources \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "appCode": "app-demo0001",
    "dialect": "postgres",
    "displayName": "demo-shop",
    "host": "your-db-host",
    "port": 5432,
    "database": "shop",
    "username": "readonly_user",
    "password": "....",
    "sslMode": "disable"
  }'
# → { id: "ds-xxx", ... }
DSID=ds-xxx
```

::: tip 用只读账号
DBAgent 扫描只需要 SELECT + 元数据查询权限。给只读账号最稳。
:::

## 4. 触发扫描

```bash
curl -X POST "http://localhost:4000/api/dbagent/datasources/$DSID/scan" \
  -H "authorization: Bearer $TOKEN"
# → { jobId: "xxx" }
```

扫描状态：

```bash
curl "http://localhost:4000/api/dbagent/jobs/<jobId>" -H "authorization: Bearer $TOKEN"
```

`status` 从 `scanning` → `succeeded` 通常 30 秒内完成（取决于表数量）。

## 5. 从扫描结果落 Dataset

```bash
curl -X POST "http://localhost:4000/api/datasets/from-scan/<jobId>" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"appCode":"app-demo0001"}'
# → { created: 12, updated: 0, datasets: [...] }
```

至此每张表都成了一个 Dataset，`doJson` 字段已经填好（字段角色、enum 值、关系）。

## 6. 调 Instant API

随便挑一个 dataset，比如 `goods`：

```bash
# 列表
curl -X POST "http://localhost:4000/api/apps/app-demo0001/ds/goods/filter" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"pageSize":5}'

# 单条
curl "http://localhost:4000/api/apps/app-demo0001/ds/goods/123" \
  -H "authorization: Bearer $TOKEN"

# 创建
curl -X POST "http://localhost:4000/api/apps/app-demo0001/ds/goods" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"foo","price":99}'
```

每张 dataset 自动 9 个端点。完整接口看 [Instant API 参考](/reference/instant-api)。

## 7. 自动 OpenAPI / Swagger

```bash
open http://localhost:4000/api/apps/app-demo0001/docs
```

Swagger UI 直接出来，所有 dataset 自动列在里面。

## 8. 用 LLM 问数

```bash
curl -X POST "http://localhost:4000/api/chats/ask" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"appCode":"app-demo0001","question":"按 type 分组统计 goods 数量"}'
# → { sql: "SELECT type, count(*) ...", data: [...], explanation: "..." }
```

## 9. AI Agent 接入（MCP）

让 Claude / Cursor 通过 MCP 调你的业务：

```bash
# 客户端 MCP server 配置
node packages/mcp-server/bin/mcp.js
```

Agent 那边的 MCP config 加：

```json
{
  "mcpServers": {
    "kintsugi": {
      "command": "node",
      "args": ["/path/to/kintsugi/packages/mcp-server/bin/mcp.js"],
      "env": {
        "KINTSUGI_API_BASE": "http://localhost:4000",
        "KINTSUGI_TOKEN": "<token>"
      }
    }
  }
}
```

Agent 现在能调 `list_datasets` / `execute_sql` / `write_bff` 等工具。

---

下一步：

- 想理解每一步背后做了什么 → [系统架构](/concepts/architecture)
- 想做配置 / 个性化 → [DBAgent 调优](/guides/dbagent-tuning)
- 想做完整业务系统 → [从零做出第一个应用](./first-app)
