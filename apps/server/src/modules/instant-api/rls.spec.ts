import { describe, expect, it } from 'vitest';
import { compileRlsClauses, type CtxUser } from './rls';
import type { DoJson } from '../dataset/do';

const baseDo: DoJson = {
  version: 1,
  tableName: 'order',
  alias: 'order',
  primaryKey: ['id'],
  fields: [],
  relations: [],
};

describe('compileRlsClauses', () => {
  it('forces tenantField when DO declares it and user has tenantCode', () => {
    const cs = compileRlsClauses(
      { ...baseDo, tenantField: 'tenant_code' },
      { tenantCode: 't1' } as CtxUser,
    );
    expect(cs).toContainEqual({ field: 'tenant_code', op: 'eq', value: 't1' });
  });

  it('omits tenant clause when user has no tenantCode (e.g. anon)', () => {
    const cs = compileRlsClauses({ ...baseDo, tenantField: 'tenant_code' }, null);
    expect(cs).toEqual([]);
  });

  it("scope='self' filters by userField=ctx.userId", () => {
    const cs = compileRlsClauses(
      { ...baseDo, userField: 'owner_id', dataRule: { scope: 'self' } },
      { userId: 'u1' } as CtxUser,
    );
    expect(cs).toContainEqual({ field: 'owner_id', op: 'eq', value: 'u1' });
  });

  it("scope='dept' uses IN with deptIds list", () => {
    const cs = compileRlsClauses(
      { ...baseDo, dataRule: { scope: 'dept', field: 'dept_id' } },
      { deptIds: ['d1', 'd2'] } as CtxUser,
    );
    expect(cs).toContainEqual({ field: 'dept_id', op: 'in', value: ['d1', 'd2'] });
  });

  it("scope='dept' yields no clause when deptIds empty (avoids in [])", () => {
    const cs = compileRlsClauses(
      { ...baseDo, dataRule: { scope: 'dept', field: 'dept_id' } },
      { deptIds: [] } as CtxUser,
    );
    expect(cs).toEqual([]);
  });

  it("scope='role' parses simple AND expressions with literal + ${user.x}", () => {
    const cs = compileRlsClauses(
      {
        ...baseDo,
        dataRule: {
          scope: 'role',
          rule: "status = 'active' AND owner_id = ${user.userId}",
        },
      },
      { userId: 'u9' } as CtxUser,
    );
    expect(cs).toContainEqual({ field: 'status', op: 'eq', value: 'active' });
    expect(cs).toContainEqual({ field: 'owner_id', op: 'eq', value: 'u9' });
  });

  it("scope='all' yields no extra clauses", () => {
    const cs = compileRlsClauses(
      { ...baseDo, dataRule: { scope: 'all' } },
      { userId: 'u1' } as CtxUser,
    );
    expect(cs).toEqual([]);
  });

  it('layers tenantField + dataRule together', () => {
    const cs = compileRlsClauses(
      {
        ...baseDo,
        tenantField: 'tenant_code',
        userField: 'owner_id',
        dataRule: { scope: 'self' },
      },
      { tenantCode: 't1', userId: 'u1' } as CtxUser,
    );
    expect(cs).toHaveLength(2);
    expect(cs).toContainEqual({ field: 'tenant_code', op: 'eq', value: 't1' });
    expect(cs).toContainEqual({ field: 'owner_id', op: 'eq', value: 'u1' });
  });
});
