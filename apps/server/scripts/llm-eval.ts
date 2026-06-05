/**
 * LLM 离线评估骨架。
 *
 * 用途：
 *   - 改 prompt 模板 / 切换 provider 前，跑一遍 fixture，看回归。
 *   - CI 默认 mock 模式（不掏钱、可重复），需要真打 LLM 时加 --live。
 *
 * fixture 格式（apps/server/scripts/fixtures/llm-eval/*.json）：
 *   {
 *     "name": "...",
 *     "task": "chat-sql" | "page-classify" | "sql-risk",
 *     "messages": [{ role, content }, ...],
 *     "expected": {
 *       // 至少满足一个；多个并存视作 AND
 *       "mustContain": ["string", ...],
 *       "mustNotContain": ["string", ...],
 *       "matchRegex": "^SELECT",
 *       "jsonShape": { "riskLevel": "low|medium|high|critical" }
 *     },
 *     // mock 模式下用：替代真实 LLM 的回放输出
 *     "mockResponse": "SELECT count(*) FROM goods"
 *   }
 *
 * 用法：
 *   pnpm --filter @kintsugi/server llm:eval                       # mock 模式
 *   pnpm --filter @kintsugi/server llm:eval -- --live             # 实打 provider
 *   pnpm --filter @kintsugi/server llm:eval -- --task=sql-risk
 *
 * 退出码：所有 fixture 通过 → 0，任意失败 → 1（CI gate 直接接 fail）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from '@kintsugi/llm';

type Task = 'chat-sql' | 'page-classify' | 'sql-risk';

interface ExpectedShape {
  mustContain?: string[];
  mustNotContain?: string[];
  matchRegex?: string;
  jsonShape?: Record<string, string>;
}

interface Fixture {
  name: string;
  task: Task;
  messages: LlmMessage[];
  expected: ExpectedShape;
  /** mock 模式回放；--live 时忽略。 */
  mockResponse?: string;
}

interface Result {
  fixture: string;
  task: Task;
  passed: boolean;
  reasons: string[];
  output: string;
}

function loadFixtures(dir: string, taskFilter: Task | null): Fixture[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const out: Fixture[] = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Fixture;
    if (taskFilter && raw.task !== taskFilter) continue;
    out.push(raw);
  }
  return out;
}

class MockProvider implements LlmProvider {
  readonly id = 'deepseek' as const;
  readonly model = 'mock';
  private readonly responses: Map<string, string>;
  constructor(fixtures: Fixture[]) {
    this.responses = new Map();
    for (const f of fixtures) {
      if (f.mockResponse !== undefined) this.responses.set(f.name, f.mockResponse);
    }
  }
  /** 通过 user 字段把 fixture 名带进来，供 mock 查表。 */
  complete(req: LlmRequest): Promise<LlmResponse> {
    const key = req.user ?? '';
    const r = this.responses.get(key);
    if (r === undefined) {
      return Promise.reject(new Error(`MockProvider: no recorded response for "${key}"`));
    }
    return Promise.resolve({ content: r, usage: { totalTokens: 0 } });
  }
}

async function loadLiveProvider(): Promise<LlmProvider> {
  const apiKey = process.env['DEEPSEEK_API_KEY'];
  if (!apiKey) {
    throw new Error('--live requires DEEPSEEK_API_KEY env var');
  }
  const llm = await import('@kintsugi/llm');
  return llm.createLlmProvider({
    provider: 'deepseek',
    model: process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat',
    apiKey,
  });
}

function grade(output: string, expected: ExpectedShape): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (expected.mustContain) {
    for (const s of expected.mustContain) {
      if (!output.includes(s)) reasons.push(`missing "${s}"`);
    }
  }
  if (expected.mustNotContain) {
    for (const s of expected.mustNotContain) {
      if (output.includes(s)) reasons.push(`unwanted "${s}" present`);
    }
  }
  if (expected.matchRegex) {
    // 支持 fixture 写 "/^SELECT/i" 形式自带 flags；裸字符串则默认无 flag
    const m = /^\/(.+)\/([gimsuy]*)$/.exec(expected.matchRegex);
    const re = m ? new RegExp(m[1]!, m[2]) : new RegExp(expected.matchRegex);
    if (!re.test(output)) reasons.push(`regex ${expected.matchRegex} did not match`);
  }
  if (expected.jsonShape) {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      for (const [k, allowed] of Object.entries(expected.jsonShape)) {
        const v = parsed[k];
        if (typeof v !== 'string') {
          reasons.push(`json.${k} not string`);
          continue;
        }
        const allow = allowed.split('|').map((s) => s.trim());
        if (!allow.includes(v)) reasons.push(`json.${k}="${v}" not in [${allow.join(',')}]`);
      }
    } catch (e) {
      reasons.push(`json parse failed: ${(e as Error).message}`);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

function parseArgs(argv: string[]): { live: boolean; task: Task | null } {
  let live = false;
  let task: Task | null = null;
  for (const a of argv) {
    if (a === '--live') live = true;
    else if (a.startsWith('--task=')) task = a.slice('--task='.length) as Task;
  }
  return { live, task };
}

async function main(): Promise<void> {
  const { live, task } = parseArgs(process.argv.slice(2));
  const fixDir = path.resolve(__dirname, 'fixtures/llm-eval');
  const fixtures = loadFixtures(fixDir, task);
  if (fixtures.length === 0) {
    console.error(`no fixtures under ${fixDir}${task ? ` (filter task=${task})` : ''}`);
    process.exit(1);
  }

  const provider: LlmProvider = live ? await loadLiveProvider() : new MockProvider(fixtures);
  console.log(`[llm-eval] mode=${live ? 'live' : 'mock'} fixtures=${fixtures.length} model=${provider.model}`);

  const results: Result[] = [];
  for (const fix of fixtures) {
    let output = '';
    try {
      const resp = await provider.complete({
        messages: fix.messages,
        temperature: 0,
        user: fix.name,
        timeoutMs: 30_000,
      });
      output = resp.content;
    } catch (e) {
      results.push({
        fixture: fix.name,
        task: fix.task,
        passed: false,
        reasons: [`provider error: ${(e as Error).message}`],
        output: '',
      });
      continue;
    }
    const { passed, reasons } = grade(output, fix.expected);
    results.push({ fixture: fix.name, task: fix.task, passed, reasons, output });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log('');
  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${icon}] ${r.task}/${r.fixture}`);
    if (!r.passed) {
      for (const rs of r.reasons) console.log(`       ${rs}`);
      console.log(`       output: ${r.output.slice(0, 200)}${r.output.length > 200 ? '…' : ''}`);
    }
  }
  console.log('');
  console.log(`[llm-eval] ${passed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
