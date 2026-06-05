# Tenant / Application / Dataset

Kintsugi 的核心三层模型。

```
Tenant (tenantCode)              "demo" / "acme-corp"
  └── Application (appCode)      "app-demo0001" / "app-acme-erp"
        ├── DataSource (id)      指向客户业务库的连接配置
        │     └── Dataset (datasetCode) 客户业务表的元数据 + DO
        ├── Page                 KintsugiPage / React 子应用
        ├── Menu
        ├── BffScript
        ├── CustomSql
        └── AccessKey            HMAC OpenAPI 凭据
```

## Tenant（租户）

最外层隔离单位。一个 Kintsugi 实例可以承载 N 个租户；它们之间数据完全不互通：

- `Application.tenantCode` 是 FK；任何跨 tenant 访问被 `TenantGuard` 拦
- `User.tenantCode` 决定登录后能看到哪些 application
- AI credit / 计费按 tenant 维度（`AiCreditTx`）

`tenantCode` 是字符串主键，不可变。

## Application（应用）

一个业务系统对应一个 application。`appCode` 格式 `app-xxxxxxxx`（前缀 + 8 位 base36 随机），全局唯一。

一个 application 可以挂**多个** DataSource（异构多库混合，比如主表在 MySQL、日志表在 TiDB）。

::: tip 选 appCode 的实际策略

- 一个客户一个 application 简单粗暴，不行就拆
- 拆的时机：业务域明显隔离 + 没有跨域 JOIN 需求
- 不要用 appCode 表达环境（dev/staging/prod）—— 用 `Environment` 字段
  :::

## DataSource

指向**客户业务库**的连接配置。重要字段：

| 字段                         | 用途                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| `dialect`                    | postgres / mysql / mariadb / tidb / mssql / oracle / sqlite |
| `host` / `port` / `database` | 标识                                                        |
| `schema`                     | PG 用；MySQL 忽略                                           |
| `username`                   | 建议给只读用户                                              |
| `passwordCiphertext`         | AES-256-GCM 加密；ENCRYPTION_KEY 决定能否解                 |
| `sslMode`                    | `disable` / `require` / `verify-full`                       |
| `extraParams`                | dialect-specific override                                   |

**密码永远不出库**：`encrypt()` 走 AES-GCM；`secretKeyHash` 字段名是历史遗留——它**不是 hash**，是密文。HMAC 验签需要解密原文。

## Dataset

业务库的**一张表**对应一条 Dataset：

| 字段                                     | 含义                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `datasetCode`                            | 32 字符 `ds...`，全局唯一                             |
| `appCode` + `dataSourceId` + `tableName` | 唯一组合（同一表只能属于一个 dataset）                |
| `alias`                                  | 中文业务名                                            |
| `doJson`                                 | DO（Dataset Object）—— 字段、关系、特殊角色、dataRule |
| `version`                                | 乐观锁版本号；并发编辑用                              |
| `isDeleted`                              | 软删除                                                |

**DO 是优先级最高的契约**——它能说"业务名应该是什么"、"哪个字段是 tenant 字段"、"哪些字段已废弃不暴露"，Instant API / 页面渲染 / SDK 都按 DO 跑。详见 [DO 章节](./do)。

## 实体关系图

```
                 Tenant (tenantCode)
                    │ 1:N
                    ▼
              Application (appCode)
                    │ 1:N           1:N
        ┌───────────┼─────────────────┐
        ▼           ▼                 ▼
   DataSource    Page              BffScript / CustomSql / AccessKey
        │ 1:N
        ▼
     Dataset (datasetCode)
        │
        └── doJson (字段/关系/特殊字段/dataRule)
```

## 怎么去 web UI 看

| 想看                  | 路径                               |
| --------------------- | ---------------------------------- |
| 我所有租户的应用      | `/applications`                    |
| 单应用详情            | `/applications/:appCode`           |
| 应用下所有 DataSource | `/applications/:appCode`（详情页） |
| Dataset 列表          | `/datasets`                        |
| DO 编辑器             | `/datasets/:datasetCode`           |
| ER 图                 | `/datasources/:dsId/er`            |
| 数据浏览器            | `/datasets/:datasetCode/data`      |
