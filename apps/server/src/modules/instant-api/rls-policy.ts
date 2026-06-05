/**
 * 把 DO 里的 tenantField + dataRule 编译成 PostgreSQL Row-Level Security 策略 SQL。
 *
 * 真策略路径（与 rls.ts 的应用层 extraWhere 互补）：
 *   - 应用层 extraWhere → 防 Instant API / BFF 路径下越权
 *   - DB 层 CREATE POLICY → 防绕过 Instant API（直连库 / 自定义 SQL / 第三方 SDK）
 *
 * 会话变量约定（业务连接需要在每条事务前 SET LOCAL）：
 *   - kintsugi.tenant    : tenantCode
 *   - kintsugi.user_id   : userId
 *   - kintsugi.dept_ids  : CSV 字符串，例如 'd1,d2,d3'
 *   - kintsugi.bypass    : 设为 'on' 时跳过 RLS（仅元数据库 superuser 用，业务路径绝对不能开）
 *
 * 注意：CREATE POLICY 仅 PostgreSQL 适用；MySQL/MariaDB 没有等价机制
 *      （只能靠应用层 + GRANT 列级权限 + VIEW），调用方需先判断 dialect。
 */

import type { DoJson, DoDataRule } from '../dataset/do';

export interface RlsEmitInput {
  /** 表名（不带 schema）。会经标识符校验后引号包裹。 */
  table: string;
  /** PG schema；为空时落到默认 public。 */
  schema?: string | null;
  doJson: DoJson;
  /** 策略名前缀，默认 `kintsugi_${table}`；用于 DROP POLICY IF EXISTS 链路。 */
  policyPrefix?: string;
}

export interface RlsEmitResult {
  /** 完整的 SQL 串（含 ENABLE ROW LEVEL SECURITY + 多条 CREATE POLICY）。 */
  sql: string;
  /** 单独的 DROP 链路；用于先清旧策略再发新版（应用入口可串起来）。 */
  dropSql: string;
  /** 每条 CREATE POLICY 单独列出，便于调试 / UI 展示。 */
  policies: Array<{ name: string; using: string; check?: string }>;
  /** 警告（例如 dataRule.role 表达式无法编译）。 */
  warnings: string[];
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`invalid identifier: ${name}`);
  }
  return `"${name}"`;
}

function qualified(schema: string | null | undefined, table: string): string {
  const t = quoteIdent(table);
  if (!schema) return t;
  return `${quoteIdent(schema)}.${t}`;
}

/**
 * 主入口。
 * 产出形如：
 *   ALTER TABLE "public"."order" ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "kintsugi_order_tenant" ON "public"."order"
 *     USING ("tenant_code" = current_setting('kintsugi.tenant', true)
 *            OR current_setting('kintsugi.bypass', true) = 'on');
 *   CREATE POLICY "kintsugi_order_self" ON "public"."order"
 *     USING ("owner_id" = current_setting('kintsugi.user_id', true)
 *            OR current_setting('kintsugi.bypass', true) = 'on');
 */
export function emitRlsPolicy(input: RlsEmitInput): RlsEmitResult {
  const warnings: string[] = [];
  const ref = qualified(input.schema, input.table);
  const prefix = (input.policyPrefix ?? `kintsugi_${input.table}`).replace(/[^A-Za-z0-9_]/g, '_');

  const policies: RlsEmitResult['policies'] = [];

  // 1. tenantField → 强制隔离
  if (input.doJson.tenantField) {
    const tf = quoteIdent(input.doJson.tenantField);
    const usingExpr = `(${tf} = current_setting('kintsugi.tenant', true) OR current_setting('kintsugi.bypass', true) = 'on')`;
    policies.push({
      name: `${prefix}_tenant`,
      using: usingExpr,
      check: usingExpr,
    });
  }

  // 2. dataRule → 范围策略
  const rule = input.doJson.dataRule;
  if (rule) {
    const rulePolicy = compileDataRule(rule, input.doJson, prefix, warnings);
    if (rulePolicy) policies.push(rulePolicy);
  }

  // 3. 拼 SQL
  const lines: string[] = [];
  lines.push(`-- Kintsugi RLS for ${ref}`);
  lines.push(`ALTER TABLE ${ref} ENABLE ROW LEVEL SECURITY;`);
  lines.push(`ALTER TABLE ${ref} FORCE ROW LEVEL SECURITY;`);
  for (const p of policies) {
    lines.push(`CREATE POLICY "${p.name}" ON ${ref}`);
    lines.push(`  USING (${p.using})`);
    if (p.check) lines.push(`  WITH CHECK (${p.check})`);
    lines[lines.length - 1] += ';';
  }
  if (policies.length === 0) {
    lines.push(
      '-- 没有 tenantField 也没有 dataRule，仅启用 RLS 但不发 policy（默认拒绝）。',
    );
  }

  // 4. DROP 链：用于"先清后发"的幂等部署
  const dropLines = [
    `-- DROP existing Kintsugi policies (idempotent re-deploy helper)`,
    ...policies.map((p) => `DROP POLICY IF EXISTS "${p.name}" ON ${ref};`),
  ];

  return {
    sql: lines.join('\n') + '\n',
    dropSql: dropLines.join('\n') + '\n',
    policies,
    warnings,
  };
}

