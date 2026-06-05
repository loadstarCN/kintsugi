# AI-Native 接入

Kintsugi 不是"系统里塞个 chatbot"，而是**系统天生暴露给 AI Agent 调用**。

## 接入路径概览

| 路径                   | 协议           | 调用方                                  | 关键能力                                               |
| ---------------------- | -------------- | --------------------------------------- | ------------------------------------------------------ |
| **MCP Server**         | stdio JSON-RPC | Claude Desktop / Cursor / 其他 MCP host | 列 dataset、查 DO、问数、跑 SQL、**写 BFF / SQL / DO** |
| **CLI（kintsugi）**    | shell          | dev / CI / Agent shell tool             | dataset/sql/bff/api-pull/doctor                        |
| **Runtime CLI**        | shell          | 运行态 agent-only                       | 只 exec 不 list（安全更收敛）                          |
| **HTTP API + HMAC**    | REST + HMAC    | 任何 SDK / 第三方 Agent                 | 完整 Instant API + 自定义端点                          |
| **飞书 / 钉钉 Bridge** | webhook        | IM 用户                                 | NL → SQL → 表格回复                                    |

## MCP Tools

通过 `node packages/mcp-server/bin/mcp.js` 起 stdio server，Agent host 配进 `mcpServers`。

### 读工具

| 工具                   | 输入                  | 用途                              |
| ---------------------- | --------------------- | --------------------------------- |
| `list_datasets`        | `appCode`             | 拿到 dataset 列表                 |
| `get_dataset_detail`   | `datasetCode`         | 拉完整 DO（字段、关系、特殊角色） |
| `validate_sql_content` | `content`             | 校验 SQL 语法 + 返回 riskLevel    |
| `execute_sql`          | `sqlCode`, `params`   | 跑预存的 Custom SQL               |
| `ask_chat`             | `appCode`, `question` | NL → SQL → 结果（DeepSeek 跑）    |
| `list_bff_scripts`     | `appCode`             | 列 BFF                            |

### 写工具

| 工具                | 输入                                       | 用途                   |
| ------------------- | ------------------------------------------ | ---------------------- |
| `write_bff`         | `appCode`, `scriptName`, `type`, `code`    | 创建/更新 BFF 脚本     |
| `write_sql`         | `appCode`, `sqlName`, `content`            | 创建/更新 Custom SQL   |
| `update_dataset_do` | `datasetCode`, `doJson`, `expectedVersion` | 修改 DO（带乐观锁）    |
| `get_rls_policy`    | `datasetCode`                              | 输出 PG RLS policy SQL |

::: warning 写工具需要权限
MCP 调用走 `KINTSUGI_TOKEN`，server 仍按 RBAC 校验：写工具需要 `*:write` permission。
配只读 token 给低权限 Agent，写 token 给可信 Agent。
:::

## CLI

```bash
# 安装
pnpm --filter @kintsugi/cli build
node packages/cli/bin/kintsugi.js --help

# 配置
export KINTSUGI_API_BASE=http://localhost:4000
node packages/cli/bin/kintsugi.js auth login

# 用法
kintsugi dataset list -a app-demo0001
kintsugi dataset show -a app-demo0001 -d goods
kintsugi sql exec -c sql_daily_stats --params '{"date":"2026-05-01"}'
kintsugi bff edit -a app-demo0001 -n my-bff < ./my-bff.js
kintsugi api-pull -a app-demo0001 -o ./generated/sdk    # 拉 OpenAPI
kintsugi doctor                                          # 诊断
```

## Runtime CLI

`packages/runtime-cli` 是**只读 + exec** 的精简 CLI，专门给运行态 agent 用，不暴露管理操作：

```bash
runtime-cli sql.exec <sqlCode> --params <json>
runtime-cli bff.exec <appCode> <scriptName> --input <json>
```

只 exec、不能 list、不能改。降低 token 泄漏的爆炸半径。

## 飞书 Bridge

```bash
POST /api/bridges/feishu/webhook?appCode=app-xxx
```

支持：

- `url_verification`（飞书事件订阅校验）
- `im.message.receive_v1`（@机器人发问）

收到 `goods 按 type 分布` 这种自然语言后，`ChatsService.ask` 跑 NL → SQL → 数据，再回成 markdown 表格。

## Skills 包

`packages/skills` 是 [Anthropic Skills 2.0](https://docs.anthropic.com/) 包，里面塞了：

- 怎么调 CLI
- 怎么调 Runtime CLI
- 业务工作流的 SOP（"如何修订 DO"、"如何排查 BFF 报错"）

Agent host 加载 skill → Agent 自己学会怎么用 Kintsugi。

## 调用范式：让 Agent 真"做事"

不是 "读完后总结返回"，而是 "提议方案 → 用户批准 → 执行落库"。例子：

```
User:   "给 user 表加一个 lastLoginAt 字段"
Agent:  通过 update_dataset_do 改 DO（先 GET 拿 expectedVersion）
        通过 write_sql 写一段 ALTER TABLE
        提示用户："准备执行这条 DDL：ALTER TABLE user ADD lastLoginAt TIMESTAMP；
                  确认后我跑 execute_sql"
User:   "确认"
Agent:  execute_sql → ✓
```

这个范式只在**白盒 + 真实代码**下才成立。Kintsugi 不黑盒——所有 BFF、SQL、Page 都是可 git 管理的真实文件，Agent 改了之后人能 review 能 revert。

## 为什么这是产品差异化

业界主流是"**LLM + RAG + 让 LLM 写答案**"——只观察、不动作。
Kintsugi 是"**LLM + Tool（带权限）+ 让 LLM 改系统**"——可观察、可执行、可审计。

差距：

| 能力              | 主流 AI 工具 | Kintsugi                              |
| ----------------- | ------------ | ------------------------------------- |
| 读业务数据        | ✓            | ✓                                     |
| 生成 SQL          | ✓            | ✓                                     |
| 执行 SQL          | ×            | ✓（带 readonly tx 兜底 + actor 区分） |
| 修改业务系统      | ×            | ✓（Pro Code 落地）                    |
| 审计 Agent 行为   | ×            | ✓（AuditLog + traceparent）           |
| 多 Agent 并发权限 | ×            | ✓（access-key + RBAC）                |
