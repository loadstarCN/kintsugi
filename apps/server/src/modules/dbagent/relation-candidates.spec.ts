import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot } from '@kintsugi/db-scanner';
import { findRelationCandidates } from './relation-candidates';

function mkSnapshot(tables: SchemaSnapshot['tables']): SchemaSnapshot {
  return {
    dialect: 'mysql',
    database: 'test',
    scannedAt: '2026-04-24T00:00:00Z',
    tables,
  };
}

describe('findRelationCandidates', () => {
  it('discovers implicit user_id → user.id with high score', () => {
    const snap = mkSnapshot([
      {
        name: 'user',
        columns: [
          { name: 'id', nativeType: 'bigint', logicalType: 'bigint', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'username', nativeType: 'varchar(64)', logicalType: 'string', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 'order',
        columns: [
          { name: 'id', nativeType: 'bigint', logicalType: 'bigint', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'user_id', nativeType: 'bigint', logicalType: 'bigint', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [],
      },
    ]);
    const cands = findRelationCandidates(snap);
    const hit = cands.find((c) => c.fromTable === 'order' && c.toTable === 'user');
    expect(hit).toBeDefined();
    expect(hit!.heuristicScore).toBeGreaterThanOrEqual(0.85);
  });

  it('skips declared FKs (ground truth already known)', () => {
    const snap = mkSnapshot([
      {
        name: 'user',
        columns: [{ name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 }],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 'order',
        columns: [
          { name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'user_id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [
          { name: 'fk_order_user', columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] },
        ],
      },
    ]);
    const cands = findRelationCandidates(snap);
    expect(cands.find((c) => c.fromTable === 'order' && c.toTable === 'user')).toBeUndefined();
  });

  it('handles plural table names (users → user_id)', () => {
    const snap = mkSnapshot([
      {
        name: 'users',
        columns: [{ name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 }],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 'orders',
        columns: [
          { name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'user_id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [],
      },
    ]);
    const hit = findRelationCandidates(snap).find((c) => c.toTable === 'users');
    expect(hit).toBeDefined();
    expect(hit!.heuristicScore).toBeGreaterThan(0.6);
  });

  it('rejects candidates with incompatible types', () => {
    const snap = mkSnapshot([
      {
        name: 'customer',
        columns: [{ name: 'id', nativeType: 'uuid', logicalType: 'uuid', nullable: false, isAutoIncrement: false, primaryKeyOrder: 1 }],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 'invoice',
        columns: [
          { name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'customer_id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [],
      },
    ]);
    expect(findRelationCandidates(snap)).toHaveLength(0);
  });

  it('strips common table prefixes (t_ / tbl_)', () => {
    const snap = mkSnapshot([
      {
        name: 't_user',
        columns: [{ name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 }],
        indexes: [],
        foreignKeys: [],
      },
      {
        name: 't_order',
        columns: [
          { name: 'id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: true, primaryKeyOrder: 1 },
          { name: 'user_id', nativeType: 'int', logicalType: 'integer', nullable: false, isAutoIncrement: false },
        ],
        indexes: [],
        foreignKeys: [],
      },
    ]);
    const hit = findRelationCandidates(snap).find((c) => c.toTable === 't_user');
    expect(hit).toBeDefined();
    expect(hit!.heuristicScore).toBeGreaterThan(0.8);
  });
});
