/**
 * Kintsugi Dataset Object (DO) JSON 形态定义。
 * DO 是 Dataset 的"业务契约"，是 Instant API / BFF / 页面渲染的唯一真相源。
 *
 * 来源：DBAgent 扫描 → 第一次生成；用户在 DO 编辑器里手工调整。
 * 语义约束：DO 的优先级高于页面级配置（原产品约定）。
 */

export type DoFieldRole =
  | 'primaryKey'
  | 'createdAt'
  | 'updatedAt'
  | 'softDelete'
  | 'tenantCode'
  | 'userId'
  | 'version'
  | 'foreignKey'
  | 'unknown';

export interface DoField {
  /** 原生列名，一字不差复用。 */
  name: string;
  /** 中文业务名。 */
  businessName: string;
  /** 数据库原生类型字符串（mysql int / pg varchar(n) 等）。 */
  nativeType: string;
  /** 归一化后的逻辑类型：string/int/bigint/number/bool/datetime/date/time/json/blob/uuid/enum。 */
  logicalType: string;
  nullable: boolean;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  /** 主键顺序（复合主键时有用）。 */
  primaryKeyOrder?: number;
  /** LLM 推断的字段角色（可被用户 override）。 */
  role?: DoFieldRole;
  /** 枚举值（若是 enum/tinyint 当枚举使用的字段）。 */
  enumValues?: string[];
  /** 该字段是否应出现在筛选器中（列表页可搜索）。 */
  searchable?: boolean;
  /** 是否已废弃。废弃字段不出现在新建/编辑表单、API 响应默认不返回。 */
  deprecated?: boolean;
  /** 列表显示格式化（"currency"/"datetime"/"percent" 等），页面层使用。 */
  displayFormat?: string;
  /** 原始 DB 注释。 */
  comment?: string;
}

export interface DoRelation {
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';
  confidence: number;
  /** 来源：DB 硬声明的外键 / LLM 接受的候选 / LLM 修正后的关系。 */
  source: 'declared_fk' | 'llm_accept' | 'llm_modify' | 'user_added';
  reason?: string;
}

/**
 * 行级数据规则（ABAC/RLS 应用层）：Instant API 会按 ctx.user + scope 自动追加 where。
 *  - `all`：无额外限制
 *  - `self`：仅用户自己的记录（按 userField 过滤 = ctx.user.userId）
 *  - `dept`：同部门或下级（按 deptField 过滤 in ctx.user.deptIds）
 *  - `role`：custom —— rule 字段里写一个可解析的表达式，支持 `${user.xxx}` / `${user.tenantCode}`
 */
export interface DoDataRule {
  scope: 'all' | 'self' | 'dept' | 'role';
  /** self 模式下：用哪个字段匹配 userId，默认读 DO.userField；dept 模式下：用哪个字段匹配 deptId。 */
  field?: string;
  /** role 模式下：where 片段模板，支持插值 ${user.x}，编译为 extraWhere 追加。 */
  rule?: string;
}

export interface DoJson {
  version: 1;
  tableName: string;
  alias: string;
  description?: string;
  primaryKey: string[];
  /** 特殊字段角色的快捷索引（等于 fields[].role 的汇总；冗余存便于 Instant API 读取）。 */
  softDeleteField?: string;
  versionField?: string;
  tenantField?: string;
  userField?: string;
  createdAtField?: string;
  updatedAtField?: string;
  /** 行级权限规则：由 Proxy 层在读写前追加 where。 */
  dataRule?: DoDataRule;
  fields: DoField[];
  relations: DoRelation[];
}
