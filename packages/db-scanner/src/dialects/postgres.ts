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

/**
 * PostgreSQL 适配器。
 * 用 pg 作为驱动；通过 peerDependency 按需加载，避免强依赖。
 */

type PgClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};

/**
 * pg 的数组类型 OID 如果没被 pg-types 识别，会作为字符串字面量返回（e.g. "{a,b}"）。
 * 这个 helper 健壮地接受数组或字面量字符串，统一输出 string[]。
 */
function parsePgTextArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1);
      if (inner === '') return [];
      // 简易 CSV parse：支持双引号包裹（含逗号时才会加引号）
      const out: string[] = [];
      let buf = '';
      let inQuote = false;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i]!;
        if (inQuote) {
          if (ch === '\\' && i + 1 < inner.length) {
            buf += inner[++i];
          } else if (ch === '"') {
            inQuote = false;
          } else {
            buf += ch;
          }
        } else if (ch === '"') {
          inQuote = true;
        } else if (ch === ',') {
          out.push(buf);
          buf = '';
        } else {
          buf += ch;
        }
      }
      out.push(buf);
      return out;
    }
  }
  return [];
}

interface PgTypesNS {
  setTypeParser?(oid: number, fn: (v: string) => unknown): void;
}

async function loadPg(): Promise<{
  Client: new (config: unknown) => PgClient;
  types?: PgTypesNS;
}> {
  const mod = (await import('pg')) as unknown as {
    default?: { Client: new (config: unknown) => PgClient; types?: PgTypesNS };
    Client: new (config: unknown) => PgClient;
    types?: PgTypesNS;
  };
  const resolved = mod.default ?? mod;
  return resolved as { Client: new (config: unknown) => PgClient; types?: PgTypesNS };
}

let pgTypeParsersInstalled = false;

function installPgTypeParsers(types: PgTypesNS | undefined): void {
  if (pgTypeParsersInstalled || !types?.setTypeParser) return;
  // PG 类型 OID（pg_type.oid）：
  //   20  = int8 / bigint
  //   700 = float4 / real
  //   701 = float8 / double precision
  //   1700 = numeric / decimal
  // 默认 pg 把这些都返回**字符串**避免精度损失；这里强制转 number，
  // 让 InstantApi/iframe 子应用可以直接用 toFixed/数学运算。
  // 副作用：bigint > 2^53 会精度损失；如有大整数业务，可在 DO 层声明
  // logicalType=string 并在前端单独处理。
  const toNum = (v: string): unknown => (v == null ? null : Number(v));
  types.setTypeParser(20, toNum);
  types.setTypeParser(700, toNum);
  types.setTypeParser(701, toNum);
  types.setTypeParser(1700, toNum);
  pgTypeParsersInstalled = true;
}

export class PostgresAdapter implements DialectAdapter {
  readonly id = 'postgres' as const;
  private client: PgClient | null = null;
  private schema = 'public';
  private database = '';

  async connect(params: ConnectionParams): Promise<void> {
    const { Client, types } = await loadPg();
    installPgTypeParsers(types);
    this.schema = params.schema ?? 'public';
    this.database = params.database;
    this.client = new Client({
      host: params.host,
      port: params.port,
      user: params.user,
      password: params.password,
      database: params.database,
      ssl: params.sslMode && params.sslMode !== 'disable' ? { rejectUnauthorized: false } : false,
    });
    // pg Client has .connect, cast via any to avoid importing types here.
    await (this.client as unknown as { connect: () => Promise<void> }).connect();
  }

