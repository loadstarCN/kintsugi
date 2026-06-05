import type { LogicalType } from './types';

/**
 * 把不同方言的原生类型名归一化到 LogicalType。
 * 各方言有各自的细节；这里处理最常见情况，剩下的由方言自己覆盖。
 */

const NUMERIC_INT = new Set([
  'int', 'int2', 'int4', 'int8', 'integer', 'smallint', 'tinyint', 'mediumint',
]);
const NUMERIC_BIGINT = new Set(['bigint', 'int8']);
const NUMERIC_FLOAT = new Set(['float', 'real', 'double', 'double precision']);
const NUMERIC_DECIMAL = new Set(['decimal', 'numeric', 'money']);
const STRING_TYPES = new Set(['char', 'varchar', 'character varying', 'nchar', 'nvarchar']);
const TEXT_TYPES = new Set(['text', 'tinytext', 'mediumtext', 'longtext', 'clob']);
const BINARY_TYPES = new Set(['bytea', 'blob', 'longblob', 'mediumblob', 'varbinary', 'binary']);
const DATE_TYPES = new Set(['date']);
const TIME_TYPES = new Set(['time', 'time without time zone']);
const DATETIME_TYPES = new Set(['datetime', 'timestamp', 'timestamp without time zone']);
const TIMESTAMPTZ_TYPES = new Set(['timestamptz', 'timestamp with time zone']);
const BOOL_TYPES = new Set(['bool', 'boolean', 'bit']);
const JSON_TYPES = new Set(['json', 'jsonb']);
const UUID_TYPES = new Set(['uuid']);

export function normalizeLogicalType(nativeType: string): LogicalType {
  const t = nativeType.trim().toLowerCase().replace(/\(.*\)$/, '').trim();

  if (NUMERIC_BIGINT.has(t)) return 'bigint';
  if (NUMERIC_INT.has(t)) return 'integer';
  if (NUMERIC_DECIMAL.has(t)) return 'decimal';
  if (NUMERIC_FLOAT.has(t)) return 'float';
  if (BOOL_TYPES.has(t)) return 'boolean';
  if (UUID_TYPES.has(t)) return 'uuid';
  if (JSON_TYPES.has(t)) return 'json';
  if (STRING_TYPES.has(t)) return 'string';
  if (TEXT_TYPES.has(t)) return 'text';
  if (BINARY_TYPES.has(t)) return 'binary';
  if (DATE_TYPES.has(t)) return 'date';
  if (TIME_TYPES.has(t)) return 'time';
  if (DATETIME_TYPES.has(t)) return 'datetime';
  if (TIMESTAMPTZ_TYPES.has(t)) return 'timestamptz';
  if (t.endsWith('[]')) return 'array';
  if (t.startsWith('enum')) return 'enum';
  return 'unknown';
}
