/**
 * DBAgent 的 Prompt 集。保持在一个地方便于调优 / 版本化 / 单测。
 * 原则：
 *  1. System 讲角色和边界；User 传事实和输出 schema。
 *  2. 所有推理输出都要求 JSON，便于机械解析。
 *  3. 让模型只做**推断**，不改写任何数据，不执行任何 SQL。
 *  4. 关系推断走"规则候选 → LLM 复核"两步，不要求 LLM 自己穷举 O(列²)。
 *  5. 大 schema 必须**分批**提交：每批少量表 + 与这批相关的候选，避免单次 prompt 过大导致 LLM 超时。
 */

export const SEMANTIC_ANALYSIS_SYSTEM = `你是一个资深数据架构师助手。

输入会给你：
 - 主表（"tables"）：本批需要生成业务语义 + 参与关系复核的表。完整结构 + 样本数据。
 - 邻居表（"neighborTables"）：候选外键中**引用到**但不在本批的表。只给 name + comment + 主键列。它们的业务语义由各自批次负责生成，本批**不要**为它们产生 \`tables\` 条目，只把它们当作关系复核时的参考。
 - 候选外键关系列表（"relationCandidates"）：规则层产出的启发式候选。

你的任务是：
1. 为 \`tables\` 中每张主表和字段生成中文业务含义；**不要**为 \`neighborTables\` 生成 \`tables\` 条目。
2. 识别主表的特殊字段角色：主键 / 时间戳 / 软删除 / 多租户 / 用户归属 / 版本号；
3. **对"候选外键关系"里的每一条，必须在 \`inferredRelations\` 数组中输出一条对应决策**——\`decision\` 取 \`accept\`（候选合理，原样接受）/ \`reject\`（候选不合理，应剔除）/ \`modify\`（候选方向或字段需要修正，请按修正后的写 fromTable/fromColumns/toTable/toColumns）。不可省略任何候选。置信度 \`confidence\` 是你复核后的最终分。
4. 候选的另一端如果出现在 \`neighborTables\` 里，请**把它当作存在**来评估；不要以"表不存在"为由 reject。
5. 除了复核候选外，如果你从命名/样本里明显看出候选列表**漏掉**的关系（且双方都在 tables 或 neighborTables 中），也追加到同一个 \`inferredRelations\` 数组；但不要穷举 O(列²) 枚举。

关于已声明外键：
 - 主表的 \`foreignKeys\` 数组是数据库硬声明的 ground truth。
 - **不要**把它们重复到 \`inferredRelations\` 输出里。
 - 若某条候选和已声明外键完全重复（同一对表/列），统一按 \`decision: reject\` 处理并在 \`reason\` 里说明"已有 FK"。

输出要求：
 - 必须是合法 JSON，严格匹配 user 消息给的 schema。
 - tableName/columnName 必须一字不差复用输入里出现过的原值。
 - 不输出 markdown 围栏、解释、注释。
 - \`inferredRelations\` 条数 ≥ 本批候选条数（每条候选至少对应一条决策）。`;

export interface SemanticAnalysisTable {
  name: string;
  comment?: string;
  columns: Array<{
    name: string;
    nativeType: string;
    logicalType: string;
    nullable: boolean;
    isAutoIncrement: boolean;
    primaryKeyOrder?: number;
    enumValues?: string[];
    comment?: string;
  }>;
  foreignKeys: Array<{
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
  }>;
  sampleRows?: Array<Record<string, unknown>>;
}

export interface SemanticAnalysisRelationCandidate {
  fromTable: string;
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  heuristicScore: number;
  reasons: string[];
}

/** 候选另一端引用到的表，但不在本批。只带名字 + 主键列（让 LLM 知道"存在"和"PK 长什么样"）。 */
export interface SemanticAnalysisNeighborTable {
  name: string;
  comment?: string;
  primaryKeyColumns: Array<{ name: string; nativeType: string }>;
}

