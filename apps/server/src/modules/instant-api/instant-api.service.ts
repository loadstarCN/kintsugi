import { Injectable, Logger } from '@nestjs/common';
import { KintsugiError } from '@kintsugi/shared';
import type { DialectAdapter } from '@kintsugi/db-scanner';
import { PrismaService } from '../../prisma/prisma.service';
import { DataSourceService } from '../datasource/datasource.service';
import { DatasetService } from '../dataset/dataset.service';
import type { DoField, DoJson } from '../dataset/do';
import { SqlBuilder, type FilterClause, type FilterOp } from './sql-builder';
import { compileRlsClauses, type CtxUser as RlsCtxUser } from './rls';

export interface FilterRequest {
  where?: Array<{ field: string; op: FilterOp; value?: unknown }>;
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  page?: number;
  pageSize?: number;
  /** 选哪几列；不传 = 全部非 deprecated 列 */
  select?: string[];
  /** 是否包含软删除行（默认 false）。 */
  includeDeleted?: boolean;
}

export interface FilterResponse {
  data: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
}

type CtxUser = RlsCtxUser;

/**
 * 可选的"外部 adapter"注入。BFF 真事务期间，主进程会先 openAdapter + BEGIN，
 * 然后把这个 adapter 透传给 InstantApi 各方法，跳过它们自己的 open/close 逻辑。
 * 这样 fn 内多次 InstantApi 调用共享同一连接 + 事务边界。
 */
export interface InstantApiCallOpts {
  adapter?: DialectAdapter;
}

@Injectable()
export class InstantApiService {
  private readonly logger = new Logger(InstantApiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dsService: DataSourceService,
    private readonly datasetService: DatasetService,
  ) {}

