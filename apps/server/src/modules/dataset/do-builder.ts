/**
 * 把 DBAgent 的 SchemaSnapshot + inferredModel 合成一份初始 DO JSON。
 * 用户在前端 DO 编辑器里继续调整；Instant API 从这里读白名单。
 */

import type { SchemaSnapshot } from '@kintsugi/db-scanner';
import type { DoField, DoFieldRole, DoJson, DoRelation } from './do';

type InferredTable = {
  tableName: string;
  businessName?: string;
  fields?: Array<{ columnName: string; businessName?: string; role?: string }>;
};

type InferredRelation = {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: string;
  confidence: number;
  decision: 'accept' | 'reject' | 'modify';
};

type InferredSpecialField = { tableName: string; columnName: string; role: string };

interface InferredModel {
  tables?: InferredTable[];
  inferredRelations?: InferredRelation[];
  specialFields?: InferredSpecialField[];
}

const FIELD_ROLE_WHITELIST = new Set<DoFieldRole>([
  'primaryKey',
  'createdAt',
  'updatedAt',
  'softDelete',
  'tenantCode',
  'userId',
  'version',
  'foreignKey',
  'unknown',
]);

function normRole(raw?: string): DoFieldRole | undefined {
  if (!raw) return undefined;
  return FIELD_ROLE_WHITELIST.has(raw as DoFieldRole) ? (raw as DoFieldRole) : 'unknown';
}

export function buildDoJsonForTable(
  table: SchemaSnapshot['tables'][number],
  inferred: InferredModel,
): DoJson {
  const semTable = inferred.tables?.find((t) => t.tableName === table.name);
  const colSemMap = new Map(
    semTable?.fields?.map((f) => [f.columnName, f]) ?? [],
  );
  const specMap = new Map(
    (inferred.specialFields ?? [])
      .filter((s) => s.tableName === table.name)
      .map((s) => [s.columnName, s.role]),
  );

  const pkCols = table.columns
    .filter((c) => c.primaryKeyOrder !== undefined)
    .sort((a, b) => (a.primaryKeyOrder ?? 0) - (b.primaryKeyOrder ?? 0));

  const fields: DoField[] = table.columns.map((c): DoField => {
    const sem = colSemMap.get(c.name);
    const role = normRole(sem?.role ?? specMap.get(c.name));
    const f: DoField = {
      name: c.name,
      businessName: sem?.businessName?.trim() || c.name,
      nativeType: c.nativeType,
      logicalType: c.logicalType,
      nullable: c.nullable,
      isPrimary: c.primaryKeyOrder !== undefined,
      isAutoIncrement: c.isAutoIncrement,
      searchable: false,
      deprecated: false,
    };
    if (c.primaryKeyOrder !== undefined) f.primaryKeyOrder = c.primaryKeyOrder;
    if (role) f.role = role;
    if (c.enumValues) f.enumValues = c.enumValues;
    if (c.comment) f.comment = c.comment;
    // 命名相关的列默认可搜索（避免筛选器一片空白）
    const unsearchable = new Set(['binary', 'json', 'array']);
    if (
      /name|title|code|status|type|phone|email|no$|number$/i.test(c.name) &&
      !unsearchable.has(c.logicalType)
    ) {
      f.searchable = true;
    }
    return f;
  });

  // 关系：声明外键 + LLM accept/modify 的关系（过滤掉 reject 和 与声明重复的）
  const declaredFkKey = new Set(
    table.foreignKeys.map((fk) => fkKey(table.name, fk.columns, fk.referencedTable, fk.referencedColumns)),
  );
  const relations: DoRelation[] = [];
  for (const fk of table.foreignKeys) {
    relations.push({
      fromColumns: asStringArray(fk.columns),
      toTable: fk.referencedTable,
      toColumns: asStringArray(fk.referencedColumns),
      cardinality: 'manyToOne',
      confidence: 1,
      source: 'declared_fk',
    });
  }
  for (const r of inferred.inferredRelations ?? []) {
    if (r.fromTable !== table.name) continue;
    if (r.decision === 'reject') continue;
    if (declaredFkKey.has(fkKey(r.fromTable, r.fromColumns, r.toTable, r.toColumns))) continue;
    relations.push({
      fromColumns: r.fromColumns,
      toTable: r.toTable,
      toColumns: r.toColumns,
      cardinality: (['manyToOne', 'oneToMany', 'oneToOne', 'manyToMany'] as const).includes(
        r.cardinality as 'manyToOne',
      )
        ? (r.cardinality as DoRelation['cardinality'])
        : 'manyToOne',
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
      source: r.decision === 'modify' ? 'llm_modify' : 'llm_accept',
    });
  }

  // 特殊字段反推 DO 层级快捷字段
  const byRole = (role: DoFieldRole) =>
    fields.find((f) => f.role === role)?.name;

  const alias = semTable?.businessName?.trim() || table.comment || table.name;

  const doJson: DoJson = {
    version: 1,
    tableName: table.name,
    alias,
    primaryKey: pkCols.map((c) => c.name),
    fields,
    relations,
  };
  if (table.comment) doJson.description = table.comment;
  const softDelete = byRole('softDelete');
  if (softDelete) doJson.softDeleteField = softDelete;
  const version = byRole('version');
  if (version) doJson.versionField = version;
  const tenant = byRole('tenantCode');
  if (tenant) doJson.tenantField = tenant;
  const user = byRole('userId');
  if (user) doJson.userField = user;
  const createdAt = byRole('createdAt');
  if (createdAt) doJson.createdAtField = createdAt;
  const updatedAt = byRole('updatedAt');
  if (updatedAt) doJson.updatedAtField = updatedAt;

  return doJson;
}

/** 兼容老快照里因 pg 驱动数组 OID 未识别而把 columns 存成 "{a,b}" 的情况。 */
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  }
  return [];
}

function fkKey(fromT: string, fromC: string[] | unknown, toT: string, toC: string[] | unknown): string {
  return `${fromT}|${asStringArray(fromC).join(',')}->${toT}|${asStringArray(toC).join(',')}`;
}
