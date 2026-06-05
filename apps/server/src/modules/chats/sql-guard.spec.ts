import { describe, expect, it } from 'vitest';
import { guardChatsSql } from './sql-guard';
import { KintsugiError } from '@kintsugi/shared';

describe('guardChatsSql', () => {
  // ---- 通过 ----

  it('SELECT 通过', () => {
    expect(guardChatsSql('SELECT * FROM goods')).toBe('SELECT * FROM goods');
  });

  it('小写 select 通过', () => {
    expect(guardChatsSql('select id, name from t')).toBe('select id, name from t');
  });

  it('WITH (CTE) 通过', () => {
    expect(guardChatsSql('WITH a AS (SELECT 1) SELECT * FROM a')).toMatch(/^WITH/);
  });

  it('EXPLAIN 通过', () => {
    expect(guardChatsSql('EXPLAIN SELECT 1')).toBe('EXPLAIN SELECT 1');
  });

  it('前导空白被 trim', () => {
    expect(guardChatsSql('   \nselect 1')).toBe('select 1');
  });

  it('尾部分号被剥', () => {
    expect(guardChatsSql('SELECT 1;')).toBe('SELECT 1');
  });

  it('多个尾部分号被剥', () => {
    expect(guardChatsSql('SELECT 1;;;')).toBe('SELECT 1');
  });

  // ---- 列名/表名含 keyword 不应错杀 ----

  it('列名 inserted_at 不被错杀', () => {
    expect(guardChatsSql('SELECT inserted_at FROM logs')).toContain('inserted_at');
  });

  it('列名 update_count 不被错杀', () => {
    expect(guardChatsSql('SELECT u.update_count FROM users u')).toContain('update_count');
  });

  it('表名 dropdowns 不被错杀', () => {
    expect(guardChatsSql('SELECT * FROM dropdowns')).toContain('dropdowns');
  });

  it('列名 alter_id 不被错杀', () => {
    expect(guardChatsSql('SELECT alter_id, id FROM x')).toContain('alter_id');
  });

  // ---- 拒绝 ----

  it('INSERT 开头 → FORBIDDEN', () => {
    expect(() => guardChatsSql('INSERT INTO t VALUES (1)')).toThrow(KintsugiError);
  });

  it('UPDATE 开头 → FORBIDDEN', () => {
    expect(() => guardChatsSql('UPDATE t SET x = 1')).toThrow(/non-SELECT/);
  });

  it('DELETE 开头 → FORBIDDEN', () => {
    expect(() => guardChatsSql('DELETE FROM users')).toThrow(/non-SELECT/);
  });

  it('DROP 开头 → FORBIDDEN', () => {
    expect(() => guardChatsSql('DROP TABLE x')).toThrow(/non-SELECT/);
  });

  it('TRUNCATE 开头 → FORBIDDEN', () => {
    expect(() => guardChatsSql('TRUNCATE users')).toThrow(/non-SELECT/);
  });

  // ---- 多 statement 拒 ----

  it('多 statement → FORBIDDEN', () => {
    expect(() => guardChatsSql('SELECT 1; SELECT 2')).toThrow(/multi-statement/);
  });

  it('SELECT + DROP 混合 → FORBIDDEN', () => {
    expect(() => guardChatsSql('SELECT * FROM t; DROP TABLE t')).toThrow(/multi-statement/);
  });

  it('SELECT + pg_sleep DoS → FORBIDDEN', () => {
    expect(() => guardChatsSql('SELECT 1; SELECT pg_sleep(60)')).toThrow(/multi-statement/);
  });

  // ---- 边界 ----

  it('empty string → FORBIDDEN', () => {
    expect(() => guardChatsSql('')).toThrow(KintsugiError);
  });

  it('whitespace-only → FORBIDDEN', () => {
    expect(() => guardChatsSql('   \n\t  ')).toThrow(/non-SELECT/);
  });

  it('non-string input → FORBIDDEN', () => {
    expect(() => guardChatsSql(null as unknown as string)).toThrow(/empty/);
  });
});
