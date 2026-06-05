import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { runRuntimeCli } from './index';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function installFetchStub(response: unknown, status = 200): RecordedCall[] {
  const recorded: RecordedCall[] = [];
  const stub = vi.fn(async (url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    recorded.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  globalThis.fetch = stub as unknown as typeof fetch;
  return recorded;
}

describe('runtime-cli', () => {
  let logs: string[] = [];
  const realLog = console.log;
  beforeEach(() => {
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    process.env['KINTSUGI_API_BASE'] = 'http://api.test';
    process.env['KINTSUGI_TOKEN'] = 'tok-abc';
  });
  afterEach(() => {
    console.log = realLog;
    delete process.env['KINTSUGI_API_BASE'];
    delete process.env['KINTSUGI_TOKEN'];
  });

  it('sql-exec POSTs to /api/sql/:code/execute with actor=ai + bearer token', async () => {
    const calls = installFetchStub({ rowCount: 1, data: [] });
    await runRuntimeCli(['node', 'cli', 'sql-exec', '-c', 'sq-1', '-p', '{"x":1}']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/sql/sq-1/execute');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['authorization']).toBe('Bearer tok-abc');
    expect(calls[0]!.body).toEqual({ params: { x: 1 }, sqlSafe: true, actor: 'ai' });
  });

  it('bff-exec POSTs payload to /api/bff/exec/:app/:script', async () => {
    const calls = installFetchStub({ ok: true });
    await runRuntimeCli(['node', 'cli', 'bff-exec', '-a', 'app-x', '-n', 'hello', '-p', '{"name":"world"}']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/bff/exec/app-x/hello');
    expect(calls[0]!.body).toEqual({ payload: { name: 'world' } });
  });

  it('chats-ask POSTs to /api/chats/ask with appCode + question', async () => {
    const calls = installFetchStub({ sql: 'SELECT 1', explanation: '' });
    await runRuntimeCli(['node', 'cli', 'chats-ask', '-a', 'app-x', '-q', '本月数据']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.test/api/chats/ask');
    expect(calls[0]!.body).toEqual({ appCode: 'app-x', question: '本月数据' });
  });

  it('omits Authorization header when KINTSUGI_TOKEN unset', async () => {
    delete process.env['KINTSUGI_TOKEN'];
    const calls = installFetchStub({ ok: true });
    await runRuntimeCli(['node', 'cli', 'bff-exec', '-a', 'a', '-n', 's']);
    expect(calls[0]!.headers['authorization']).toBeUndefined();
  });

  it('throws on non-2xx response with status + body', async () => {
    installFetchStub({ message: 'forbidden' }, 403);
    await expect(
      runRuntimeCli(['node', 'cli', 'chats-ask', '-a', 'a', '-q', 'q']),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('default base URL falls back to localhost:4000 when env unset', async () => {
    delete process.env['KINTSUGI_API_BASE'];
    const calls = installFetchStub({ ok: true });
    await runRuntimeCli(['node', 'cli', 'bff-exec', '-a', 'a', '-n', 's']);
    expect(calls[0]!.url.startsWith('http://localhost:4000/')).toBe(true);
  });
});
