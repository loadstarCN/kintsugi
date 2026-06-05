/**
 * Instant API 的参数化 SQL 生成器。
 *
 * 设计原则：
 *  - 标识符（表名/列名）必须经 adapter.quoteIdentifier；非白名单字符一律抛错。
 *  - 值走 adapter.placeholder（$1 / ?）；**不拼字符串**。
 *  - 列白名单来自 DO JSON：调用方必须先按 DO 过滤列。
 *  - 不感知多租户；多租户过滤在上层 Proxy 注入 filter。
 */

import type { DialectAdapter } from '@kintsugi/db-scanner';

export type FilterOp =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'notLike'
  | 'in' | 'notIn'
  | 'isNull' | 'isNotNull'
  | 'between';

export interface FilterClause {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface BuildSelect {
  schema?: string | null;
  table: string;
  columns: string[];
  where?: FilterClause[];
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  limit?: number;
  offset?: number;
  /** 额外强制追加的 AND 条件（tenantCode、softDelete 等），已经是安全的 clause。 */
  extraWhere?: FilterClause[];
}

export interface BuildInsert {
  schema?: string | null;
  table: string;
  columns: string[];
  values: unknown[];
  /** pg 支持 RETURNING *，mysql 不支持（需后续 SELECT）。 */
  supportsReturning: boolean;
}

export interface BuildUpdate {
  schema?: string | null;
  table: string;
  setColumns: string[];
  setValues: unknown[];
  where: FilterClause[];
  supportsReturning: boolean;
}

export interface BuildDelete {
  schema?: string | null;
  table: string;
  where: FilterClause[];
}

export class SqlBuilder {
  constructor(private readonly adapter: DialectAdapter) {}

  private qualify(table: string, schema?: string | null): string {
    const ident = this.adapter.quoteIdentifier(table);
    if (schema) return `${this.adapter.quoteIdentifier(schema)}.${ident}`;
    return ident;
  }

  private qCol(name: string): string {
    return this.adapter.quoteIdentifier(name);
  }

  buildSelect(b: BuildSelect): { sql: string; params: unknown[] } {
    const cols = b.columns.map((c) => this.qCol(c)).join(', ');
    const params: unknown[] = [];
    const whereAll = [...(b.where ?? []), ...(b.extraWhere ?? [])];
    const whereSql = this.buildWhere(whereAll, params);
    const orderSql = (b.orderBy ?? [])
      .map((o) => `${this.qCol(o.field)} ${o.direction === 'desc' ? 'desc' : 'asc'}`)
      .join(', ');
    const parts: string[] = [`select ${cols} from ${this.qualify(b.table, b.schema)}`];
    if (whereSql) parts.push(`where ${whereSql}`);
    if (orderSql) parts.push(`order by ${orderSql}`);
    if (b.limit != null) parts.push(`limit ${Math.min(Math.max(1, b.limit), 1000)}`);
    if (b.offset != null && b.offset > 0) parts.push(`offset ${b.offset}`);
    return { sql: parts.join(' '), params };
  }

  buildCount(
    b: Omit<BuildSelect, 'columns' | 'orderBy' | 'limit' | 'offset'>,
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const whereAll = [...(b.where ?? []), ...(b.extraWhere ?? [])];
    const whereSql = this.buildWhere(whereAll, params);
    const parts: string[] = [`select count(*) as total from ${this.qualify(b.table, b.schema)}`];
    if (whereSql) parts.push(`where ${whereSql}`);
    return { sql: parts.join(' '), params };
  }

  buildInsert(b: BuildInsert): { sql: string; params: unknown[] } {
    if (b.columns.length !== b.values.length) throw new Error('insert: columns/values length mismatch');
    const cols = b.columns.map((c) => this.qCol(c)).join(', ');
    const params = [...b.values];
    const placeholders = b.values.map((_, i) => this.adapter.placeholder(i + 1)).join(', ');
    const tail = b.supportsReturning ? ' returning *' : '';
    return {
      sql: `insert into ${this.qualify(b.table, b.schema)} (${cols}) values (${placeholders})${tail}`,
      params,
    };
  }

  buildUpdate(b: BuildUpdate): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const setFrags = b.setColumns.map((c, i) => {
      params.push(b.setValues[i]);
      return `${this.qCol(c)} = ${this.adapter.placeholder(params.length)}`;
    });
    const whereSql = this.buildWhere(b.where, params);
    const tail = b.supportsReturning ? ' returning *' : '';
    const parts: string[] = [
      `update ${this.qualify(b.table, b.schema)} set ${setFrags.join(', ')}`,
    ];
    if (whereSql) parts.push(`where ${whereSql}`);
    return { sql: parts.join(' ') + tail, params };
  }

  buildDelete(b: BuildDelete): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const whereSql = this.buildWhere(b.where, params);
    if (!whereSql) throw new Error('delete without where is refused');
    return { sql: `delete from ${this.qualify(b.table, b.schema)} where ${whereSql}`, params };
  }

  private buildWhere(clauses: FilterClause[], params: unknown[]): string {
    if (!clauses.length) return '';
    const frags: string[] = [];
    for (const c of clauses) {
      const col = this.qCol(c.field);
      switch (c.op) {
        case 'eq':
          params.push(c.value);
          frags.push(`${col} = ${this.adapter.placeholder(params.length)}`);
          break;
        case 'ne':
          params.push(c.value);
          frags.push(`${col} <> ${this.adapter.placeholder(params.length)}`);
          break;
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const sym = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[c.op];
          params.push(c.value);
          frags.push(`${col} ${sym} ${this.adapter.placeholder(params.length)}`);
          break;
        }
        case 'like':
        case 'notLike':
          params.push(c.value);
          frags.push(
            `${col} ${c.op === 'notLike' ? 'not like' : 'like'} ${this.adapter.placeholder(params.length)}`,
          );
          break;
        case 'in':
        case 'notIn': {
          const arr = Array.isArray(c.value) ? c.value : [];
          if (arr.length === 0) {
            // 语义等价：in [] 永远不成立、notIn [] 永远成立
            frags.push(c.op === 'in' ? '1=0' : '1=1');
            break;
          }
          const phs = arr.map((v) => {
            params.push(v);
            return this.adapter.placeholder(params.length);
          });
          frags.push(`${col} ${c.op === 'notIn' ? 'not in' : 'in'} (${phs.join(', ')})`);
          break;
        }
        case 'isNull':
          frags.push(`${col} is null`);
          break;
        case 'isNotNull':
          frags.push(`${col} is not null`);
          break;
        case 'between': {
          const pair = Array.isArray(c.value) ? c.value : [];
          if (pair.length !== 2) throw new Error(`between needs [min,max]`);
          params.push(pair[0]);
          const p1 = this.adapter.placeholder(params.length);
          params.push(pair[1]);
          const p2 = this.adapter.placeholder(params.length);
          frags.push(`${col} between ${p1} and ${p2}`);
          break;
        }
        default:
          throw new Error(`unsupported op: ${String(c.op)}`);
      }
    }
    return frags.join(' and ');
  }
}