  async introspect(opts: IntrospectOptions = {}): Promise<SchemaSnapshot> {
    const c = this.requireClient();

    const versionRes = await c.query('select version() as v');
    const serverVersion = String(versionRes.rows[0]?.['v'] ?? '');

    const tablesRes = await c.query(
      `select c.relname as name,
              obj_description(c.oid, 'pg_class') as comment,
              c.reltuples::bigint as row_estimate
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r','p')
          and n.nspname = $1
        order by c.relname`,
      [this.schema],
    );

    const include = opts.includeTables ? new Set(opts.includeTables) : null;
    const exclude = opts.excludeTables ? new Set(opts.excludeTables) : new Set<string>();

    const tables: TableDescriptor[] = [];
    for (const row of tablesRes.rows) {
      const name = String(row['name']);
      if (include && !include.has(name) && !include.has(`${this.schema}.${name}`)) continue;
      if (exclude.has(name) || exclude.has(`${this.schema}.${name}`)) continue;

      const columns = await this.describeColumns(name);
      const indexes = await this.describeIndexes(name);
      const foreignKeys = await this.describeForeignKeys(name);

      const t: TableDescriptor = {
        schema: this.schema,
        name,
        columns,
        indexes,
        foreignKeys,
      };
      const commentVal = row['comment'];
      if (commentVal != null) t.comment = String(commentVal);
      if (opts.includeRowCount && row['row_estimate'] != null) {
        t.estimatedRowCount = Number(row['row_estimate']);
      }
      tables.push(t);
    }

    return {
      dialect: 'postgres',
      database: this.database,
      serverVersion,
      scannedAt: new Date().toISOString(),
      tables,
    };
  }

  private async describeColumns(table: string): Promise<ColumnDescriptor[]> {
    const c = this.requireClient();
    const { rows } = await c.query(
      `select a.attname as name,
              pg_catalog.format_type(a.atttypid, a.atttypmod) as native_type,
              not a.attnotnull as nullable,
              pg_get_expr(ad.adbin, ad.adrelid) as default_expr,
              a.attidentity as identity,
              col_description(a.attrelid, a.attnum) as comment,
              pk.pk_order as pk_order
         from pg_attribute a
         left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
         left join lateral (
           select u.ordinality as pk_order
             from pg_constraint ct2
             cross join unnest(ct2.conkey) with ordinality as u(attnum, ordinality)
            where ct2.conrelid = a.attrelid
              and ct2.contype = 'p'
              and u.attnum = a.attnum
            limit 1
         ) pk on true
        where a.attrelid = ($1 || '.' || $2)::regclass
          and a.attnum > 0
          and not a.attisdropped
        order by a.attnum`,
      [this.schema, table],
    );

    return rows.map((r): ColumnDescriptor => {
      const nativeType = String(r['native_type'] ?? '');
      const col: ColumnDescriptor = {
        name: String(r['name']),
        nativeType,
        logicalType: normalizeLogicalType(nativeType),
        nullable: Boolean(r['nullable']),
        isAutoIncrement: r['identity'] === 'a' || r['identity'] === 'd',
      };
      if (r['default_expr'] != null) col.default = String(r['default_expr']);
      if (r['pk_order'] != null) col.primaryKeyOrder = Number(r['pk_order']);
      if (r['comment'] != null) col.comment = String(r['comment']);
      return col;
    });
  }

