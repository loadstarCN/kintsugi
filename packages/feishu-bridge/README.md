# @kintsugi/feishu-bridge ⏸️ v2

飞书 / 钉钉 / 企微机器人 ↔ Kintsugi Runtime CLI 桥接。

## 架构

```
飞书群（业务人员）
  │  @机器人 "查近 7 天付款成功未发货的订单，按仓库汇总"
  ▼
Feishu event webhook
  │
Kintsugi Feishu Bridge
  │ 认证 → 用户映射（飞书 openId → Kintsugi userId）
  │ 把 NL 送到 /api/chats/ask 或匹配预定义 BFF endpoint
  ▼
Runtime CLI / MCP
  ▼
目标业务库
  │ 结果
  ▼
飞书消息 / 文档 / 邮件
```

## 短期可继续

- `packages/feishu-bridge/src/webhook.ts`：收 Feishu event，提取 text，识别 @ mention。
- Skills 已经写了 kintsugi-runtime，Agent 的运行 SOP 已经明确。

## 依赖

- 飞书开放平台：Event Subscription + Message Card + Tenant Access Token。
- 建议直接用 `@larksuiteoapi/node-sdk`。
