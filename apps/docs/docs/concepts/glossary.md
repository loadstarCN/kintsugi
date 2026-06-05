# 术语表（Glossary）

本表把 Kintsugi 里反复出现的概念按字母顺序集中列一遍，给：

- 第一次读代码 / 文档时被名词淹没的新人；
- 查"这个词在我们这儿到底指什么"的老人；
- 给 LLM 做 RAG 上下文（DBAgent / 文档站搜索都需要明确无歧义的术语）。

每条尽量满足三件事：**怎么定义**、**为什么这么定义**、**在哪儿见到**（代码 / 表 / API）。

> 命名约定：本平台用 `appCode`、`tenantCode`、`datasetCode` 这种"业务可读 code"作主键，不用自增 ID。
> 自增 ID 只用在 page / bff / sql 这些用户不会跨环境引用的内容上。

---

## A

### ABAC（Attribute-Based Access Control）

基于属性的访问控制。和角色绑死的 RBAC 不同，ABAC 看的是"主体属性 × 资源属性 × 环境属性"组合策略。
本平台 **rule** 字段是 JSON DSL（参考 `rbac/abac.ts`），评估出来的"允许行集合"喂给 PG 的 RLS GUC，最终在 SQL 层把行收紧。

> 见：`/concepts/abac-rls`、`apps/server/src/modules/rbac/`

### Access Key

对外暴露的 OpenAPI 凭据。结构 `accessKey` + `accessSecret`，每次请求按 HMAC-SHA256 签名计算。
和"用户 token"不同：access key 通常绑定到 application 级（machine-to-machine），可选绑定到一个虚拟 user 以走 RLS scope=self。

> 见：`/guides/hmac`、`apps/server/src/modules/access-key/`

### AI-Native

不是"加一个 AI 助手"。本平台的 AI-Native 指：核心动作（建表、写 SQL、出页面、出报表）默认走 LLM，
管理员看到的是一段中文需求，不是一堆字段表单。LLM 不是 feature，是默认 actor。

> 见：`/concepts/ai-native`

### Application（应用）

租户下的业务边界，一组 dataset / page / bff / sql 共享的命名空间。
跨 application 的引用要么走 BFF endpoint，要么走 Instant API。
`appCode` 在租户内唯一。

---

## B

### BFF（Backend For Frontend）

本平台 BFF = 一段 TypeScript 代码，跑在 Node Worker 沙箱里，可以读 dataset、调外部 API。
四种类型：`BEFORE_HOOK` / `AFTER_HOOK` / `ENDPOINT` / `PUBLIC_FUNCTION`。
HOOK 钩到 dataset CRUD，ENDPOINT 暴露成 HTTP，PUBLIC_FUNCTION 给页面里直接 import。

> 见：`/concepts/bff`、`apps/server/src/modules/bff/`

---

## C

### Custom SQL

用户自己写、平台代为执行 + 审计的 SQL。
特点：参数走 `#{name}` 占位（不是 `?`），平台先做语法校验 + 风险分级（`low/medium/high/critical`），
含 `drop` 等关键字会被分到 critical 并在执行时拦掉。
`actor=human` / `ai` 在 service 层从 auth 上下文派生，不允许 body 注入（class-validator forbidNonWhitelisted）。

> 见：`/guides/custom-sql`、`apps/server/src/modules/custom-sql/`

---

## D

### Dataset（数据集）

对一张 PG 表的"业务封装"。包含字段 metadata、显示名、ABAC 策略、关联 dataset。
不是 view，是表本身的一层模型层；DO 操作、自动生成 page、报表问答都走 dataset。

### DBAgent

"看到一个数据库，自动产出 dataset / 关系 / 业务名"的子模块。
两步走：先用启发式规则在 `relation-candidates.ts` 里把候选关系列出来（O(n²) 表对降到几十个），再让 LLM 复核 + 评分。
评估 fixture 在 `apps/server/scripts/fixtures/dbagent-eval/`，目标 F1 > 90%。

> 见：`/guides/dbagent-tuning`

### DLQ（Dead Letter Queue）

本平台 webhook 投递失败超过重试上限后状态置 `dead_lettered`，行为上等价于死信。
不是独立队列表，就是 webhook_delivery 表的一个 status 值，方便统计 + 人工 retry。

### DO（Dataset Object）

对一行 dataset 数据的 OO 包装。CRUD 方法直接在 DO 上调用，会自动带上 hooks / RLS / 审计。

> 见：`/concepts/do`

---

## H

### HMAC 签名

本平台对**入站** webhook（DingTalk / WeCom / 飞书）按各家规范验签，对**出站** webhook 用 HMAC-SHA256 over body，
header 是 `X-Kintsugi-Signature: sha256=...`。
secret 创建时一次性返回，之后只存 cipher。

