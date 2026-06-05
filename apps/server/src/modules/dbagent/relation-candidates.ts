import type { ForeignKeyDescriptor, SchemaSnapshot, TableDescriptor } from '@kintsugi/db-scanner';
import { expandPinyinPrefix, PINYIN_ALIASES } from './pinyin-aliases';

/**
 * 规则层：根据命名 / 类型兼容性生成外键"候选关系"。
 *
 * 目的：在调用 LLM 之前把搜索空间从 O(列数²) 缩小到小几十条高似然候选，
 * 再把候选清单喂给 LLM 做复核 + 置信度调整。
 *
 * 不替代 LLM——LLM 仍负责：
 *   (1) 业务语义翻译  (2) 特殊字段角色  (3) 对规则候选做最终取舍 / 评分
 *
 * 不处理已声明 FK：那是 ground truth，规则层直接跳过。
 */

export interface RelationCandidate {
  /** PG schema；MySQL 留空。同 schema 关系两边都给同样的值 / 都为 null。 */
  fromSchema?: string | null;
  fromTable: string;
  fromColumns: string[]; // 目前只做单列
  /** 跨 schema 关系（PG）这边可能 ≠ fromSchema；同表的自引用相等。 */
  toSchema?: string | null;
  toTable: string;
  toColumns: string[];
  /** 0 - 1 启发式分值；越大越像 FK。 */
  heuristicScore: number;
  /** 命中了哪些规则，便于调试和 UI 展示。 */
  reasons: string[];
}

/** 单数化 / 复数化小处理，够用的英语启发式；不追求语言学完美。 */
function singular(s: string): string {
  if (s.endsWith('ies') && s.length > 3) return s.slice(0, -3) + 'y';
  if (s.endsWith('sses')) return s.slice(0, -2); // addresses → address
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}
function plural(s: string): string {
  if (s.endsWith('y') && s.length > 1) return s.slice(0, -1) + 'ies';
  if (s.endsWith('s')) return s;
  return s + 's';
}

/** 常见表前缀（尾标 _t / t_ / tbl_ / sys_ 等），剥离后用于名字匹配。 */
const TABLE_PREFIX_PATTERNS = [/^t_/, /^tbl_/, /^tb_/, /^sys_/, /^biz_/];
const TABLE_SUFFIX_PATTERNS = [/_t$/, /_tbl$/];

/** 语义明确的自引用前缀。命中即允许 FK 指回自己。 */
const SELF_REF_PREFIXES = new Set([
  'parent', 'child', 'prev', 'previous', 'next',
  'reply', 'reply_to', 'root', 'ancestor',
  'source', 'src', 'target', 'dst', 'dest',
  'origin', 'predecessor', 'successor',
  'manager', 'reports_to',
]);
function tableBase(name: string): string {
  let s = name.toLowerCase();
  for (const p of TABLE_PREFIX_PATTERNS) s = s.replace(p, '');
  for (const p of TABLE_SUFFIX_PATTERNS) s = s.replace(p, '');
  return s;
}

/** 标识这是一个 "xxx_id" / "xxxId" / "xxx_code" / "xxxCode" 形的列。返回去掉后缀的前缀，或 null。 */
function extractIdPrefix(columnName: string): { prefix: string; suffix: string } | null {
  const low = columnName.toLowerCase();
  if (low === 'id') return null; // 自身主键
  if (low.endsWith('_id')) return { prefix: low.slice(0, -3), suffix: 'id' };
  if (low.endsWith('_code')) return { prefix: low.slice(0, -5), suffix: 'code' };
  // 驼峰 xxxId
  const camel = /^(.+?)(Id|Code)$/.exec(columnName);
  if (camel && camel[1] && camel[2]) {
    return { prefix: camel[1].toLowerCase(), suffix: camel[2].toLowerCase() };
  }
  return null;
}

/** 类型是否兼容到足以做 FK。逻辑类型归类；允许 integer↔bigint。 */
function compatibleTypes(a: string, b: string): boolean {
  if (a === b) return true;
  const INT_SET = new Set(['integer', 'bigint']);
  if (INT_SET.has(a) && INT_SET.has(b)) return true;
  const STR_SET = new Set(['string', 'text', 'uuid']);
  if (STR_SET.has(a) && STR_SET.has(b)) return true;
  return false;
}

