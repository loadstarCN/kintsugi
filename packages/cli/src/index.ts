import { Command } from 'commander';
import { credsFromEnv, request } from './api-client';

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('kintsugi')
    .description('Kintsugi Kintsugi CLI — connect / inspect / develop against a Kintsugi app')
    .version('0.0.1');

  // ---- auth ----
  const auth = program.command('auth').description('authentication');
  auth
    .command('login')
    .description('log in; writes KINTSUGI_TOKEN to stdout (shell: export $(kintsugi auth login --dotenv))')
    .requiredOption('-t, --tenant <tenantCode>')
    .requiredOption('-u, --username <username>')
    .requiredOption('-p, --password <password>')
    .option('--dotenv', 'print as KINTSUGI_TOKEN=...')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<{ token: string }>(creds, 'POST', '/api/auth/login', {
        tenantCode: opts.tenant,
        username: opts.username,
        password: opts.password,
      });
      if (opts.dotenv) console.log(`KINTSUGI_TOKEN=${r.token}`);
      else console.log(r.token);
    });

  auth
    .command('me')
    .description('show current user')
    .action(async () => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'GET', '/api/auth/me');
      console.log(JSON.stringify(r, null, 2));
    });

  // ---- dataset ----
  const dataset = program.command('dataset').description('datasets');
  dataset
    .command('list')
    .requiredOption('-a, --app <appCode>')
    .option('--format <format>', 'json|table', 'table')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const rows = await request<Array<{ datasetCode: string; tableName: string; alias: string; version: number }>>(
        creds,
        'GET',
        `/api/datasets?appCode=${encodeURIComponent(opts.app)}`,
      );
      if (opts.format === 'json') {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log('CODE                              TABLE                      ALIAS             v');
        for (const r of rows) {
          console.log(
            `${r.datasetCode.padEnd(34)}${r.tableName.padEnd(28)}${r.alias.padEnd(18)}${r.version}`,
          );
        }
      }
    });

  dataset
    .command('detail')
    .requiredOption('-c, --code <datasetCode>')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const d = await request<unknown>(creds, 'GET', `/api/datasets/${opts.code}`);
      console.log(JSON.stringify(d, null, 2));
    });

  dataset
    .command('from-scan')
    .requiredOption('-a, --app <appCode>')
    .requiredOption('-j, --job <jobId>')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', `/api/datasets/from-scan/${opts.job}`, {
        appCode: opts.app,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  // ---- sql ----
  const sql = program.command('sql').description('custom SQL');
  sql
    .command('list')
    .requiredOption('-a, --app <appCode>')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'GET', `/api/sql?appCode=${encodeURIComponent(opts.app)}`);
      console.log(JSON.stringify(r, null, 2));
    });

  sql
    .command('validate')
    .requiredOption('-f, --file <path>')
    .action(async (opts) => {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(opts.file, 'utf-8');
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', '/api/sql/validate', { content });
      console.log(JSON.stringify(r, null, 2));
    });

  sql
    .command('save')
    .requiredOption('-a, --app <appCode>')
    .requiredOption('-d, --ds <dataSourceId>')
    .requiredOption('-n, --name <sqlName>')
    .requiredOption('-f, --file <path>')
    .action(async (opts) => {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(opts.file, 'utf-8');
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', '/api/sql', {
        appCode: opts.app,
        dataSourceId: opts.ds,
        sqlName: opts.name,
        content,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  sql
    .command('exec')
    .requiredOption('-c, --code <sqlCode>')
    .option('-p, --params <json>', 'params JSON string', '{}')
    .option('--sql-safe', 'return {data,error} on failure instead of throwing')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', `/api/sql/${opts.code}/execute`, {
        params: JSON.parse(opts.params),
        sqlSafe: !!opts.sqlSafe,
        actor: 'human',
      });
      console.log(JSON.stringify(r, null, 2));
    });

  // ---- bff ----
  const bff = program.command('bff').description('Backend Functions');
  bff
    .command('list')
    .requiredOption('-a, --app <appCode>')
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'GET', `/api/bff?appCode=${encodeURIComponent(opts.app)}`);
      console.log(JSON.stringify(r, null, 2));
    });

  bff
    .command('push')
    .requiredOption('-a, --app <appCode>')
    .requiredOption('-n, --name <scriptName>')
    .requiredOption('-t, --type <BEFORE_HOOK|AFTER_HOOK|ENDPOINT|PUBLIC_FUNCTION>')
    .requiredOption('-f, --file <path>')
    .option('--dry-run', 'validate only')
    .option('--yes', 'confirm overwrite')
    .action(async (opts) => {
      const { readFile } = await import('node:fs/promises');
      const code = await readFile(opts.file, 'utf-8');
      if (opts.dryRun) {
        console.log(JSON.stringify({ action: 'dry-run', scriptName: opts.name, size: code.length }, null, 2));
        return;
      }
      if (!opts.yes) {
        console.error('will overwrite remote script; pass --yes to confirm');
        process.exit(2);
      }
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'POST', '/api/bff', {
        appCode: opts.app,
        scriptName: opts.name,
        type: opts.type,
        code,
      });
      console.log(JSON.stringify(r, null, 2));
    });

  bff
    .command('exec')
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

  // ---- api pull (openapi.json + 生成 typed client) ----
  program
    .command('api-pull')
    .description('download openapi.json + generate TypeScript types & typed client for an app')
    .requiredOption('-a, --app <appCode>')
    .option(
      '-o, --out <path>',
      'output directory (will write openapi.json + types.ts + client.ts)',
      './generated/sdk',
    )
    .option('--spec-only', 'just write openapi.json, skip codegen', false)
    .action(async (opts) => {
      const creds = credsFromEnv();
      const r = await request<unknown>(creds, 'GET', `/api/apps/${opts.app}/openapi.json`);
      const { writeFile, mkdir } = await import('node:fs/promises');
      const path = await import('node:path');

      // 兼容老路径：如果 -o 是 .json 文件，按"只写 spec"处理
      const outIsJson = /\.json$/i.test(opts.out);
      if (outIsJson || opts.specOnly) {
        await writeFile(opts.out, JSON.stringify(r, null, 2));
        console.log(`wrote ${opts.out}`);
        return;
      }

      await mkdir(opts.out, { recursive: true });
      const specPath = path.join(opts.out, 'openapi.json');
      await writeFile(specPath, JSON.stringify(r, null, 2));
      console.log(`wrote ${specPath}`);

      // 生成 types.ts —— 用 openapi-typescript 库
      const { default: openapiTS, astToString } = await import('openapi-typescript');
      const ast = await openapiTS(r as Parameters<typeof openapiTS>[0]);
      const typesPath = path.join(opts.out, 'types.ts');
      const typesHeader =
        `/**\n * AUTO-GENERATED by \`kintsugi api-pull -a ${opts.app}\`. DO NOT EDIT.\n` +
        ` * Source: openapi.json (Kintsugi server ${creds.baseUrl})\n */\n\n`;
      await writeFile(typesPath, typesHeader + astToString(ast));
      console.log(`wrote ${typesPath}`);

      // 生成 client.ts —— 包一层 typed proxy
      const clientPath = path.join(opts.out, 'client.ts');
      await writeFile(clientPath, renderClient(opts.app));
      console.log(`wrote ${clientPath}`);

      console.log(
        `\nDone. Use it:\n  import { createClient } from '${path.relative(
          process.cwd(),
          path.join(opts.out, 'client'),
        )}';\n  const k = createClient({ baseUrl: '${creds.baseUrl}', token: '...' });\n  const r = await k.dataset('your-dataset').filter({ where: [...] });`,
      );
    });

  // ---- project init ----
  program
    .command('project-init')
    .description('scaffold a new BFF/SQL repo skeleton')
    .option('-o, --out <path>', 'output dir', '.')
    .action(async (opts) => {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(`${opts.out}/bff`, { recursive: true });
      await mkdir(`${opts.out}/sql`, { recursive: true });
      await writeFile(
        `${opts.out}/bff/hello.js`,
        `module.exports = async function handler(ctx) {\n  return { hello: 'world', user: ctx.userInfo, input: ctx.input };\n};\n`,
      );
      await writeFile(
        `${opts.out}/sql/count-goods.sql`,
        `-- kintsugi sql save -n count-goods -f sql/count-goods.sql -a app-demo0001 -d <dsId>\nselect count(*) from goods where type = #{type};\n`,
      );
      console.log('scaffolded bff/hello.js, sql/count-goods.sql');
    });

  // ---- webhook verify ----
  // 不打 server，纯本地工具：让接收方在调试 HMAC 时验证签名实现是否正确。
  // body 接受文件路径 / "-"（stdin）；secret 接受值或 @file（避免 shell history 泄漏）。
  program
    .command('webhook-verify')
    .description('verify a Kintsugi outbound webhook signature locally (no server call)')
    .requiredOption('-s, --secret <value>', 'webhook secret; prefix "@" to read from file (e.g. @secret.txt)')
    .requiredOption('-b, --body <path>', 'request body file path; use "-" for stdin')
    .requiredOption('-S, --signature <value>', 'X-Kintsugi-Signature header value (with or without "sha256=" prefix)')
    .action(async (opts: { secret: string; body: string; signature: string }) => {
      const { readFileSync } = await import('node:fs');
      const crypto = await import('node:crypto');

      const secret: string = opts.secret.startsWith('@')
        ? readFileSync(opts.secret.slice(1), 'utf8').trim()
        : opts.secret;

      let body: Buffer;
      if (opts.body === '-') {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
        }
        body = Buffer.concat(chunks);
      } else {
        body = readFileSync(opts.body);
      }

      const provided = opts.signature.replace(/^sha256=/, '').trim().toLowerCase();
      const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

      const aBuf = Buffer.from(provided, 'hex');
      const bBuf = Buffer.from(expected, 'hex');
      const ok = aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);

      if (ok) {
        console.log('✓ signature OK');
        console.log(`  expected: sha256=${expected}`);
        process.exit(0);
      } else {
        console.error('✗ signature MISMATCH');
        console.error(`  expected: sha256=${expected}`);
        console.error(`  provided: sha256=${provided}`);
        console.error(`  body bytes: ${body.length}`);
        process.exit(1);
      }
    });

  // ---- doctor ----
  program
    .command('doctor')
    .description('check connectivity & auth')
    .action(async () => {
      const creds = credsFromEnv();
      const h = await request<{ status: string }>(creds, 'GET', '/api/health');
      console.log('health:', h.status);
      if (creds.token) {
        try {
          const me = await request<{ username: string }>(creds, 'GET', '/api/auth/me');
          console.log('logged in as:', me.username);
        } catch (err) {
          console.log('token invalid:', (err as Error).message);
        }
      } else {
        console.log('no KINTSUGI_TOKEN set');
      }
    });

  await program.parseAsync(argv);
}