function compileDataRule(
  rule: DoDataRule,
  doJson: DoJson,
  prefix: string,
  warnings: string[],
): RlsEmitResult['policies'][number] | null {
  if (rule.scope === 'all') return null;

  if (rule.scope === 'self') {
    const f = rule.field ?? doJson.userField;
    if (!f) {
      warnings.push("scope='self' 但 DO 没声明 userField，policy 跳过");
      return null;
    }
    const col = quoteIdent(f);
    const usingExpr = `(${col} = current_setting('kintsugi.user_id', true) OR current_setting('kintsugi.bypass', true) = 'on')`;
    return { name: `${prefix}_self`, using: usingExpr, check: usingExpr };
  }

  if (rule.scope === 'dept') {
    const f = rule.field;
    if (!f) {
      warnings.push("scope='dept' 但 dataRule.field 没填，policy 跳过");
      return null;
    }
    const col = quoteIdent(f);
    // dept_ids 是 CSV：拆 array 后判 IN
    const usingExpr = `(${col} = ANY(string_to_array(current_setting('kintsugi.dept_ids', true), ',')) OR current_setting('kintsugi.bypass', true) = 'on')`;
    return { name: `${prefix}_dept`, using: usingExpr, check: usingExpr };
  }

  if (rule.scope === 'role' && rule.rule) {
    const compiled = compileSimpleRoleRule(rule.rule);
    if (!compiled) {
      warnings.push(
        `role 规则无法编译为 PG RLS 表达式（不支持的语法）：${rule.rule}；保持应用层 extraWhere 兜底`,
      );
      return null;
    }
    const usingExpr = `(${compiled} OR current_setting('kintsugi.bypass', true) = 'on')`;
    return { name: `${prefix}_role`, using: usingExpr, check: usingExpr };
  }

  return null;
}

/**
 * 把"field <op> value | ${user.xxx}" 用 AND 串成的 rule 串编译为 PG 表达式。
 * 与 rls.ts 的 parseSimpleRule 对齐，但产出 SQL 字面量而非 FilterClause。
 *
 * 支持：
 *   field = 'literal'          → "field" = 'literal'
 *   field = ${user.userId}     → "field" = current_setting('kintsugi.user_id', true)
 *   field = ${user.tenantCode} → "field" = current_setting('kintsugi.tenant', true)
 *   field IN ('a','b')         → 不支持（返回 null）
 */
