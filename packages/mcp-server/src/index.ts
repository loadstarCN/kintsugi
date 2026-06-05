/**
 * Kintsugi MCP Server（stdio transport）。
 *
 * 实现 MCP 协议 1.x 的最小子集：initialize / tools/list / tools/call。
 * 工具列表（read）：
 *  - list_datasets(appCode)
 *  - get_dataset_detail(datasetCode)
 *  - validate_sql_content(content)
 *  - execute_sql(sqlCode, params)
 *  - ask_chat(appCode, question)
 *  - list_bff_scripts(appCode)
 * 工具列表（write，需要 KINTSUGI_TOKEN 持有 *:write 权限）：
 *  - write_bff(appCode, scriptName, type, code, boundDataset?)
 *  - write_sql(appCode, sqlName, content, dataSourceId?, sqlCode?, paramsSchema?)
 *  - update_dataset_do(datasetCode, doJson, expectedVersion?)
 *  - get_rls_policy(datasetCode)
 *
 * 不依赖 @modelcontextprotocol/sdk，手写 stdio JSON-RPC 以减少依赖，兼容官方协议。
 */

const API_BASE = process.env['KINTSUGI_API_BASE'] ?? 'http://localhost:4000';
const TOKEN = process.env['KINTSUGI_TOKEN'];

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const TOOLS = [
  {
    name: 'list_datasets',
    description: 'List all datasets for an application (returns tableName / alias / datasetCode)',
    inputSchema: {
      type: 'object',
      properties: { appCode: { type: 'string' } },
      required: ['appCode'],
    },
  },
  {
    name: 'get_dataset_detail',
    description: 'Get a dataset DO JSON (fields + relations + special field roles)',
    inputSchema: {
      type: 'object',
      properties: { datasetCode: { type: 'string' } },
      required: ['datasetCode'],
    },
  },
  {
    name: 'validate_sql_content',
    description: 'Validate a SQL string: returns riskLevel + placeholders. Does not execute.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
  {
    name: 'execute_sql',
    description:
      'Execute a saved Custom SQL by sqlCode. actor=ai is default; critical SQL is refused.',
    inputSchema: {
      type: 'object',
      properties: {
        sqlCode: { type: 'string' },
        params: { type: 'object' },
      },
      required: ['sqlCode'],
    },
  },
  {
    name: 'ask_chat',
    description: 'Ask a natural-language question against an app; returns SQL + result rows.',
    inputSchema: {
      type: 'object',
      properties: {
        appCode: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['appCode', 'question'],
    },
  },
  {
    name: 'list_bff_scripts',
    description: 'List BFF scripts for an application',
    inputSchema: {
      type: 'object',
      properties: { appCode: { type: 'string' } },
      required: ['appCode'],
    },
  },
  {
    name: 'write_bff',
    description:
      'Create or update a BFF script (upsert by appCode+scriptName). type ∈ {BEFORE_HOOK, AFTER_HOOK, ENDPOINT, PUBLIC_FUNCTION}.',
    inputSchema: {
      type: 'object',
      properties: {
        appCode: { type: 'string' },
        scriptName: { type: 'string' },
        type: {
          type: 'string',
          enum: ['BEFORE_HOOK', 'AFTER_HOOK', 'ENDPOINT', 'PUBLIC_FUNCTION'],
        },
        code: { type: 'string' },
        boundDataset: { type: 'string' },
        submitter: { type: 'string' },
      },
      required: ['appCode', 'scriptName', 'type', 'code'],
    },
  },
  {
    name: 'write_sql',
    description:
      'Create or update a Custom SQL by sqlName (upsert). Use #{param} placeholders. riskLevel is computed by the server.',
    inputSchema: {
      type: 'object',
      properties: {
        appCode: { type: 'string' },
        sqlName: { type: 'string' },
        content: { type: 'string' },
        dataSourceId: { type: 'string' },
        sqlCode: { type: 'string', description: 'Pass when updating existing SQL.' },
        paramsSchema: { type: 'object' },
      },
      required: ['appCode', 'sqlName', 'content'],
    },
  },
  {
    name: 'update_dataset_do',
    description:
      'Update a dataset DO JSON. Pass expectedVersion (from get_dataset_detail) for optimistic locking.',
    inputSchema: {
      type: 'object',
      properties: {
        datasetCode: { type: 'string' },
        doJson: { type: 'object' },
        expectedVersion: { type: 'number' },
      },
      required: ['datasetCode', 'doJson'],
    },
  },
  {
    name: 'get_rls_policy',
    description:
      'Emit suggested PostgreSQL RLS policy SQL for a dataset (PG only). Returns sql + dropSql + warnings; not executed.',
    inputSchema: {
      type: 'object',
      properties: { datasetCode: { type: 'string' } },
      required: ['datasetCode'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'list_datasets':
      return apiGet(`/api/datasets?appCode=${encodeURIComponent(String(args['appCode']))}`);
    case 'get_dataset_detail':
      return apiGet(`/api/datasets/${encodeURIComponent(String(args['datasetCode']))}`);
    case 'validate_sql_content':
      return apiPost('/api/sql/validate', { content: args['content'] });
    case 'execute_sql':
      return apiPost(`/api/sql/${encodeURIComponent(String(args['sqlCode']))}/execute`, {
        params: args['params'] ?? {},
        sqlSafe: true,
        actor: 'ai',
      });
    case 'ask_chat':
      return apiPost('/api/chats/ask', { appCode: args['appCode'], question: args['question'] });
    case 'list_bff_scripts':
      return apiGet(`/api/bff?appCode=${encodeURIComponent(String(args['appCode']))}`);
    case 'write_bff':
      return apiPost('/api/bff', {
        appCode: args['appCode'],
        scriptName: args['scriptName'],
        type: args['type'],
        code: args['code'],
        ...(args['boundDataset'] !== undefined ? { boundDataset: args['boundDataset'] } : {}),
        ...(args['submitter'] !== undefined ? { submitter: args['submitter'] } : {}),
      });
    case 'write_sql': {
      const sqlCode = args['sqlCode'];
      if (sqlCode) {
        // 已存在 → PATCH
        return apiPatch(`/api/sql/${encodeURIComponent(String(sqlCode))}`, {
          content: args['content'],
          ...(args['sqlName'] !== undefined ? { sqlName: args['sqlName'] } : {}),
          ...(args['paramsSchema'] !== undefined ? { paramsSchema: args['paramsSchema'] } : {}),
        });
      }
      return apiPost('/api/sql', {
        appCode: args['appCode'],
        sqlName: args['sqlName'],
        content: args['content'],
        ...(args['dataSourceId'] !== undefined ? { dataSourceId: args['dataSourceId'] } : {}),
        ...(args['paramsSchema'] !== undefined ? { paramsSchema: args['paramsSchema'] } : {}),
      });
    }
    case 'update_dataset_do':
      return apiPatch(
        `/api/datasets/${encodeURIComponent(String(args['datasetCode']))}/do`,
        {
          doJson: args['doJson'],
          ...(args['expectedVersion'] !== undefined
            ? { expectedVersion: args['expectedVersion'] }
            : {}),
        },
      );
    case 'get_rls_policy':
      return apiGet(
        `/api/datasets/${encodeURIComponent(String(args['datasetCode']))}/rls-policy`,
      );
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function writeResponse(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

export async function startMcpServer(): Promise<void> {
  let buf = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx = buf.indexOf('\n');
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      idx = buf.indexOf('\n');
      if (line) void handleLine(line);
    }
  });
  process.stdin.on('end', () => process.exit(0));

  // 告知 launcher: server ready
  process.stderr.write(`[kintsugi-mcp] stdio ready. api=${API_BASE}\n`);
}

async function handleLine(line: string): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch (err) {
    return;
  }

  const rid = req.id;
  const method = req.method;

  try {
    if (method === 'initialize') {
      writeResponse({
        jsonrpc: '2.0',
        id: rid,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'kintsugi-mcp', version: '0.0.1' },
        },
      });
      return;
    }
    if (method === 'tools/list') {
      writeResponse({ jsonrpc: '2.0', id: rid, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const p = req.params as { name: string; arguments: Record<string, unknown> };
      const out = await callTool(p.name, p.arguments ?? {});
      writeResponse({
        jsonrpc: '2.0',
        id: rid,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] },
      });
      return;
    }
    writeResponse({
      jsonrpc: '2.0',
      id: rid,
      error: { code: -32601, message: `method not supported: ${method}` },
    });
  } catch (err) {
    writeResponse({
      jsonrpc: '2.0',
      id: rid,
      error: { code: -32000, message: (err as Error).message },
    });
  }
}
