import type {
  ColumnDescriptor,
  ConnectionParams,
  ForeignKeyDescriptor,
  IndexDescriptor,
  IntrospectOptions,
  SchemaSnapshot,
  TableDescriptor,
  TableSample,
} from '../types';
import type { DialectAdapter } from '../dialect';
import { normalizeLogicalType } from '../logical-type';

/** MySQL / MariaDB / TiDB 通用适配器（INFORMATION_SCHEMA 方言）。 */

type MysqlConnection = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<[T[], unknown]>;
  release: () => void;
};

type MysqlPool = {
  query: <T = Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<[T[], unknown]>;
  getConnection: () => Promise<MysqlConnection>;
  end: () => Promise<void>;
};

async function loadMysql(): Promise<{ createPool: (cfg: unknown) => MysqlPool }> {
  const mod = (await import('mysql2/promise')) as unknown as {
    default?: { createPool: (cfg: unknown) => MysqlPool };
    createPool: (cfg: unknown) => MysqlPool;
  };
  return mod.default ?? mod;
}

export class MysqlAdapter implements DialectAdapter {
  readonly id = 'mysql' as const;
  private pool: MysqlPool | null = null;
  private database = '';
  /** 在 withTransaction 期间持有的固定连接；null = 没在事务里走 pool */
  private txConn: MysqlConnection | null = null;
  private txDepth = 0;

  async connect(params: ConnectionParams): Promise<void> {
    const { createPool } = await loadMysql();
    this.database = params.database;
    this.pool = createPool({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
      ssl: params.sslMode && params.sslMode !== 'disable' ? {} : undefined,
      connectionLimit: 5,
      dateStrings: true,
    });
  }

  async introspect(opts: IntrospectOptions = {}): Promise<SchemaSnapshot> {
    const p = this.requirePool();

    const [versionRows] = await p.query<{ v: string }>('select version() as v');
    const serverVersion = versionRows[0]?.v ?? '';

    const [tablesRows] = await p.query<{
      table_name: string;
      table_comment: string | null;
      table_rows: number | null;
    }>(
      `select table_name, table_comment, table_rows
         from information_schema.tables
        where table_schema = ? and table_type = 'BASE TABLE'
        order by table_name`,
      [this.database],
    );

    const include = opts.includeTables ? new Set(opts.includeTables) : null;
    const exclude = opts.excludeTables ? new Set(opts.excludeTables) : new Set<string>();

    const tables: TableDescriptor[] = [];
    for (const row of tablesRows) {
      const name = row.table_name;
      if (include && !include.has(name)) continue;
      if (exclude.has(name)) continue;

      const columns = await this.describeColumns(name);
      const indexes = await this.describeIndexes(name);
      const foreignKeys = await this.describeForeignKeys(name);

      const t: TableDescriptor = {
        schema: this.database,
        name,
        columns,
        indexes,
        foreignKeys,
      };
      if (row.table_comment) t.comment = row.table_comment;
      if (opts.includeRowCount && row.table_rows != null) t.estimatedRowCount = Number(row.table_rows);
      tables.push(t);
    }

    return {
      dialect: 'mysql',
      database: this.database,
      serverVersion,
      scannedAt: new Date().toISOString(),
      tables,
    };
  }

