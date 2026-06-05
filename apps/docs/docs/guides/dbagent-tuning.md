# DBAgent 调优

DBAgent 是 Kintsugi 的"心脏"——它的推理质量决定了产品 80% 的体验。这一篇讲怎么让它在脏库上更准。

## 推理两层结构

```
SchemaSnapshot  →  规则层（findRelationCandidates）  →  LLM 复核（分批）  →  DoJson
                  ↑                                  ↑
                  ├── 命名规则                       ├── 业务语义判断
                  ├── 类型兼容                       ├── 候选取舍 + 评分
                  ├── 去重 + 评分                    └── 字段角色推断（tenantField/userField/...）
                  └── 复合 PK 判 junction
```

**规则层不调 LLM**——纯快、确定、便宜。LLM 只在规则层产候选后跑一次复核。

## 看准确率：eval harness

```bash
pnpm --filter @kintsugi/server dbagent:eval
```

输出：

```
01-classic-ecommerce         P=100.0%  R=100.0%  F1=100.0%  (tp=3 fp=0 fn=0)
02-camelcase-with-prefix     P=100.0%  R=100.0%  F1=100.0%  (tp=1 fp=0 fn=0)
03-pluralized-target         P=100.0%  R=100.0%  F1=100.0%  (tp=3 fp=0 fn=0)

Macro: P=100.0%  R=100.0%  F1=100.0%
```

CI 在 `DBAGENT_EVAL_MIN_F1=0.70` 之下会失败。

### 加自己的 fixture

`apps/server/scripts/fixtures/dbagent-eval/04-yourname.json`：

```json
{
  "name": "04-yourname",
  "snapshot": { ... SchemaSnapshot ... },
  "expected": [
    { "fromTable": "x", "fromColumn": "y_id", "toTable": "y", "toColumn": "id" }
  ]
}
```

把客户脏库的脱敏快照放进去。eval 跑出 F1 < 0.7 → 说明规则层在你这条路径上需要改。

## 常见漏召回 case

| 现象                                                    | 修复方向                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `创建人 created_by` → `user.id` 漏召                    | LLM prompt 里加业务术语映射；或人工在 DO 编辑器补                |
| `gid` 当 goods FK 漏召                                  | 缩写词典；目前只匹配 `xxx_id` / `xxxId` / `xxx_code` / `xxxCode` |
| 复合主键的 junction 表（如 `user_role`）只召回 1 条     | round-7 fix 已上：复合 PK 列也参与候选                           |
| 跨 schema 关系（PG `auth.user` ↔ `public.profile`）漏召 | 当前规则层不跨 schema；下一轮加                                  |
| 拼音字段（`yhid` → `user.id`）一律漏召                  | 暂不支持；用 LLM 自定义 prompt 兜                                |

## 怎么调 LLM 复核

`apps/server/src/modules/dbagent/dbagent.service.ts` 的 `LLM_BATCH_SIZE` 默认 30。

权衡：

- batch 太小 → token 浪费（每批都重复语境）+ 慢
- batch 太大 → LLM context 撑爆 / 推理质量下降

经验值：DeepSeek-v4 跑 30；GPT-4o 跑 50；本地小模型跑 10-15。

### 业务术语库

如果你的库有大量 domain-specific 命名（医疗 / 金融 / 政务），可以在 LLM system prompt 里塞术语对照：

```
gh = goods (商品)
yh = user (用户)
dd = order (订单)
zfd = payment (支付单)
```

后续 milestone 计划支持 `application.glossaryJson`，让用户在 web UI 配。

## 相关文件

- `apps/server/src/modules/dbagent/relation-candidates.ts` —— 规则层
- `apps/server/src/modules/dbagent/dbagent.service.ts` —— LLM 复核 + 批处理
- `apps/server/src/modules/dataset/do-builder.ts` —— DO 落库
- `apps/server/scripts/dbagent-eval.ts` —— eval harness
- `apps/server/scripts/fixtures/dbagent-eval/*.json` —— fixture 集

## 排障

**扫描卡住超过 5 分钟**

- 检查业务库连接池：`SHOW max_connections;` 是否被打满
- DBAgent 用单连接扫；连接没释放说明 `adapter.close()` 没跑——查 server 日志 stack

**LLM 复核失败 LLM_UPSTREAM_ERROR**

- DeepSeek 配额？换 provider：`LLM_PROVIDER=openai`
- 太大 prompt？把 batch size 调小

**关系全部 confidence 0.4**

- LLM 没真正复核——通常是 LLM 返回非 JSON。日志里搜 `LLM non-JSON`
