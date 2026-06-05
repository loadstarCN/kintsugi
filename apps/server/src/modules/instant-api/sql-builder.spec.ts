import { describe, expect, it } from 'vitest';
import type { DialectAdapter } from '@kintsugi/db-scanner';
import { SqlBuilder } from './sql-builder';

const fakePg: Pick<DialectAdapter, 'quoteIdentifier' | 'placeholder'> = {
  quoteIdentifier(name) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad id: ${name}`);
    return `"${name}"`;
  },
  placeholder(i) {
    return `$${i}`;
  },
};

const fakeMysql: Pick<DialectAdapter, 'quoteIdentifier' | 'placeholder'> = {
  quoteIdentifier(name) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad id: ${name}`);
    return `\`${name}\``;
  },
  placeholder() {
    return '?';
  },
};

describe('SqlBuilder', () => {
  it('builds parameterized SELECT with where + order + limit', () => {
    const b = new SqlBuilder(fakePg as DialectAdapter);
    const r = b.buildSelect({
      table: 'goods',
      columns: ['id', 'name'],
      where: [
        { field: 'tenant_code', op: 'eq', value: 't1' },
        { field: 'price', op: 'gte', value: 10 },
      ],
      orderBy: [{ field: 'id', direction: 'desc' }],
      limit: 50,
    });
    expect(r.sql).toBe(
      'select "id", "name" from "goods" where "tenant_code" = $1 and "price" >= $2 order by "id" desc limit 50',
    );
    expect(r.params).toEqual(['t1', 10]);
  });

  it('uses ? placeholders + backticks for mysql', () => {
    const b = new SqlBuilder(fakeMysql as DialectAdapter);
    const r = b.buildSelect({
      table: 'goods',
      columns: ['id'],
      where: [{ field: 'name', op: 'like', value: '%x%' }],
    });
    expect(r.sql).toBe('select `id` from `goods` where `name` like ?');
    expect(r.params).toEqual(['%x%']);
  });

  it('rejects illegal identifiers (SQLi defense)', () => {
    const b = new SqlBuilder(fakePg as DialectAdapter);
    expect(() => b.buildSelect({ table: 'a; DROP TABLE x;--', columns: ['id'] })).toThrow();
    expect(() => b.buildSelect({ table: 'a', columns: ['1+1'] })).toThrow();
  });

  it('renders in []/notIn [] safely without parameter underflow', () => {
    const b = new SqlBuilder(fakePg as DialectAdapter);
    const empty = b.buildSelect({
      table: 't',
      columns: ['id'],
      where: [{ field: 'k', op: 'in', value: [] }],
    });
    expect(empty.sql).toContain('1=0');
    const emptyNot = b.buildSelect({
      table: 't',
      columns: ['id'],
      where: [{ field: 'k', op: 'notIn', value: [] }],
    });
    expect(emptyNot.sql).toContain('1=1');
  });

  it('rejects DELETE without where (data-loss defense)', () => {
    const b = new SqlBuilder(fakePg as DialectAdapter);
    expect(() => b.buildDelete({ table: 't', where: [] })).toThrow(/delete without where/);
  });

  it('appends extraWhere from RLS layer', () => {
    const b = new SqlBuilder(fakePg as DialectAdapter);
    const r = b.buildSelect({
      table: 't',
      columns: ['id'],
      where: [{ field: 'a', op: 'eq', value: 1 }],
      extraWhere: [{ field: 'tenant_code', op: 'eq', value: 't1' }],
    });
    expect(r.sql).toBe(
      'select "id" from "t" where "a" = $1 and "tenant_code" = $2',
    );
    expect(r.params).toEqual([1, 't1']);
  });
});