  private async describeIndexes(table: string): Promise<IndexDescriptor[]> {
    const c = this.requireClient();
    const { rows } = await c.query(
      `select i.relname as name,
              ix.indisunique as is_unique,
              ix.indisprimary as is_primary,
              array_agg(a.attname order by k.ordinality) as columns
         from pg_index ix
         join pg_class i on i.oid = ix.indexrelid
         join pg_class t on t.oid = ix.indrelid
         join pg_namespace n on n.oid = t.relnamespace
         join unnest(ix.indkey) with ordinality as k(attnum, ordinality) on true
         join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
        where n.nspname = $1 and t.relname = $2
        group by i.relname, ix.indisunique, ix.indisprimary`,
      [this.schema, table],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      columns: parsePgTextArray(r['columns']),
      unique: Boolean(r['is_unique']),
      isPrimary: Boolean(r['is_primary']),
    }));
  }

  private async describeForeignKeys(table: string): Promise<ForeignKeyDescriptor[]> {
    const c = this.requireClient();
    const { rows } = await c.query(
      `select con.conname as name,
              array_agg(att.attname order by k.ordinality) as columns,
              cl2.relname as ref_table,
              ns2.nspname as ref_schema,
              array_agg(att2.attname order by k.ordinality) as ref_columns,
              con.confupdtype as on_update,
              con.confdeltype as on_delete
         from pg_constraint con
         join pg_class cl on cl.oid = con.conrelid
         join pg_namespace ns on ns.oid = cl.relnamespace
         join unnest(con.conkey) with ordinality as k(attnum, ordinality) on true
         join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
         join pg_class cl2 on cl2.oid = con.confrelid
         join pg_namespace ns2 on ns2.oid = cl2.relnamespace
         join unnest(con.confkey) with ordinality as k2(attnum, ordinality)
              on k2.ordinality = k.ordinality
         join pg_attribute att2 on att2.attrelid = cl2.oid and att2.attnum = k2.attnum
        where con.contype = 'f' and ns.nspname = $1 and cl.relname = $2
        group by con.conname, cl2.relname, ns2.nspname, con.confupdtype, con.confdeltype`,
      [this.schema, table],
    );
    return rows.map(
      (r): ForeignKeyDescriptor => ({
        name: String(r['name']),
        columns: parsePgTextArray(r['columns']),
        referencedTable: String(r['ref_table']),
        referencedSchema: r['ref_schema'] ? String(r['ref_schema']) : undefined,
        referencedColumns: parsePgTextArray(r['ref_columns']),
        onUpdate: r['on_update'] ? String(r['on_update']) : undefined,
        onDelete: r['on_delete'] ? String(r['on_delete']) : undefined,
      }),
    );
  }

  async sampleTable(schemaName: string | undefined, table: string, size: number): Promise<TableSample> {
    const c = this.requireClient();
    const ns = schemaName ?? this.schema;
    // use quoted identifiers via pg's format; we build it manually and rely on
    // the table / schema coming from previously introspected names (trusted).
    const ident = `"${ns}"."${table}"`;
    const { rows } = await c.query(`select * from ${ident} limit ${Math.max(1, Math.min(500, size))}`);
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return { schema: ns, table, columns, rows };
  }

  async runReadonly<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const c = this.requireClient();
    // 强制只读：BEGIN ... READ ONLY 之后 INSERT/UPDATE/DELETE/DDL 由 PG 拒绝。
    // ROLLBACK 而非 COMMIT —— 反正 SELECT 没副作用，ROLLBACK 更稳。
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
    try {
      const { rows } = await c.query(sql, params);
      return rows as unknown as T[];
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
    }
  }

  async execute<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const c = this.requireClient();
    const res = (await c.query(sql, params)) as {
      rows: Array<Record<string, unknown>>;
      rowCount?: number | null;
    };
    return {
      rows: (res.rows ?? []) as unknown as T[],
      rowCount: res.rowCount ?? res.rows?.length ?? 0,
    };
  }

  quoteIdentifier(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`illegal identifier: ${name}`);
    }
    return `"${name}"`;
  }

  placeholder(index: number): string {
    return `$${index}`;
  }

  private txDepth = 0;

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const c = this.requireClient();
    if (this.txDepth === 0) {
      await c.query('BEGIN');
    } else {
      await c.query(`SAVEPOINT sp_${this.txDepth}`);
    }
    this.txDepth++;
    try {
      const r = await fn();
      this.txDepth--;
      if (this.txDepth === 0) {
        await c.query('COMMIT');
      } else {
        await c.query(`RELEASE SAVEPOINT sp_${this.txDepth}`);
      }
      return r;
    } catch (err) {
      this.txDepth--;
      if (this.txDepth === 0) {
        await c.query('ROLLBACK').catch(() => undefined);
      } else {
        await c.query(`ROLLBACK TO SAVEPOINT sp_${this.txDepth}`).catch(() => undefined);
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client?.end();
    this.client = null;
  }

  private requireClient(): PgClient {
    if (!this.client) throw new Error('PostgresAdapter: not connected');
    return this.client;
  }
}