  async filter(
    appCode: string,
    datasetCode: string,
    req: FilterRequest,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<FilterResponse> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      const allowedCols = this.whitelistColumns(doJson);
      const selectCols =
        req.select?.length ? req.select.filter((c) => allowedCols.has(c)) : [...allowedCols];
      if (selectCols.length === 0) throw new KintsugiError('VALIDATION_FAILED', 'empty select');

      const where = (req.where ?? [])
        .filter((w) => allowedCols.has(w.field))
        .map((w): FilterClause => ({ field: w.field, op: w.op, value: w.value }));
      const extraWhere = this.baseExtraWhere(doJson, _user, req.includeDeleted === true);

      const orderBy = (req.orderBy ?? [])
        .filter((o) => allowedCols.has(o.field))
        .map((o) => ({ field: o.field, direction: (o.direction ?? 'asc') as 'asc' | 'desc' }));
      if (orderBy.length === 0 && doJson.primaryKey.length) {
        orderBy.push({ field: doJson.primaryKey[0]!, direction: 'desc' });
      }

      const page = Math.max(1, req.page ?? 1);
      const pageSize = Math.min(Math.max(1, req.pageSize ?? 20), 200);
      const offset = (page - 1) * pageSize;

      const sb = new SqlBuilder(adapter);
      const selectQ = sb.buildSelect({
        schema: schemaName,
        table: tableName,
        columns: selectCols,
        where,
        extraWhere,
        orderBy,
        limit: pageSize,
        offset,
      });
      const countQ = sb.buildCount({
        schema: schemaName,
        table: tableName,
        where,
        extraWhere,
      });

      const [dataRes, countRes] = await Promise.all([
        adapter.execute<Record<string, unknown>>(selectQ.sql, selectQ.params),
        adapter.execute<{ total: string | number }>(countQ.sql, countQ.params),
      ]);

      const total = Number(countRes.rows[0]?.total ?? 0);
      return { data: dataRes.rows, page, pageSize, total };
    } finally {
      await release();
    }
  }

  async getOne(
    appCode: string,
    datasetCode: string,
    id: string,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<Record<string, unknown>> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      if (doJson.primaryKey.length === 0) {
        throw new KintsugiError('VALIDATION_FAILED', 'dataset has no primary key');
      }
      const allowedCols = this.whitelistColumns(doJson);
      const pkCol = doJson.primaryKey[0]!;
      const sb = new SqlBuilder(adapter);
      const q = sb.buildSelect({
        schema: schemaName,
        table: tableName,
        columns: [...allowedCols],
        where: [{ field: pkCol, op: 'eq', value: castToField(id, doJson, pkCol) }],
        extraWhere: this.baseExtraWhere(doJson, _user, false),
        limit: 1,
      });
      const res = await adapter.execute<Record<string, unknown>>(q.sql, q.params);
      const row = res.rows[0];
      if (!row) throw new KintsugiError('NOT_FOUND', `row ${id} not found`);
      return row;
    } finally {
      await release();
    }
  }

  async create(
    appCode: string,
    datasetCode: string,
    data: Record<string, unknown>,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<Record<string, unknown>> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      const supportsReturning = adapter.id === 'postgres';
      const cols: string[] = [];
      const vals: unknown[] = [];
      for (const field of doJson.fields) {
        if (field.deprecated) continue;
        if (field.isAutoIncrement) continue;
        if (!(field.name in data)) continue;
        cols.push(field.name);
        vals.push(data[field.name]);
      }
      // 自动补时间戳
      const now = new Date();
      if (doJson.createdAtField && !cols.includes(doJson.createdAtField)) {
        cols.push(doJson.createdAtField);
        vals.push(now);
      }
      if (doJson.updatedAtField && !cols.includes(doJson.updatedAtField)) {
        cols.push(doJson.updatedAtField);
        vals.push(now);
      }
      if (cols.length === 0) throw new KintsugiError('VALIDATION_FAILED', 'empty payload');

      const sb = new SqlBuilder(adapter);
      const q = sb.buildInsert({
        schema: schemaName,
        table: tableName,
        columns: cols,
        values: vals,
        supportsReturning,
      });
      const res = await adapter.execute<Record<string, unknown>>(q.sql, q.params);

      if (supportsReturning && res.rows[0]) return res.rows[0];
      // mysql fallback：若有 PK 则按 last insert id 再查一次
      if (doJson.primaryKey.length === 1 && adapter.id === 'mysql') {
        const pk = doJson.primaryKey[0]!;
        const inserted = data[pk];
        if (inserted != null) {
          return this.getOneRaw(adapter, tableName, schemaName, doJson, String(inserted));
        }
      }
      return { ok: true, rowCount: res.rowCount };
    } finally {
      await release();
    }
  }

  async update(
    appCode: string,
    datasetCode: string,
    id: string,
    data: Record<string, unknown>,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<Record<string, unknown>> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      if (doJson.primaryKey.length === 0) {
        throw new KintsugiError('VALIDATION_FAILED', 'dataset has no primary key');
      }
      const pkCol = doJson.primaryKey[0]!;
      const supportsReturning = adapter.id === 'postgres';

      const cols: string[] = [];
      const vals: unknown[] = [];
      const allowedCols = this.whitelistColumns(doJson);
      for (const [k, v] of Object.entries(data)) {
        if (!allowedCols.has(k)) continue;
        if (k === pkCol) continue;
        const field = doJson.fields.find((f) => f.name === k);
        if (field?.deprecated) continue;
        cols.push(k);
        vals.push(v);
      }
      if (doJson.updatedAtField && !cols.includes(doJson.updatedAtField)) {
        cols.push(doJson.updatedAtField);
        vals.push(new Date());
      }
      // 乐观锁：如果有 versionField，update set version=version+1 where version=?
      if (doJson.versionField && data[doJson.versionField] != null) {
        cols.push(doJson.versionField);
        vals.push(Number(data[doJson.versionField]) + 1);
      }
      if (cols.length === 0) throw new KintsugiError('VALIDATION_FAILED', 'no updatable fields');

      const where: FilterClause[] = [
        { field: pkCol, op: 'eq', value: castToField(id, doJson, pkCol) },
      ];
      if (doJson.versionField && data[doJson.versionField] != null) {
        where.push({
          field: doJson.versionField,
          op: 'eq',
          value: Number(data[doJson.versionField]),
        });
      }

      const sb = new SqlBuilder(adapter);
      const q = sb.buildUpdate({
        schema: schemaName,
        table: tableName,
        setColumns: cols,
        setValues: vals,
        where,
        supportsReturning,
      });
      const res = await adapter.execute<Record<string, unknown>>(q.sql, q.params);
      if (res.rowCount === 0) {
        throw new KintsugiError(
          'BLOCKED_BY_CONCURRENT_EDIT',
          `row ${id} not updated (possibly version conflict or not found)`,
        );
      }
      if (supportsReturning && res.rows[0]) return res.rows[0];
      return this.getOneRaw(adapter, tableName, schemaName, doJson, id);
    } finally {
      await release();
    }
  }

  async remove(
    appCode: string,
    datasetCode: string,
    id: string,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<{ ok: true; softDeleted: boolean }> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      if (doJson.primaryKey.length === 0) {
        throw new KintsugiError('VALIDATION_FAILED', 'dataset has no primary key');
      }
      const pkCol = doJson.primaryKey[0]!;
      const sb = new SqlBuilder(adapter);

      // 软删除：存在 softDeleteField 时 update 置 1；否则物理删除
      if (doJson.softDeleteField) {
        const q = sb.buildUpdate({
          schema: schemaName,
          table: tableName,
          setColumns: [doJson.softDeleteField, ...(doJson.updatedAtField ? [doJson.updatedAtField] : [])],
          setValues: [1, ...(doJson.updatedAtField ? [new Date()] : [])],
          where: [{ field: pkCol, op: 'eq', value: castToField(id, doJson, pkCol) }],
          supportsReturning: false,
        });
        const res = await adapter.execute(q.sql, q.params);
        if (res.rowCount === 0) throw new KintsugiError('NOT_FOUND', `row ${id} not found`);
        return { ok: true, softDeleted: true };
      }
      const q = sb.buildDelete({
        schema: schemaName,
        table: tableName,
        where: [{ field: pkCol, op: 'eq', value: castToField(id, doJson, pkCol) }],
      });
      const res = await adapter.execute(q.sql, q.params);
      if (res.rowCount === 0) throw new KintsugiError('NOT_FOUND', `row ${id} not found`);
      return { ok: true, softDeleted: false };
    } finally {
      await release();
    }
  }

  async batchCreate(
    appCode: string,
    datasetCode: string,
    rows: Array<Record<string, unknown>>,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<{ created: number }> {
    if (rows.length === 0) return { created: 0 };
    if (rows.length > 100) {
      throw new KintsugiError('VALIDATION_FAILED', 'batchCreate max 100 rows per call');
    }
    // 复用单个 adapter —— 之前每行 create() 各开一次连接，100 行 = 100 次 connect/close。
    // 把自己开的 adapter 通过 opts 透下去，每行 create 用同一连接。
    const opened = await this.open(appCode, datasetCode, opts?.adapter, _user);
    const sharedOpts: InstantApiCallOpts = { adapter: opened.adapter };
    try {
      let created = 0;
      for (const r of rows) {
        await this.create(appCode, datasetCode, r, _user, sharedOpts);
        created++;
      }
      return { created };
    } finally {
      await opened.release();
    }
  }

  async aggregate(
    appCode: string,
    datasetCode: string,
    body: {
      groupBy?: string[];
      metrics: Array<{
        op: 'count' | 'sum' | 'avg' | 'min' | 'max';
        field?: string;
        alias: string;
      }>;
      where?: Array<{ field: string; op: FilterOp; value?: unknown }>;
      limit?: number;
    },
    opts?: InstantApiCallOpts,
    _user: CtxUser = {},
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      const allowedCols = this.whitelistColumns(doJson);
      const qc = (n: string) => adapter.quoteIdentifier(n);
      const quotedTable =
        (schemaName ? qc(schemaName) + '.' : '') + qc(tableName);

      const groupCols = (body.groupBy ?? []).filter((c) => allowedCols.has(c));
      const metricFrags = body.metrics.map((m) => {
        if (m.op === 'count' && !m.field) return `count(*) as ${qc(m.alias)}`;
        if (!m.field || !allowedCols.has(m.field))
          throw new KintsugiError('VALIDATION_FAILED', `invalid metric field ${m.field}`);
        if (!['count', 'sum', 'avg', 'min', 'max'].includes(m.op))
          throw new KintsugiError('VALIDATION_FAILED', `invalid agg op ${m.op}`);
        return `${m.op}(${qc(m.field)}) as ${qc(m.alias)}`;
      });
      const selectFrags = [...groupCols.map(qc), ...metricFrags];
      const sb = new SqlBuilder(adapter);
      const params: unknown[] = [];

      // 手工组装因为 aggregate 的 select 比 SqlBuilder 的 columns 更灵活
      const parts = [`select ${selectFrags.join(', ')} from ${quotedTable}`];
      const where = (body.where ?? [])
        .filter((w) => allowedCols.has(w.field))
        .map((w): FilterClause => ({ field: w.field, op: w.op, value: w.value }));
      const extraWhere = this.baseExtraWhere(doJson, _user, false);
      const whereAll = [...where, ...extraWhere];
      const whereQ = sb['buildWhere']
        ? (sb as unknown as { buildWhere: (a: FilterClause[], p: unknown[]) => string })['buildWhere'](
            whereAll,
            params,
          )
        : '';
      if (whereQ) parts.push(`where ${whereQ}`);
      if (groupCols.length) parts.push(`group by ${groupCols.map(qc).join(', ')}`);
      parts.push(`limit ${Math.min(Math.max(1, body.limit ?? 100), 1000)}`);

      const res = await adapter.execute<Record<string, unknown>>(parts.join(' '), params);
      return { data: res.rows };
    } finally {
      await release();
    }
  }

  async getSelectOptions(
    appCode: string,
    datasetCode: string,
    field: string,
    _user: CtxUser = {},
    opts?: InstantApiCallOpts,
  ): Promise<{ options: Array<{ value: string; label: string }> }> {
    const { doJson, adapter, tableName, schemaName, release } = await this.open(
      appCode,
      datasetCode,
      opts?.adapter,
      _user,
    );
    try {
      const f = doJson.fields.find((x) => x.name === field);
      if (!f) throw new KintsugiError('NOT_FOUND', `field ${field} not in DO`);
      if (f.enumValues?.length) {
        return {
          options: f.enumValues.map((v) => ({ value: String(v), label: String(v) })),
        };
      }
      // distinct fallback
      const sb = new SqlBuilder(adapter);
      const q = sb.buildSelect({
        schema: schemaName,
        table: tableName,
        columns: [field],
        limit: 500,
      });
      const res = await adapter.execute<Record<string, unknown>>(
        q.sql.replace(/^select /, 'select distinct '),
        q.params,
      );
      return {
        options: res.rows
          .map((r) => r[field])
          .filter((v) => v != null)
          .map((v) => ({ value: String(v), label: String(v) })),
      };
    } finally {
      await release();
    }
  }

  // ---------------- helpers ----------------

  private async open(
    appCode: string,
    datasetCode: string,
    externalAdapter?: DialectAdapter,
    user?: CtxUser,
  ): Promise<{
    doJson: DoJson;
    adapter: DialectAdapter;
    tableName: string;
    schemaName: string | null;
    /** 调用方在 finally 调用；外部 adapter 不会被 close（生命周期归调用方） */
    release: () => Promise<void>;
    dataSourceId: string;
  }> {
    const ds = await this.datasetService.get(datasetCode);
    if (ds.appCode !== appCode) {
      throw new KintsugiError('FORBIDDEN', `dataset ${datasetCode} not in app ${appCode}`);
    }
    if (externalAdapter) {
      return {
        doJson: ds.doJson,
        adapter: externalAdapter,
        tableName: ds.tableName,
        schemaName: ds.schemaName,
        dataSourceId: ds.dataSourceId,
        release: async () => {},
      };
    }
    // 把 user 上下文带进 openAdapter → 触发 PG GUC SET（kintsugi.tenant/user_id/dept_ids）
    const sessionCtx = user
      ? {
          tenantCode: user.tenantCode ?? null,
          userId: user.userId ?? null,
          deptIds: user.deptIds ?? [],
        }
      : undefined;
    const adapter = await this.dsService.openAdapter(ds.dataSourceId, sessionCtx);
    return {
      doJson: ds.doJson,
      adapter,
      tableName: ds.tableName,
      schemaName: ds.schemaName,
      dataSourceId: ds.dataSourceId,
      release: () => adapter.close().catch(() => undefined),
    };
  }

  /** BFF tx 用：根据 datasetCode 解析 dataSourceId；不开 adapter，只走元数据查询。 */
  async resolveDataSourceId(appCode: string, datasetCode: string): Promise<string> {
    const ds = await this.datasetService.get(datasetCode);
    if (ds.appCode !== appCode) {
      throw new KintsugiError('FORBIDDEN', `dataset ${datasetCode} not in app ${appCode}`);
    }
    return ds.dataSourceId;
  }

  private whitelistColumns(doJson: DoJson): Set<string> {
    return new Set(doJson.fields.filter((f) => !f.deprecated).map((f) => f.name));
  }

  private softDeleteClause(doJson: DoJson, includeDeleted: boolean): FilterClause[] {
    if (includeDeleted || !doJson.softDeleteField) return [];
    return [{ field: doJson.softDeleteField, op: 'eq', value: 0 }];
  }

  /** 软删除 + 租户隔离 + DataRule 的合并 clauses，Instant API 所有路径都通过这里拼 extraWhere。 */
  private baseExtraWhere(doJson: DoJson, user: CtxUser, includeDeleted = false): FilterClause[] {
    return [...this.softDeleteClause(doJson, includeDeleted), ...compileRlsClauses(doJson, user)];
  }

  private async getOneRaw(
    adapter: DialectAdapter,
    tableName: string,
    schemaName: string | null,
    doJson: DoJson,
    id: string,
  ): Promise<Record<string, unknown>> {
    if (doJson.primaryKey.length === 0) return {};
    const pkCol = doJson.primaryKey[0]!;
    const sb = new SqlBuilder(adapter);
    const q = sb.buildSelect({
      schema: schemaName,
      table: tableName,
      columns: [...this.whitelistColumns(doJson)],
      where: [{ field: pkCol, op: 'eq', value: castToField(id, doJson, pkCol) }],
      limit: 1,
    });
    const res = await adapter.execute<Record<string, unknown>>(q.sql, q.params);
    return res.rows[0] ?? {};
  }
}

/** 根据 DO field 的逻辑类型把 URL 上传来的 string id 转成合适的类型（avoid pg varchar=bigint mismatch）。 */
function castToField(raw: string, doJson: DoJson, fieldName: string): unknown {
  const f = doJson.fields.find((x) => x.name === fieldName);
  if (!f) return raw;
  return castValueByField(raw, f);
}

function castValueByField(raw: unknown, f: DoField): unknown {
  if (raw == null) return null;
  const t = f.logicalType;
  if (typeof raw === 'string') {
    if (t === 'integer' || t === 'bigint' || t === 'decimal' || t === 'float') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    if (t === 'boolean') return raw === 'true' || raw === '1';
  }
  return raw;
}