export interface SemanticAnalysisSchemaInput {
  dialect: string;
  database: string;
  tables: SemanticAnalysisTable[];
  /** 本批之外、但被候选外键引用到的表的瘦身信息。 */
  neighborTables?: SemanticAnalysisNeighborTable[];
  /** 规则层生成的外键候选。LLM 的任务是复核 / 修正 / 剔除。 */
  relationCandidates: SemanticAnalysisRelationCandidate[];
}

/**
 * 列名命中这些正则就把值整体替换成 <redacted:reason>。原始数据**不送 LLM**。
 *
 * 注意：这是**最佳努力**，不能保证 100% 拦截 PII —— 用户列名可能和业务含义脱节
 * （比如 `col1` 实际存身份证）。所以前端在开抽样开关时也要明确告知"会发到 LLM
 * 厂商"，让用户决定是否开。这里是默认安全网。
 */
const SENSITIVE_COL_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'password', re: /(^|_)(password|passwd|pwd|secret|token|access[_-]?key|api[_-]?key|private[_-]?key)($|_)/i },
  { name: 'email', re: /(^|_)(e?mail)($|_|address)/i },
  { name: 'phone', re: /(^|_)(phone|mobile|tel|cell)($|_|number|num)/i },
  { name: 'idcard', re: /(^|_)(id[_-]?card|身份证|sfz|ssn|passport)($|_|no|number)/i },
  { name: 'bankcard', re: /(^|_)(bank[_-]?card|card[_-]?no|iban|account[_-]?no)($|_)/i },
  { name: 'name', re: /(^|_)(real[_-]?name|full[_-]?name|姓名|user[_-]?name)($|_)/i },
  { name: 'address', re: /(^|_)(home[_-]?address|address|地址|addr)($|_)/i },
];

function classifyColumn(colName: string): string | null {
  for (const p of SENSITIVE_COL_PATTERNS) {
    if (p.re.test(colName)) return p.name;
  }
  return null;
}

/**
 * 把快照里某一批表的样本做瘦身：
 *  - 最多 `maxRows` 行
 *  - 值超 `maxValLen` 截断
 *  - 丢弃 null / undefined 字段，减少 token 浪费
 *  - **敏感列名（password/email/phone/idcard/bankcard/name/address）值整体打码**
 *    防止 PII 原文外发到 LLM 厂商
 */
export function slimSampleRows(
  rows: Array<Record<string, unknown>> | undefined,
  maxRows = 3,
  maxValLen = 120,
): Array<Record<string, unknown>> | undefined {
  if (!rows || rows.length === 0) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows.slice(0, maxRows)) {
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) continue;
      const sensitive = classifyColumn(k);
      if (sensitive) {
        slim[k] = `<redacted:${sensitive}>`;
        continue;
      }
      if (typeof v === 'string' && v.length > maxValLen) {
        slim[k] = v.slice(0, maxValLen) + `…(${v.length})`;
      } else if (v instanceof Date) {
        slim[k] = v.toISOString();
      } else if (Buffer.isBuffer(v)) {
        slim[k] = `<buffer len=${v.length}>`;
      } else if (typeof v === 'object') {
        const s = safeStringify(v);
        slim[k] = s.length > maxValLen ? s.slice(0, maxValLen) + '…' : s;
      } else {
        slim[k] = v;
      }
    }
    out.push(slim);
  }
  return out;
}

/** 保留候选中 "fromTable" 或 "toTable" 属于当前批的那些。 */
export function filterCandidatesForChunk(
  candidates: SemanticAnalysisRelationCandidate[],
  chunkTableNames: ReadonlyArray<string>,
): SemanticAnalysisRelationCandidate[] {
  const inChunk = new Set(chunkTableNames);
  return candidates.filter((c) => inChunk.has(c.fromTable) || inChunk.has(c.toTable));
}

