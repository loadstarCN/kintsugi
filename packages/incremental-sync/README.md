# @kintsugi/incremental-sync ⏸️ v2

源库 schema 变化的增量同步。

## 场景

客户业务库 DBA 在 orders 表加了一个字段 `is_vip`。下一次 Kintsugi 运行时需要：

- 识别出新增字段（diff snapshot vs current introspect）；
- 自动扩展对应 Dataset 的 DO JSON（append field，不改旧字段）；
- 通知调用方"schema 变了，记得在 UI / 导出接口上回归"。

## 起点

- 后端新 cron：每 N 分钟 `/api/dbagent/datasources/:id/scan` + 对比上一次的 snapshot；
- 产出 `SchemaDiff { added[], removed[], modified[] }`；
- 对 added 字段走 "additive merge" 直接更新 DO；对 removed/modified 人工确认（写进 `PendingMigration` 表）。

## 复用

- `packages/db-scanner` 已经产出归一化 snapshot；
- 只需要一个 diff 工具 + 一张 migration 表 + 一个简单 web 页面。
