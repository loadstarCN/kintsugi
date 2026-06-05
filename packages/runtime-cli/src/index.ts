import { Command } from 'commander';

/**
 * Runtime CLI —— 给运行态 AI Agent（如 Claude）调用。
 *
 * 设计差异：
 *  - **只暴露 execute 类命令**（sql exec / bff exec），**不暴露 list/detail** —— 避免 Agent 把系统翻个底朝天。
 *  - 每条命令都有 riskLevel；critical 拒绝执行并要求人类通过普通 CLI 确认。
 */

interface CliCredentials {
  baseUrl: string;
  token?: string;
}

function credsFromEnv(): CliCredentials {
  return {
    baseUrl: process.env['KINTSUGI_API_BASE'] ?? 'http://localhost:4000',
    ...(process.env['KINTSUGI_TOKEN'] ? { token: process.env['KINTSUGI_TOKEN'] } : {}),
  };
}

async function request<T>(
  creds: CliCredentials,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(creds.token ? { authorization: `Bearer ${creds.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function runRuntimeCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('kintsugi-runtime')
    .description('Kintsugi Runtime CLI (for AI agents; no listing allowed).')
    .version('0.0.1');

  program
    .command('sql-exec')
    .description('execute a saved custom SQL by sqlCode (low risk only for ai actor)')
    .requiredOption('-c, --code <sqlCode>')
    .option('-p, --params <json>', 'params JSON string', '{}')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', `/api/sql/${opts.code}/execute`, {
        params: JSON.parse(opts.params),
        sqlSafe: true,
        actor: 'ai',
      });
      console.log(JSON.stringify(r, null, 2));
    });

  program
    .command('bff-exec')
    .description('execute a bff endpoint')
    .requiredOption('-a, --app <appCode>')
    .requiredOption('-n, --name <scriptName>')
    .option('-p, --payload <json>', 'payload JSON', '{}')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', `/api/bff/exec/${opts.app}/${opts.name}`, {
        payload: JSON.parse(opts.payload),
      });
      console.log(JSON.stringify(r, null, 2));
    });

  program
    .command('chats-ask')
    .description('ask a natural-language question (NL→SQL)')
    .requiredOption('-a, --app <appCode>')
    .requiredOption('-q, --question <text>')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', '/api/chats/ask', {
        appCode: opts.app,
        question: opts.question,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  await program.parseAsync(argv);
}