interface DeclaredFkIndex {
  has(fromTable: string, fromCol: string): boolean;
}
function buildDeclaredFkIndex(tables: TableDescriptor[]): DeclaredFkIndex {
  const seen = new Set<string>();
  for (const t of tables) {
    for (const fk of t.foreignKeys as ForeignKeyDescriptor[]) {
      for (const c of fk.columns) {
        seen.add(`${t.name.toLowerCase()}::${c.toLowerCase()}`);
      }
    }
  }
  return {
    has(fromTable, fromCol) {
      return seen.has(`${fromTable.toLowerCase()}::${fromCol.toLowerCase()}`);
    },
  };
}

function findPkColumn(t: TableDescriptor): { name: string; logicalType: string } | null {
  const pk = t.columns.find((c) => c.primaryKeyOrder === 1);
  if (!pk) return null;
  // 复合主键这里先跳过；候选层不做复合键匹配。
  const hasSecondPk = t.columns.some((c) => c.primaryKeyOrder && c.primaryKeyOrder > 1);
  if (hasSecondPk) return null;
  return { name: pk.name, logicalType: pk.logicalType };
}

/**
 * 主入口：返回按 score 降序的候选列表。
 */
export function findRelationCandidates(snapshot: SchemaSnapshot): RelationCandidate[] {
  const tables = snapshot.tables;
  const fkIndex = buildDeclaredFkIndex(tables);
  const byBase = new Map<string, TableDescriptor[]>();
  for (const t of tables) {
    const key = tableBase(t.name);
    const list = byBase.get(key);
    if (list) list.push(t);
    else byBase.set(key, [t]);
    // 也注册单/复数变体
    const s = singular(key);
    const p = plural(key);
    if (s !== key) {
      const ls = byBase.get(s);
      if (ls) ls.push(t);
      else byBase.set(s, [t]);
    }
    if (p !== key) {
      const lp = byBase.get(p);
      if (lp) lp.push(t);
      else byBase.set(p, [t]);
    }
  }

  const candidates: RelationCandidate[] = [];

  for (const t of tables) {
    // 单列 PK（典型 id 自增）跳过；复合 PK 的列不跳——junction 表 (post_id, category_id)
    // 这种情况下两列都是潜在 FK，必须留下评估。
    const pkColumnCount = t.columns.filter((c) => c.primaryKeyOrder).length;
    const isJunctionLike = pkColumnCount >= 2;

    for (const col of t.columns) {
      if (col.primaryKeyOrder && !isJunctionLike) continue; // 单列 PK
      if (fkIndex.has(t.name, col.name)) continue; // 已声明 FK

      const idInfo = extractIdPrefix(col.name);
      if (!idInfo) continue;

      const prefix = idInfo.prefix;
      if (!prefix) continue;

      // 查找名字或 base 命中的表。
      // 默认跳过自引用，避免 substring 误匹（e.g. `order_create_user_id` 不应当指回 order.id）。
      // 但 parent_/child_/prev_/next_/reply_/root_/ancestor_/source_/target_ 这类
      // 自引用语义明确的前缀允许命中本表 —— 没这条 self-ref 模式（树形/链表/双向引用）会全 miss。
      const allowSelfRef = SELF_REF_PREFIXES.has(prefix);
      const hits = new Map<string, { table: TableDescriptor; reasons: string[] }>();
      const addHit = (cand: TableDescriptor, reason: string): void => {
        if (cand.name === t.name && !allowSelfRef) return;
        let h = hits.get(cand.name);
        if (!h) {
          h = { table: cand, reasons: [] };
          hits.set(cand.name, h);
        }
        h.reasons.push(reason);
      };

      // 拼音缩写扩展：yh → [user, users, yonghu, ...]，命中其中任一表 base。
      // 不替代英文路径——拼音 + 英文同时尝试，hit 取并集。
      const pinyinExpansions = expandPinyinPrefix(prefix);
      const isPinyinAlias = pinyinExpansions.length > 1;
      const tryKeys = new Set<string>([prefix, singular(prefix), plural(prefix)]);
      for (const exp of pinyinExpansions) {
        tryKeys.add(exp);
        tryKeys.add(singular(exp));
        tryKeys.add(plural(exp));
      }
      for (const key of tryKeys) {
        const matched = byBase.get(key);
        if (matched) {
          for (const m of matched) {
            const reason = isPinyinAlias && key !== prefix
              ? `pinyin "${prefix}" → "${key}" matches base of "${m.name}"`
              : `name "${key}" matches base of "${m.name}"`;
            addHit(m, reason);
          }
        }
      }

      // 自引用：parent_id / next_id 等语义明确的前缀，强制把当前表作为候选——
      // 不通过 byBase 是因为前缀不会匹配到自己（e.g. 'parent' ≠ 'department'）。
      if (allowSelfRef) {
        addHit(t, `self-reference via "${prefix}" prefix`);
      }

      // 还要兼容 "contains"：order_create_user_id → user 表
      for (const other of tables) {
        const base = tableBase(other.name);
        if (prefix === base) continue; // 已精确命中
        if (prefix.endsWith(base) || prefix.includes('_' + base) || prefix.includes(base + '_')) {
          addHit(other, `"${col.name}" contains table base "${base}"`);
        }
      }

      for (const { table: cand, reasons } of hits.values()) {
        const pk = findPkColumn(cand);
        if (!pk) continue;
        if (!compatibleTypes(col.logicalType, pk.logicalType)) continue;

        let score = 0.4;
        const finalReasons: string[] = [...reasons];

        const base = tableBase(cand.name);
        const aliases = PINYIN_ALIASES[prefix];
        const pinyinHit = aliases?.includes(base) || aliases?.includes(singular(base)) || aliases?.includes(plural(base));
        if (base === prefix) {
          score += 0.45; // 精确匹配
          finalReasons.push('exact base match');
        } else if (singular(base) === prefix || plural(base) === prefix) {
          score += 0.3;
          finalReasons.push('singular/plural match');
        } else if (pinyinHit) {
          score += 0.25; // 拼音同义；略低于 sg/pl 但显著高于纯 substring
          finalReasons.push(`pinyin alias "${prefix}" → "${base}"`);
        } else {
          score += 0.1;
          finalReasons.push('substring match');
        }

        if (col.logicalType === pk.logicalType) {
          score += 0.05;
          finalReasons.push('same logical type');
        }

        // 如果列名以 _id 结尾且 pk 叫 id → 更像
        if (idInfo.suffix === 'id' && pk.name.toLowerCase() === 'id') {
          score += 0.05;
          finalReasons.push('pk is "id"');
        }

        // 裁剪到 [0,1]
        if (score > 1) score = 1;

        const fromSchema = (t as { schema?: string | null }).schema ?? null;
        const toSchema = (cand as { schema?: string | null }).schema ?? null;
        if (fromSchema && toSchema && fromSchema !== toSchema) {
          finalReasons.push(`cross-schema (${fromSchema} → ${toSchema})`);
        }
        candidates.push({
          fromSchema,
          fromTable: t.name,
          fromColumns: [col.name],
          toSchema,
          toTable: cand.name,
          toColumns: [pk.name],
          heuristicScore: Number(score.toFixed(3)),
          reasons: finalReasons,
        });
      }
    }
  }

  // 排序、去重（同一对 from→to 取最高分）
  const dedup = new Map<string, RelationCandidate>();
  for (const c of candidates) {
    // schema 进 dedup key —— 跨 schema 同表名不会被合并
    const fs = (c.fromSchema ?? '').toLowerCase();
    const ts = (c.toSchema ?? '').toLowerCase();
    const k = `${fs}.${c.fromTable.toLowerCase()}.${c.fromColumns.join(',')}→${ts}.${c.toTable.toLowerCase()}.${c.toColumns.join(',')}`;
    const prev = dedup.get(k);
    if (!prev || c.heuristicScore > prev.heuristicScore) dedup.set(k, c);
  }

  return Array.from(dedup.values()).sort((a, b) => b.heuristicScore - a.heuristicScore);
}
