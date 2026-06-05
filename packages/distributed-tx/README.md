# @kintsugi/distributed-tx ⏸️ v2

分布式事务 / 分布式追踪。

## 现状

- **单库事务**：由 `adapter.execute` 逐句执行，BFF 里可以用 `BEGIN/COMMIT` 字面量 —— 未封装。
- **跨库事务**：无（一个 BFF 里调不同 DataSource.openAdapter，各自独立事务）。
- **traceparent** header 已采集并写入 AuditLog，但没发 OTel exporter。

## 目标

1. `context.client.tx(async (tx) => { ... })`：BFF 内声明式事务。
2. 跨库 Saga：`@kintsugi/distributed-tx/saga` 提供补偿事务 DSL。
3. 接 OpenTelemetry：从 NestJS 入口开始生成 span，下传到 adapter 执行。

## 起点

- `packages/distributed-tx/src/saga.ts`：状态机 + 补偿表。
- 先做 **同库事务 context 注入**：InstantApiService 暴露 `runInTx(cb)`，BFF context 挂 `tx`。

## 先读

- 原产品 `docs/12_BackendFunction.txt` 的"编程式事务"段落。