> 见：`/guides/hmac`

---

## I

### Instant API

平台对每个 dataset 自动暴露的 RESTful CRUD 端点。
路径形如 `/api/instant/{appCode}/{datasetCode}`。
鉴权可走 JWT（用户态）也可走 access key（机器态），两条路都要过 RLS。

> 见：`/reference/instant-api`

---

## J

### Junction（连接表）

多对多中间表，复合主键 (a_id, b_id)。本平台 DBAgent 候选关系算法对这种表特殊处理——
两个 PK 列都不当作"自身主键"跳过，而是同时作为潜在 FK 评估。

---

## L

### LLM Gateway

聚合多家 provider（DeepSeek / Qwen / Ollama 本地）的统一调用层。
负责：路由、failover、token 计费扣减、prompt 模板化。
不直接被 controller 调用，而是走具体功能的 service（DBAgent / ReportsService / PagesService）。

> 见：`apps/server/src/llm/`

---

## M

### MCP（Model Context Protocol）

Anthropic 的 tool-use 协议；本平台对外暴露一组 MCP tools，让外部 LLM 客户端（如 Claude Desktop）
可以直接调 dataset / instant-api / reports。

> 见：`/reference/mcp`

---

## P

### Page（页面）

LLM 根据中文 prompt 生成的 React 页面。源码以 `sourceFiles: Record<string, string>` 形式存表，
publish 后转成 sub-app 静态资源；运行时通过 iframe 隔离（不是 qiankun 的 proxy 沙箱，更安全）。

> 见：`/guides/text-to-page`

### Placeholder（占位符）

Custom SQL 里的 `#{name}` 形参，validate 时按正则提取出 `placeholders[]` 返回。
和 PG 原生 `$1` 不同：占位符是平台层的，最终会被改写成参数化查询防 SQL 注入。

---

## R

### Risk Level（风险分级）

Custom SQL / DBAgent 输出的风险标签：`low` / `medium` / `high` / `critical`。
`critical` 的 SQL 会被执行时拒绝；`high` 走二次确认；`medium/low` 直接放行但记审计。

### RLS（Row-Level Security）

PG 行级安全。本平台用 GUC（`kintsugi.tenant`、`kintsugi.user_id`、`kintsugi.dept_ids`）做策略变量，
ABAC 评估出来的字符串塞进 GUC，policy 函数读 GUC 决定哪行能看。
连接归还连接池前必须 `RESET` 这些 GUC，避免泄露给下一个请求。

> 见：`/concepts/abac-rls`

---

## S

### sslmode=disable

Aliyun RDS 不开 SSL 时，连接字符串必须显式带 `?sslmode=disable`，不然 Prisma 会按默认 SSL 握手失败。
本地起 server 文档里有详细说明。

> 见：`/getting-started/installation`

### SchemaSnapshot

db-scanner 跑完后产出的中间结构：tables / columns / FKs / indexes 的纯数据快照。
DBAgent 候选关系算法、dataset 自动生成都吃这个 snapshot，不直连数据库。

---

## T

### Tenant（租户）

最外层多租户隔离边界。每个表都有 `tenantCode` 列 + RLS policy。
`tenantCode` 在数据库内唯一；JWT / accessKey 都把 tenantCode 写进上下文。

---

## W

### Webhook（出站）

本平台事件（如 `dataset.created`）触发后向用户配置的 URL 推送 JSON。
机制：at-least-once + 指数退避（1m/5m/30m/2h/12h），最终失败转 `dead_lettered`。
SchedulerService 每 30s 扫一批 pending 重试，{id, attempts: prev} 乐观锁防并发重复发送。

> 见：`apps/server/src/modules/webhook/`

---

## 缩写速查

| 缩写 | 全称                           | 一句话              |
| ---- | ------------------------------ | ------------------- |
| ABAC | Attribute-Based Access Control | 用属性 × 策略算访问 |
| BFF  | Backend For Frontend           | 沙箱里跑的业务 TS   |
| DLQ  | Dead Letter Queue              | 重试上限后状态      |
| DO   | Dataset Object                 | 一行数据的 OO 包装  |
| GUC  | Grand Unified Configuration    | PG session 变量     |
| HMAC | Hash-based MAC                 | webhook 验签        |
| MCP  | Model Context Protocol         | LLM tool-use 协议   |
| RBAC | Role-Based Access Control      | 老式角色权限        |
| RLS  | Row-Level Security             | PG 行级安全         |
| SDK  | Software Dev Kit               | 我们 ts 客户端      |