  private async describeColumns(table: string): Promise<ColumnDescriptor[]> {
    const p = this.requirePool();
    const [rows] = await p.query<{
      column_name: string;
      column_type: string;
      is_nullable: 'YES' | 'NO';
      column_default: string | null;
      extra: string;
      column_comment: string | null;
      column_key: string;
      ordinal_position: number;
    }>(
      `select column_name, column_type, is_nullable, column_default,
              extra, column_comment, column_key, ordinal_position
         from information_schema.columns
        where table_schema = ? and table_name = ?
        order by ordinal_position`,
      [this.database, table],
    );

    // 先收集主键顺序
    const pkOrderMap = new Map<string, number>();
    let pkIdx = 1;
    rows
      .filter((r) => r.column_key === 'PRI')
      .forEach((r) => pkOrderMap.set(r.column_name, pkIdx++));

    return rows.map((r): ColumnDescriptor => {
      const col: ColumnDescriptor = {
        name: r.column_name,
        nativeType: r.column_type,
        logicalType: normalizeLogicalType(r.column_type),
        nullable: r.is_nullable === 'YES',
        isAutoIncrement: /auto_increment/i.test(r.extra),
      };
      if (r.column_default != null) col.default = r.column_default;
      if (r.column_comment) col.comment = r.column_comment;
      const pk = pkOrderMap.get(r.column_name);
      if (pk !== undefined) col.primaryKeyOrder = pk;

      // MySQL ENUM 可以从 column_type 形如 `enum('a','b','c')` 解析
      const enumMatch = /^enum\((.+)\)$/i.exec(r.column_type);
      if (enumMatch && enumMatch[1]) {
        col.enumValues = enumMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^'|'$/g, '').replace(/''/g, "'"));
      }
      return col;
    });
  }

  private async describeIndexes(table: string): Promise<IndexDescriptor[]> {
    const p = this.requirePool();
    const [rows] = await p.query<{
      index_name: string;
      column_name: string;
      non_unique: number;
      seq_in_index: number;
    }>(
      `select index_name, column_name, non_unique, seq_in_index
         from information_schema.statistics
        where table_schema = ? and table_name = ?
        order by index_name, seq_in_index`,
      [this.database, table],
    );
    const byName = new Map<string, IndexDescriptor>();
    for (const r of rows) {
      let idx = byName.get(r.index_name);
      if (!idx) {
        idx = {
          name: r.index_name,
          columns: [],
          unique: r.non_unique === 0,
          isPrimary: r.index_name === 'PRIMARY',
        };
        byName.set(r.index_name, idx);
      }
      idx.columns.push(r.column_name);
    }
    return Array.from(byName.values());
  }

  private async describeForeignKeys(table: string): Promise<ForeignKeyDescriptor[]> {
    const p = this.requirePool();
    const [rows] = await p.query<{
      constraint_name: string;
      column_name: string;
      referenced_table_schema: string;
      referenced_table_name: string;
      referenced_column_name: string;
      update_rule: string;
      delete_rule: string;
      ordinal_position: number;
    }>(
      `select kcu.constraint_name,
              kcu.column_name,
              kcu.referenced_table_schema,
              kcu.referenced_table_name,
              kcu.referenced_column_name,
              rc.update_rule,
              rc.delete_rule,
              kcu.ordinal_position
         from information_schema.key_column_usage kcu
         join information_schema.referential_constraints rc
           on rc.constraint_schema = kcu.table_schema
          and rc.constraint_name = kcu.constraint_name
        where kcu.table_schema = ? and kcu.table_name = ?
          and kcu.referenced_table_name is not null
        order by kcu.constraint_name, kcu.ordinal_position`,
      [this.database, table],
    );
    const byName = new Map<string, ForeignKeyDescriptor>();
    for (const r of rows) {
      let fk = byName.get(r.constraint_name);
      if (!fk) {
        fk = {
          name: r.constraint_name,
          columns: [],
          referencedTable: r.referenced_table_name,
          referencedSchema: r.referenced_table_schema,
          referencedColumns: [],
          onUpdate: r.update_rule,
          onDelete: r.delete_rule,
        };
        byName.set(r.constraint_name, fk);
      }
      fk.columns.push(r.column_name);
      fk.referencedColumns.push(r.referenced_column_name);
    }
    return Array.from(byName.values());
  }

  async sampleTable(
    _schemaName: string | undefined,
    table: string,
    size: number,
  ): Promise<TableSample> {
    const p = this.requirePool();
    const ident = `\`${this.database}\`.\`${table}\``;
    const [rows] = await p.query<Record<string, unknown>>(
      `select * from ${ident} limit ${Math.max(1, Math.min(500, size))}`,
    );
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return { schema: this.database, table, columns, rows };
  }

  async runReadonly<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    // 在 withTransaction 内复用固定连接（嵌套 readonly 不另开连接）。
    if (this.txConn) {
      const [rows] = await this.txConn.query<Record<string, unknown>>(sql, params);
      return rows as unknown as T[];
    }
    const p = this.requirePool();
    // 强制只读：拿固定连接、START TRANSACTION READ ONLY、SQL、ROLLBACK、release。
    // 写类语句会被 mysql 服务端拒绝（"Cannot execute statement in a READ ONLY transaction"）。
    const conn = await p.getConnection();
    try {
      await conn.query('START TRANSACTION READ ONLY');
      const [rows] = await conn.query<Record<string, unknown>>(sql, params);
      await conn.query('ROLLBACK').catch(() => undefined);
      return rows as unknown as T[];
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      conn.release();
    }
  }

  async execute<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    // 在 withTransaction 内复用固定连接，否则用 pool（每次 query 可能不同连接）
    const runner: Pick<MysqlConnection, 'query'> = this.txConn ?? this.requirePool();
    const result = (await runner.query<Record<string, unknown>>(sql, params)) as unknown as [
      unknown,
      unknown,
    ];
    const first = result[0];
    // SELECT → rows[]；INSERT/UPDATE/DELETE → OkPacket { affectedRows, insertId }
    if (Array.isArray(first)) {
      return { rows: first as unknown as T[], rowCount: first.length };
    }
    const ok = first as { affectedRows?: number; insertId?: number };
    return { rows: [] as T[], rowCount: ok.affectedRows ?? 0 };
  }

  quoteIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`illegal identifier: ${name}`);
    }
    return `\`${name}\``;
  }

  placeholder(_index: number): string {
    return '?';
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txConn) {
      // 嵌套：复用同一连接，用 SAVEPOINT
      const conn = this.txConn;
      const sp = `sp_${this.txDepth}`;
      await conn.query(`SAVEPOINT ${sp}`);
      this.txDepth++;
      try {
        const r = await fn();
        this.txDepth--;
        await conn.query(`RELEASE SAVEPOINT ${sp}`);
        return r;
      } catch (err) {
        this.txDepth--;
        await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => undefined);
        throw err;
      }
    }
    // 顶层事务：拿固定 connection，整段 fn 都用它（含嵌套 execute / runReadonly）
    const conn = await this.requirePool().getConnection();
    this.txConn = conn;
    this.txDepth = 1;
    try {
      await conn.query('START TRANSACTION');
      const r = await fn();
      await conn.query('COMMIT');
      return r;
    } catch (err) {
      await conn.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      this.txConn = null;
      this.txDepth = 0;
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private requirePool(): MysqlPool {
    if (!this.pool) throw new Error('MysqlAdapter: not connected');
    return this.pool;
  }
}