/**
 * 渲染一个最小但 typed 的 client wrapper：
 *  - 引用 generated types.ts 的 paths/components
 *  - 暴露 dataset(table).filter / getOne / create / update / delete / aggregate / getSelectOptions
 *  - 类型从 OpenAPI 自动派生，server 改字段 → 重跑 api-pull → 类型自动跟上
 */
function renderClient(appCode: string): string {
  return `/**
 * AUTO-GENERATED by \`kintsugi api-pull -a ${appCode}\`. DO NOT EDIT.
 * Re-run api-pull when the server's OpenAPI spec changes.
 */
import type { paths, components } from './types';

export interface CreateClientOptions {
  baseUrl: string;
  token?: string;
  /** Custom fetch impl (for tests / Node < 18). */
  fetch?: typeof fetch;
}

type Schemas = components['schemas'];

// 直接从生成的 OpenAPI components 派生，op / direction / pageSize 限制都是真 typed。
// server 改字段 → 重跑 api-pull → 这里类型自动跟上。
export type FilterClause = Schemas['FilterClause'];
export type FilterOp = FilterClause['op'];
export type FilterRequest = Schemas['FilterRequest'];

export interface DatasetClient<TRow> {
  filter(req: FilterRequest): Promise<{ data: TRow[]; page: number; pageSize: number; total: number }>;
  getOne(id: string): Promise<TRow>;
  create(data: Partial<TRow>): Promise<{ ok: true; row?: TRow }>;
  update(id: string, data: Partial<TRow>): Promise<{ ok: true; row?: TRow }>;
  delete(id: string): Promise<{ ok: true; softDeleted: boolean }>;
  aggregate(req: {
    groupBy?: string[];
    aggregates: Array<{ field: string; op: 'count' | 'sum' | 'avg' | 'min' | 'max'; alias?: string }>;
    where?: FilterRequest['where'];
  }): Promise<{ data: Array<Record<string, unknown>> }>;
  getSelectOptions(field: string): Promise<{ options: Array<{ value: string; label: string }> }>;
}

const APP_CODE = ${JSON.stringify(appCode)};

export function createClient(opts: CreateClientOptions) {
  const f = opts.fetch ?? fetch;
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(opts.token ? { authorization: \`Bearer \${opts.token}\` } : {}),
  });
  const url = (path: string): string => \`\${opts.baseUrl.replace(/\\/+$/, '')}\${path}\`;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(url(path), {
      method,
      headers: headers(),
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(\`\${res.status} \${res.statusText}: \${txt.slice(0, 500)}\`);
      (err as Error & { status: number; raw: string }).status = res.status;
      (err as Error & { status: number; raw: string }).raw = txt;
      throw err;
    }
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  function dataset<TRow = Record<string, unknown>>(datasetCode: string): DatasetClient<TRow> {
    const base = \`/api/apps/\${APP_CODE}/ds/\${encodeURIComponent(datasetCode)}\`;
    return {
      filter: (req) => call('POST', \`\${base}/filter\`, req),
      getOne: (id) => call('GET', \`\${base}/\${encodeURIComponent(id)}\`),
      create: (data) => call('POST', base, data),
      update: (id, data) => call('PATCH', \`\${base}/\${encodeURIComponent(id)}\`, data),
      delete: (id) => call('DELETE', \`\${base}/\${encodeURIComponent(id)}\`),
      aggregate: (req) => call('POST', \`\${base}/aggregate\`, req),
      getSelectOptions: (field) => call('GET', \`\${base}/options/\${encodeURIComponent(field)}\`),
    };
  }

  return {
    appCode: APP_CODE,
    dataset,
    sql: {
      execute: (sqlCode: string, params: Record<string, unknown> = {}) =>
        call<{ data: unknown; rowCount: number; riskLevel: string }>(
          'POST',
          \`/api/sql/\${encodeURIComponent(sqlCode)}/execute\`,
          { params },
        ),
    },
    bff: {
      exec: (scriptName: string, input: unknown) =>
        call<{ data: unknown; logs: string[] }>(
          'POST',
          \`/api/bff/exec/\${APP_CODE}/\${encodeURIComponent(scriptName)}\`,
          { input },
        ),
    },
    chats: {
      ask: (question: string) =>
        call<{ sql: string; explanation: string; data: unknown[]; rowCount: number }>(
          'POST',
          '/api/chats/ask',
          { appCode: APP_CODE, question },
        ),
    },
  };
}

export type { paths, components, Schemas };
`;
}
