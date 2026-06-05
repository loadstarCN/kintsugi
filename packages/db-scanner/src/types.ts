/**
 * 方言无关的表/列/关系描述模型。
 * 所有 Dialect 实现必须把它们的 native metadata 归一化到这些结构。
 */

export type DialectId =
  | 'postgres'
  | 'mysql'
  | 'mssql'
  | 'oracle'
  | 'sqlite'
  | 'mariadb'
  | 'tidb';

/** 归一化的数据类型分类 — 供 DBAgent / Instant API 统一处理。 */
export type LogicalType =
  | 'string'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'time'
  | 'timestamptz'
  | 'json'
  | 'binary'
  | 'uuid'
  | 'enum'
  | 'array'
  | 'unknown';

export interface ColumnDescriptor {
  name: string;
  /** 原始方言类型字符串，比如 `varchar(255)` / `timestamp without time zone`。 */
  nativeType: string;
  logicalType: LogicalType;
  nullable: boolean;
  /** 显式默认值字符串 (SQL 表达式)，没有就是 undefined。 */
  default?: string;
  /** 主键顺位 (1-based) 若是复合主键；不是主键就是 undefined。 */
  primaryKeyOrder?: number;
  /** 自增 / SERIAL / IDENTITY。 */
  isAutoIncrement: boolean;
  /** 可能的枚举取值 (来自 MySQL ENUM / PG CHECK 约束 / 等，尽力而为)。 */
  enumValues?: string[];
  /** 长度 / 精度 / 标度，尽可能填。 */
  length?: number;
  precision?: number;
  scale?: number;
  comment?: string;
}

export interface IndexDescriptor {
  name: string;
  columns: string[];
  unique: boolean;
  /** 是否是主键实现的 unique index。 */
  isPrimary: boolean;
}

export interface ForeignKeyDescriptor {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedSchema?: string;
  referencedColumns: string[];
  onUpdate?: string;
  onDelete?: string;
}

export interface TableDescriptor {
  schema?: string; // PG 有 schema 概念；MySQL 用 database 作 schema
  name: string;
  comment?: string;
  estimatedRowCount?: number;
  columns: ColumnDescriptor[];
  indexes: IndexDescriptor[];
  foreignKeys: ForeignKeyDescriptor[];
}

/** 随机抽样的少量样本行，用于关系推理时的 join 验证 / 语义推断。 */
export interface TableSample {
  schema?: string;
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

export interface SchemaSnapshot {
  dialect: DialectId;
  database: string;
  /** `serverVersion` 可选，仅用于诊断 / 日志。 */
  serverVersion?: string;
  scannedAt: string; // ISO
  tables: TableDescriptor[];
}

/** 方言实现都接受这个结构。字段是否必填由各方言自行校验。 */
export interface ConnectionParams {
  dialect: DialectId;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** PG 独有。 */
  schema?: string;
  /** SSL 模式；各方言解读略不同。 */
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
  /** 自由形式的附加参数，方言特有的透传项。 */
  extra?: Record<string, string>;
}

export interface IntrospectOptions {
  /** 白名单：只扫描这些表 (schema-qualified or bare)。 */
  includeTables?: string[];
  /** 黑名单：排除这些表。 */
  excludeTables?: string[];
  /** 是否取 estimatedRowCount (某些方言此操作昂贵)。 */
  includeRowCount?: boolean;
  /** 是否抽样。 */
  sampleRows?: boolean;
  /** 每张表抽几行。 */
  sampleSize?: number;
}
