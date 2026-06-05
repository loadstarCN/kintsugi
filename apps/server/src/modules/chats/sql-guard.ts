import { KintsugiError } from '@kintsugi/shared';

/**
 * Chats / NL→SQL 输出的 SQL 二次检查。**主防御**仍是 adapter.runReadonly 走
 * PG `BEGIN ... READ ONLY` 事务（DB 层强制写类被拒）。本 guard 是**防御纵深**：
 *
 *   1. **拒多 statement**：cleanSql 中间不能含 `;`（防 `SELECT 1; pg_sleep(60)` DoS）
 *   2. **必须 SELECT/WITH/EXPLAIN 开头**（精准匹配，避免 `inserted_at` /
 *      `update_count` / `dropdowns` 这类列名/表名被错杀）
 *
 * 历史（v1）：用 `\b(insert|update|...)\b` 关键字 regex，会误伤含这些子串的列名。
 * 现在 v2：开头匹配 + 多 statement 拒，准确得多。
 *
 * 返回 cleanSql（trim + 去尾部分号）；不合法抛 KintsugiError(FORBIDDEN)。
 */
export function guardChatsSql(rawSql: string): string {
  if (!rawSql || typeof rawSql !== 'string') {
    throw new KintsugiError('FORBIDDEN', 'empty or invalid SQL');
  }
  const cleanSql = rawSql.trim().replace(/;+\s*$/, '');
  // multi-statement → 拒
  if (cleanSql.includes(';')) {
    throw new KintsugiError(
      'FORBIDDEN',
      'multi-statement SQL refused (single SELECT only)',
    );
  }
  // 必须以 SELECT / WITH / EXPLAIN 开头
  if (!/^\s*(select|with|explain)\b/i.test(cleanSql)) {
    throw new KintsugiError('FORBIDDEN', 'non-SELECT SQL refused');
  }
  return cleanSql;
}
