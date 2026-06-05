export * from './types';
export * from './dialect';
export * from './logical-type';

import { registerDialect } from './dialect';
import { PostgresAdapter } from './dialects/postgres';
import { MysqlAdapter } from './dialects/mysql';
import { UnsupportedAdapter } from './dialects/unsupported';

/**
 * 默认注册方言。调用方可以在启动时手动 override / 追加。
 * 先上 postgres + mysql；mssql/oracle/sqlite/mariadb/tidb 暂时用 UnsupportedAdapter 占位。
 */
export function registerDefaultDialects(): void {
  registerDialect('postgres', () => new PostgresAdapter());
  registerDialect('mysql', () => new MysqlAdapter());
  registerDialect('mariadb', () => new MysqlAdapter()); // 与 MySQL 共享 INFORMATION_SCHEMA
  registerDialect('tidb', () => new MysqlAdapter());
  registerDialect('mssql', () => new UnsupportedAdapter('mssql'));
  registerDialect('oracle', () => new UnsupportedAdapter('oracle'));
  registerDialect('sqlite', () => new UnsupportedAdapter('sqlite'));
}
