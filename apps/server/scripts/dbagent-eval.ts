/**
 * DBAgent 关系推理离线评估工具。
 *
 * 用法：
 *   pnpm --filter @kintsugi/server exec tsx scripts/dbagent-eval.ts
 *   或：pnpm --filter @kintsugi/server exec tsx scripts/dbagent-eval.ts \
 *       --fixtures scripts/fixtures/dbagent-eval/
 *
 * fixture 格式（每个 *.json）：
 *   {
 *     "name": "...",
 *     "snapshot": SchemaSnapshot,
 *     "expected": [{ fromTable, fromColumn, toTable, toColumn }]
 *   }
 *
 * 输出：每个 fixture 的 precision/recall/F1 + 总体宏平均。
 *
 * 这是规则层（findRelationCandidates）的评估，不打 LLM；LLM 评估请另起 fixture 集
 * + harness（cost 高，需要 mock provider 或受控配额）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRelationCandidates } from '../src/modules/dbagent/relation-candidates';
import type { SchemaSnapshot } from '@kintsugi/db-scanner';

interface ExpectedEdge {
  /** 可选 schema；fixture 不写就忽略 schema 维度，只匹 table.column。 */
  fromSchema?: string;
  fromTable: string;
  fromColumn: string;
  toSchema?: string;
  toTable: string;
  toColumn: string;
}

interface Fixture {
  name: string;
  snapshot: SchemaSnapshot;
  expected: ExpectedEdge[];
  /** 候选保留阈值，默认 0.5（"会进 LLM 复核 batch"的最低分；不是 LLM 接受标准）。 */
  threshold?: number;
}

interface FixtureScore {
  name: string;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  missed: ExpectedEdge[];
  spurious: Array<{ fromTable: string; fromColumn: string; toTable: string; toColumn: string }>;
}

function edgeKey(e: {
  fromSchema?: string | null;
  fromTable: string;
  fromColumn: string;
  toSchema?: string | null;
  toTable: string;
  toColumn: string;
}): string {
  // schema 缺省（MySQL / 老 fixture）→ 不进 key，确保旧 fixture 仍兼容
  const fs = e.fromSchema ? `${e.fromSchema}.` : '';
  const ts = e.toSchema ? `${e.toSchema}.` : '';
  return `${fs}${e.fromTable}.${e.fromColumn}→${ts}${e.toTable}.${e.toColumn}`;
}

function scoreFixture(fx: Fixture): FixtureScore {
  const threshold = fx.threshold ?? 0.5;
  // 如果任一 expected edge 写了 schema，启用 schema 模式：候选侧也带 schema。
  // 不写 schema 的 fixture（老的 / MySQL）保持原样。
  const expectsSchema = fx.expected.some((e) => e.fromSchema || e.toSchema);
  const candidates = findRelationCandidates(fx.snapshot)
    .filter((c) => c.heuristicScore >= threshold)
    .map((c) => ({
      ...(expectsSchema ? { fromSchema: c.fromSchema ?? undefined } : {}),
      fromTable: c.fromTable,
      fromColumn: c.fromColumns[0]!,
      ...(expectsSchema ? { toSchema: c.toSchema ?? undefined } : {}),
      toTable: c.toTable,
      toColumn: c.toColumns[0]!,
    }));

  const expectedSet = new Set(fx.expected.map(edgeKey));
  const candidateSet = new Set(candidates.map(edgeKey));

  let tp = 0;
  for (const k of candidateSet) if (expectedSet.has(k)) tp++;
  const fp = candidateSet.size - tp;
  const fn = expectedSet.size - tp;

  const precision = candidateSet.size === 0 ? 1 : tp / candidateSet.size;
  const recall = expectedSet.size === 0 ? 1 : tp / expectedSet.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const missed = fx.expected.filter((e) => !candidateSet.has(edgeKey(e)));
  const spurious = candidates.filter((e) => !expectedSet.has(edgeKey(e)));

  return {
    name: fx.name,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    precision,
    recall,
    f1,
    missed,
    spurious,
  };
}

function loadFixtures(dir: string): Fixture[] {
  const out: Fixture[] = [];
  if (!fs.existsSync(dir)) {
    throw new Error(`fixture dir not found: ${dir}`);
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push(JSON.parse(raw) as Fixture);
  }
  return out;
}

function fmt(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function main(): void {
  const args = process.argv.slice(2);
  let fixtureDir = path.join(__dirname, 'fixtures', 'dbagent-eval');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fixtures' && args[i + 1]) {
      fixtureDir = path.resolve(args[i + 1]!);
      i++;
    }
  }
  const fixtures = loadFixtures(fixtureDir);
  if (fixtures.length === 0) {
    console.log(`no fixtures found in ${fixtureDir}`);
    process.exit(1);
  }
  console.log(`Loaded ${fixtures.length} fixture(s) from ${fixtureDir}\n`);
  const scores = fixtures.map(scoreFixture);
  for (const s of scores) {
    console.log(
      `${s.name.padEnd(30)} P=${fmt(s.precision)}  R=${fmt(s.recall)}  F1=${fmt(s.f1)}  ` +
        `(tp=${s.truePositive} fp=${s.falsePositive} fn=${s.falseNegative})`,
    );
    if (s.missed.length) {
      console.log(`  missed: ${s.missed.map(edgeKey).join(', ')}`);
    }
    if (s.spurious.length) {
      console.log(`  spurious: ${s.spurious.map(edgeKey).join(', ')}`);
    }
  }
  const macroP = scores.reduce((a, s) => a + s.precision, 0) / scores.length;
  const macroR = scores.reduce((a, s) => a + s.recall, 0) / scores.length;
  const macroF1 = scores.reduce((a, s) => a + s.f1, 0) / scores.length;
  console.log(`\nMacro: P=${fmt(macroP)}  R=${fmt(macroR)}  F1=${fmt(macroF1)}`);

  // 退出码：F1 < 0.7 视为回归
  const minF1 = Number(process.env['DBAGENT_EVAL_MIN_F1'] ?? '0.70');
  if (macroF1 < minF1) {
    console.error(`\nFAIL: macro F1 ${fmt(macroF1)} < threshold ${fmt(minF1)}`);
    process.exit(2);
  }
}

main();
