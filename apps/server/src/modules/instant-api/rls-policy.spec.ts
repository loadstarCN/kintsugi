import { describe, expect, it } from 'vitest';
import { emitRlsPolicy, emitSetLocalSnippet, applySessionGuc } from './rls-policy';
import type { DoJson } from '../dataset/do';

const baseDo: DoJson = {
  version: 1,
  tableName: 'order',
  alias: 'order',
  primaryKey: ['id'],
  fields: [],
  relations: [],
};

describe('emitRlsPolicy', () => {
  it('emits ENABLE + FORCE RLS even when no policies', () => {
    const r = emitRlsPolicy({ table: 'order', doJson: baseDo });
    expect(r.sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(r.sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(r.policies).toHaveLength(0);
  });

  it('emits tenant policy when DO declares tenantField', () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: { ...baseDo, tenantField: 'tenant_code' },
    });
    expect(r.policies.find((p) => p.name === 'kintsugi_order_tenant')).toBeDefined();
    expect(r.sql).toContain(`"tenant_code" = current_setting('kintsugi.tenant', true)`);
    expect(r.sql).toContain(`current_setting('kintsugi.bypass', true) = 'on'`);
  });

  it("emits self policy from scope='self' + userField", () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: { ...baseDo, userField: 'owner_id', dataRule: { scope: 'self' } },
    });
    expect(r.policies.find((p) => p.name === 'kintsugi_order_self')).toBeDefined();
    expect(r.sql).toContain(`"owner_id" = current_setting('kintsugi.user_id', true)`);
  });

  it("emits dept policy with ANY(string_to_array(...))", () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: { ...baseDo, dataRule: { scope: 'dept', field: 'dept_id' } },
    });
    expect(r.sql).toContain(
      `"dept_id" = ANY(string_to_array(current_setting('kintsugi.dept_ids', true), ','))`,
    );
  });

  it("emits role policy with literal + interpolated user.userId", () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: {
        ...baseDo,
        dataRule: {
          scope: 'role',
          rule: "status = 'active' AND owner_id = ${user.userId}",
        },
      },
    });
    expect(r.warnings).toEqual([]);
    expect(r.sql).toContain(`"status" = 'active'`);
    expect(r.sql).toContain(`"owner_id" = current_setting('kintsugi.user_id', true)`);
  });

  it('warns and skips policy when role rule cannot compile', () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: {
        ...baseDo,
        dataRule: { scope: 'role', rule: 'unsupported = ${user.unknownGuc}' },
      },
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.policies.find((p) => p.name === 'kintsugi_order_role')).toBeUndefined();
  });

  it('rejects invalid identifier as table name', () => {
    expect(() =>
      emitRlsPolicy({ table: 'order; DROP TABLE x;--', doJson: baseDo }),
    ).toThrow(/invalid identifier/);
  });

  it('produces matching DROP statements', () => {
    const r = emitRlsPolicy({
      table: 'order',
      doJson: { ...baseDo, tenantField: 'tenant_code' },
    });
    expect(r.dropSql).toContain('DROP POLICY IF EXISTS "kintsugi_order_tenant"');
  });
});

describe('applySessionGuc', () => {
  it('emits SET for tenant + userId + deptIds on PG, with quoted literals', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const adapter = {
      id: 'postgres',
      execute(sql: string, params?: unknown[]) {
        calls.push({ sql, ...(params ? { params } : {}) });
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    };
    await applySessionGuc(adapter, {
      tenantCode: "t'1",
      userId: 'u1',
      deptIds: ['d1', 'd2'],
    });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.sql).toBe(`SET "kintsugi.tenant" = 't''1'`);
    expect(calls[1]!.sql).toBe(`SET "kintsugi.user_id" = 'u1'`);
    expect(calls[2]!.sql).toBe(`SET "kintsugi.dept_ids" = 'd1,d2'`);
  });

  it('skips on non-postgres dialects (mysql)', async () => {
    const calls: string[] = [];
    const adapter = {
      id: 'mysql',
      execute(sql: string) {
        calls.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    };
    await applySessionGuc(adapter, { tenantCode: 't1', userId: 'u1' });
    expect(calls).toEqual([]);
  });

  it('warn-logs but does not throw when SET fails', async () => {
    const warnings: string[] = [];
    const adapter = {
      id: 'postgres',
      execute() {
        return Promise.reject(new Error('permission denied'));
      },
    };
    await expect(
      applySessionGuc(adapter, { tenantCode: 't1' }, { warn: (m: string) => warnings.push(m) }),
    ).resolves.toBeUndefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/permission denied/);
  });

  it('skips fields when not provided', async () => {
    const calls: string[] = [];
    const adapter = {
      id: 'postgres',
      execute(sql: string) {
        calls.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    };
    await applySessionGuc(adapter, { tenantCode: 't1' });
    expect(calls).toEqual([`SET "kintsugi.tenant" = 't1'`]);
  });
});

describe('emitSetLocalSnippet', () => {
  it('emits SET LOCAL for each present field, escaping single quotes', () => {
    const s = emitSetLocalSnippet({ tenantCode: "t'1", userId: 'u1', deptIds: ['d1', 'd2'] });
    expect(s).toContain(`SET LOCAL "kintsugi.tenant" = 't''1'`);
    expect(s).toContain(`SET LOCAL "kintsugi.user_id" = 'u1'`);
    expect(s).toContain(`SET LOCAL "kintsugi.dept_ids" = 'd1,d2'`);
  });

  it('skips empty deptIds', () => {
    const s = emitSetLocalSnippet({ tenantCode: 't1', deptIds: [] });
    expect(s).not.toContain('dept_ids');
  });
});
