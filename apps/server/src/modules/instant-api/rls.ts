/** 把 DO 里的 dataRule 编译成 FilterClause 数组，InstantApi 作为 extraWhere 附加。 */

import type { FilterClause } from './sql-builder';
import type { DoJson } from '../dataset/do';

export interface CtxUser {
  userId?: string;
  tenantCode?: string;
  deptIds?: string[];
  roles?: string[];
  /** 其他属性（给 role 模式做插值）。 */
  [k: string]: unknown;
}

/**
 * 产出应该追加到 where 的 clauses。
 * 租户隔离（tenantField）无条件追加；dataRule 按 scope 追加。
 */
export function compileRlsClauses(doJson: DoJson, user: CtxUser | null): FilterClause[] {
  const out: FilterClause[] = [];

  // 多租户隔离：如果 DO 声明了 tenantField 且用户有 tenantCode，强制追加
  if (doJson.tenantField && user?.tenantCode) {
    out.push({ field: doJson.tenantField, op: 'eq', value: user.tenantCode });
  }

  const rule = doJson.dataRule;
  if (!rule || rule.scope === 'all' || !user) return out;

  if (rule.scope === 'self') {
    const field = rule.field ?? doJson.userField;
    if (field && user.userId) {
      out.push({ field, op: 'eq', value: user.userId });
    }
    return out;
  }

  if (rule.scope === 'dept') {
    const field = rule.field;
    const ids = user.deptIds ?? [];
    if (field && ids.length) {
      out.push({ field, op: 'in', value: ids });
    }
    return out;
  }

  if (rule.scope === 'role' && rule.rule) {
    // 极简表达式解析："status = 'active' AND owner_id = ${user.userId}"
    // 我们只支持非常有限的子集（MVP）：field <op> "literal" | ${user.xxx}
    const compiled = parseSimpleRule(rule.rule, user);
    out.push(...compiled);
    return out;
  }

  return out;
}

function parseSimpleRule(rule: string, user: CtxUser): FilterClause[] {
  const clauses: FilterClause[] = [];
  const parts = rule.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = /^(\w+)\s*(=|!=|>|>=|<|<=)\s*(.+)$/.exec(p);
    if (!m) continue;
    const [, field, opRaw, valueRaw] = m as unknown as [string, string, string, string];
    const opMap: Record<string, FilterClause['op']> = {
      '=': 'eq',
      '!=': 'ne',
      '>': 'gt',
      '>=': 'gte',
      '<': 'lt',
      '<=': 'lte',
    };
    const op = opMap[opRaw];
    if (!op) continue;
    let value: unknown;
    const interp = valueRaw.trim().match(/^\$\{user\.(\w+)\}$/);
    if (interp) {
      value = user[interp[1]!];
    } else if (/^'.*'$/.test(valueRaw) || /^".*"$/.test(valueRaw)) {
      value = valueRaw.slice(1, -1);
    } else if (!Number.isNaN(Number(valueRaw))) {
      value = Number(valueRaw);
    } else {
      value = valueRaw;
    }
    clauses.push({ field, op, value });
  }
  return clauses;
}