export function buildSemanticAnalysisUserMessage(input: SemanticAnalysisSchemaInput): string {
  const outputSchema = {
    tables: [
      {
        tableName: 'string',
        businessName: 'string (中文)',
        aliasEn: 'string (可选)',
        fields: [
          {
            columnName: 'string',
            businessName: 'string (中文)',
            role: '可选：primaryKey|createdAt|updatedAt|softDelete|tenantCode|userId|version|foreignKey|unknown',
          },
        ],
      },
    ],
    inferredRelations: [
      {
        fromTable: 'string',
        fromColumns: ['string'],
        toTable: 'string',
        toColumns: ['string'],
        cardinality: 'manyToOne | oneToMany | oneToOne | manyToMany',
        confidence: 'number 0-1；对候选做了复核后的最终分',
        decision: 'accept | reject | modify',
        reason: 'string (为什么接受/拒绝/修改)',
      },
    ],
    specialFields: [
      {
        tableName: 'string',
        columnName: 'string',
        role: 'primaryKey | createdAt | updatedAt | softDelete | tenantCode | userId | version | unknown',
      },
    ],
  };

  // 用紧凑 JSON（无空格），把提示词体积压到最小；模型解析 JSON 不依赖 pretty-print。
  const neighbors = input.neighborTables ?? [];
  const sections: string[] = [
    `这是一批 ${input.tables.length} 张主表的结构（另有 ${neighbors.length} 张邻居表仅作关系复核参考）。请返回指定 schema 的 JSON 输出。`,
    '',
    '## 数据库信息',
    JSON.stringify({ dialect: input.dialect, database: input.database }),
    '',
    '## 主表 tables（你需要为这些表生成业务语义）',
    JSON.stringify(input.tables),
  ];
  if (neighbors.length) {
    sections.push(
      '',
      '## 邻居表 neighborTables（候选外键引用到，本批不生成语义；仅用于判断关系是否成立）',
      JSON.stringify(neighbors),
    );
  }
  sections.push(
    '',
    `## 外键候选 relationCandidates（共 ${input.relationCandidates.length} 条；你必须对每一条都在 inferredRelations 中输出一条 decision 结果）`,
    JSON.stringify(input.relationCandidates),
    '',
    '## 期望输出（严格匹配此 JSON schema）',
    JSON.stringify(outputSchema),
  );
  return sections.join('\n');
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export interface SemanticAnalysisResult {
  tables: Array<{
    tableName: string;
    businessName: string;
    aliasEn?: string;
    fields: Array<{
      columnName: string;
      businessName: string;
      role?: string;
    }>;
  }>;
  inferredRelations: Array<{
    fromTable: string;
    fromColumns: string[];
    toTable: string;
    toColumns: string[];
    cardinality: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';
    confidence: number;
    decision: 'accept' | 'reject' | 'modify';
    reason?: string;
  }>;
  specialFields: Array<{
    tableName: string;
    columnName: string;
    role: string;
  }>;
}

/** 合并多批 LLM 分析结果（去重按 tableName / (fromTable,toTable,fromCols,toCols)）。 */
export function mergeSemanticResults(parts: SemanticAnalysisResult[]): SemanticAnalysisResult {
  const tablesMap = new Map<string, SemanticAnalysisResult['tables'][number]>();
  const relsMap = new Map<string, SemanticAnalysisResult['inferredRelations'][number]>();
  const specMap = new Map<string, SemanticAnalysisResult['specialFields'][number]>();

  for (const part of parts) {
    for (const t of part.tables ?? []) {
      if (!tablesMap.has(t.tableName)) tablesMap.set(t.tableName, t);
    }
    for (const r of part.inferredRelations ?? []) {
      const key = `${r.fromTable}|${r.fromColumns.join(',')}->${r.toTable}|${r.toColumns.join(',')}`;
      const existing = relsMap.get(key);
      // 相同关系出现多次，保留置信度较高的那一版
      if (!existing || r.confidence > existing.confidence) relsMap.set(key, r);
    }
    for (const s of part.specialFields ?? []) {
      const key = `${s.tableName}.${s.columnName}`;
      if (!specMap.has(key)) specMap.set(key, s);
    }
  }

  return {
    tables: [...tablesMap.values()],
    inferredRelations: [...relsMap.values()],
    specialFields: [...specMap.values()],
  };
}
