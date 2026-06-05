# DO（Dataset Object）

DO 是 Kintsugi 里**业务的真相源**。任何"这个字段是什么意思 / 这张表怎么和别的表关联 / 谁能看到哪行"的问题都从 DO 找答案。

DO 是 `Dataset.doJson` 字段，结构是 `DoJson`：

```ts
interface DoJson {
  version: 1;
  tableName: string;
  alias: string; // 中文业务名
  primaryKey: string[]; // 主键列名（支持复合键）
  softDeleteField?: string; // 软删除标记列（如 'is_deleted'）
  versionField?: string; // 乐观锁列（如 'version' / 'updated_at'）
  tenantField?: string; // 多租户隔离列（如 'tenant_code'）
  userField?: string; // 创建人列（用于 RLS 'self' scope）
  createdAtField?: string;
  updatedAtField?: string;
  dataRule?: DoDataRule; // 行级权限规则
  fields: DoField[];
  relations: DoRelation[];
}
```

## DO 的优先级

> **DO > 页面配置**

页面层（筛选器顺序、表单分组等）无法 override DO 上声明的契约。比如 DO 说 `email` 是必填，页面不能放行空值；DO 说 `password` 已废弃，页面默认不渲染这个字段。

## fields 数组

每条字段：

```ts
interface DoField {
  name: string; // 列名（不变）
  businessName: string; // 中文业务名
  nativeType: string; // mysql int / pg varchar(64) ...
  logicalType: string; // string / int / bigint / number / bool / datetime ...
  nullable: boolean;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  primaryKeyOrder?: number;
  role?:
    | 'primaryKey'
    | 'createdAt'
    | 'updatedAt'
    | 'softDelete'
    | 'tenantCode'
    | 'userId'
    | 'version'
    | 'foreignKey'
    | 'unknown';
  enumValues?: string[]; // 枚举值（tinyint 当 enum 用时）
  searchable?: boolean; // 出现在筛选器
  deprecated?: boolean; // 废弃 → API/UI 默认不展示
  displayFormat?: string; // currency / datetime / percent / ...
  comment?: string;
}
```

`role` 是 LLM 推断的字段语义，可被人工 override；DO 的特殊字段索引（`tenantField`、`userField` 等）就是 `fields[].role` 的快捷查询。

## relations 数组

```ts
interface DoRelation {
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';
  confidence: number;
  source: 'declared_fk' | 'llm_accept' | 'llm_modify' | 'user_added';
  reason?: string;
}
```

- `declared_fk` — DB 硬声明的外键（confidence 通常 1.0）
- `llm_accept` — LLM 接受了规则层候选
- `llm_modify` — LLM 改写了候选关系
- `user_added` — 人工补的关系

## dataRule（行级权限）

```ts
interface DoDataRule {
  scope: 'all' | 'self' | 'dept' | 'role';
  field?: string;
  rule?: string; // role 模式下的表达式
}
```

| scope  | 含义                                  |
| ------ | ------------------------------------- |
| `all`  | 不加额外过滤（仍受 tenantField 限定） |
| `self` | 仅 `userField = ctx.user.userId`      |
| `dept` | `field IN ctx.user.deptIds`           |
| `role` | 自定义表达式，支持 `${user.xxx}` 插值 |

例子（订单只对自己可见）：

```json
{
  "userField": "owner_id",
  "dataRule": { "scope": "self" }
}
```

例子（按状态 + 用户限制）：

```json
{
  "dataRule": {
    "scope": "role",
    "rule": "status = 'active' AND owner_id = ${user.userId}"
  }
}
```

dataRule 在 [Instant API](/concepts/instant-api) 和 [BFF](/concepts/bff) 调用前自动注入到 SQL where 里。

## DO 是怎么生成的

```
DBAgent 扫描
   │
   ▼
SchemaSnapshot（原始 introspection）
   │
   ▼
规则层（findRelationCandidates）→ 关系候选
   │
   ▼
LLM 复核（分批）→ 业务语义 + role 推断
   │
   ▼
buildDoJsonForTable() → DoJson（首版）
   │
   ▼
人工在 DO 编辑器里调整
   │
   ▼
持久化 + version + 1
```

## DO 编辑器

`/datasets/:datasetCode` —— 改 alias、`fields[].businessName`、`role`、`deprecated`、`enumValues`、`dataRule`。

::: tip 乐观锁
保存时带上 `expectedVersion`（GET 时拿到）。被别人先改 → 服务端返回
`BLOCKED_BY_CONCURRENT_EDIT`，提示先 reload。
:::

## 谁读 DO

| 读取方         | 用途                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| Instant API    | 字段白名单、tenantField/userField 注入、softDelete 过滤、dataRule 编译 |
| BFF runtime    | `client.models.<table>.*` 透传走 Instant API                           |
| OpenAPI 生成   | swagger schema 用 DO 字段                                              |
| 页面渲染（v0） | LLM 生成 React 时把 DO 喂进 prompt                                     |
| RLS 策略生成   | `emitRlsPolicy(doJson)` 输出 PG `CREATE POLICY` SQL                    |