function compileSimpleRoleRule(rule: string): string | null {
  const parts = rule
    .split(/\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const out: string[] = [];
  for (const p of parts) {
    const m = /^(\w+)\s*(=|!=|>|>=|<|<=)\s*(.+)$/.exec(p);
    if (!m) return null;
    const [, field, op, valueRaw] = m as unknown as [string, string, string, string];
    if (!IDENT_RE.test(field)) return null;
    const col = quoteIdent(field);
    const sym = op === '!=' ? '<>' : op;
    const v = valueRaw.trim();
    let valueSql: string;
    const interp = v.match(/^\$\{user\.(\w+)\}$/);
    if (interp) {
      const userKey = interp[1]!;
      const settingKey = mapUserKeyToSettingKey(userKey);
      if (!settingKey) return null;
      valueSql = `current_setting('${settingKey}', true)`;
    } else if (/^'.*'$/.test(v)) {
      // 字符串字面量：转义单引号
      valueSql = `'${v.slice(1, -1).replace(/'/g, "''")}'`;
    } else if (/^".*"$/.test(v)) {
      valueSql = `'${v.slice(1, -1).replace(/'/g, "''")}'`;
    } else if (!Number.isNaN(Number(v))) {
      valueSql = String(Number(v));
    } else {
      return null;
    }
    out.push(`${col} ${sym} ${valueSql}`);
  }
  return out.join(' AND ');
}

function mapUserKeyToSettingKey(userKey: string): string | null {
  switch (userKey) {
    case 'userId':
      return 'kintsugi.user_id';
    case 'tenantCode':
      return 'kintsugi.tenant';
    case 'deptId':
    case 'deptIds':
      return 'kintsugi.dept_ids';
    default:
      // 其他 user.x 字段 PG 这边没有对应 GUC；返回 null 让上层 fallback 应用层
      return null;
  }
}

/**
 * 给业务连接生成 SET LOCAL 片段，BFF / Instant API 在事务开始时执行。
 *
 *   SET LOCAL "kintsugi.tenant" = '...';
 *   SET LOCAL "kintsugi.user_id" = '...';
 *   SET LOCAL "kintsugi.dept_ids" = 'd1,d2';
 *
 * 注意值使用 PG quote_literal 转义，避免 SET 注入。
 */
export function emitSetLocalSnippet(ctx: {
  tenantCode?: string | null;
  userId?: string | null;
  deptIds?: string[];
}): string {
  const lines: string[] = [];
  if (ctx.tenantCode) lines.push(`SET LOCAL "kintsugi.tenant" = ${pgLit(ctx.tenantCode)};`);
  if (ctx.userId) lines.push(`SET LOCAL "kintsugi.user_id" = ${pgLit(ctx.userId)};`);
  if (ctx.deptIds && ctx.deptIds.length > 0) {
    lines.push(`SET LOCAL "kintsugi.dept_ids" = ${pgLit(ctx.deptIds.join(','))};`);
  }
  return lines.join('\n');
}

function pgLit(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/**
 * 在 PG 业务连接上注入 session-level GUC：`SET "kintsugi.tenant" = ...` 等。
 *
 * 与 emitSetLocalSnippet 的区别：
 *  - SET LOCAL 仅事务内有效（适合长连接池）
 *  - SET 设到当前 session（适合 per-request 短连接，我们 openAdapter 走的就是这条）
 *
 * 这是"客户启用 RLS policy 后，平台自己代码不被自己 policy 挡掉"的关键链路：
 * 没注 GUC → policy 里 current_setting('kintsugi.tenant', true) = NULL，bypass 也不开 → 全拒。
 *
 * 非 PG 方言（mysql / mariadb / mssql）直接 no-op。
 *
 * 错误处理：单条 SET 失败 warn-log 但不抛——这是兜底层，不应该让用户请求因为 GUC 注入失败而挂；
 * 真正的安全保证仍在应用层 extraWhere（`rls.ts compileRlsClauses`）。
 */
export interface SessionGucCtx {
  tenantCode?: string | null;
  userId?: string | null;
  deptIds?: string[];
}

export interface SessionGucAdapter {
  readonly id: string;
  execute(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

/**
 * 我们这边写入 GUC 用 SET（session-level）不是 SET LOCAL，原因：
 *
 *   每条 openAdapter() 都 `new Client()` 物理建连，请求结束 adapter.close() →
 *   client.end() 物理断连——connection 不是从池里借的，**没有跨请求复用**。
 *   所以 SET 留在 session 上，连接断了一切清空，没有跨 tenant 泄漏窗口。
 *
 *   未来如果某条路径切到连接池（例如把 BFF runtime 换成长连），必须同时把
 *   applySessionGuc 改成 SET LOCAL + 用 transaction 包业务查询，否则连接被
 *   其他 ctx 借走时上一个 GUC 还活着 → 跨租户读。
 *
 *   防御纵深：releaseSessionGuc() 在 close 前显式 RESET，让 GUC 离开当前
 *   连接的可能性降到 0；即使将来误改连接池，连接归还前也是干净的。
 */
const GUC_KEYS = ['kintsugi.tenant', 'kintsugi.user_id', 'kintsugi.dept_ids'] as const;

export async function applySessionGuc(
  adapter: SessionGucAdapter,
  ctx: SessionGucCtx,
  logger?: { warn(msg: string): void },
): Promise<void> {
  if (adapter.id !== 'postgres') return;
  const cmds: Array<[string, string]> = [];
  if (ctx.tenantCode) cmds.push(['kintsugi.tenant', ctx.tenantCode]);
  if (ctx.userId) cmds.push(['kintsugi.user_id', ctx.userId]);
  if (ctx.deptIds && ctx.deptIds.length > 0) {
    cmds.push(['kintsugi.dept_ids', ctx.deptIds.join(',')]);
  }
  for (const [k, v] of cmds) {
    try {
      // SET 不接受 placeholder；标识符固定常量、值走 pgLit 转义。
      await adapter.execute(`SET "${k}" = ${pgLit(v)}`);
    } catch (err) {
      logger?.warn(
        `[rls] applySessionGuc failed for ${k}: ${(err as Error).message}; falling back to app-layer extraWhere only`,
      );
    }
  }
}

/** 防御纵深：close 前 RESET 全部 GUC。short-lived 连接下其实多余（end()
 *  会清掉一切），但万一未来换连接池，这条让 GUC 不会跟连接一起被借出去。 */
export async function releaseSessionGuc(
  adapter: SessionGucAdapter,
  logger?: { warn(msg: string): void },
): Promise<void> {
  if (adapter.id !== 'postgres') return;
  for (const k of GUC_KEYS) {
    try {
      await adapter.execute(`RESET "${k}"`);
    } catch (err) {
      // 不抛——RESET 失败也要让 close 继续走
      logger?.warn(`[rls] releaseSessionGuc RESET ${k} failed: ${(err as Error).message}`);
    }
  }
}
