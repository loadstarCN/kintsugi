import * as crypto from 'crypto';
import type {
  AggregateRequest,
  AggregateResult,
  BffExecRequest,
  ChatsAskRequest,
  ChatsAskResult,
  FilterRequest,
  FilterResult,
  SqlExecRequest,
  SqlExecResult,
} from './types';

export interface KintsugiClientOptions {
  baseUrl: string;
  appCode: string;
  auth?:
    | { kind: 'cookie' }
    | { kind: 'token'; token: string }
    | { kind: 'accessKey'; accessKey: string; secretKey: string };
  fetch?: typeof fetch;
}

export class KintsugiHttpError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(
      `HTTP ${status}: ${
        typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)
      }`,
    );
    this.name = 'KintsugiHttpError';
  }
}

export interface DatasetClient<T = Record<string, unknown>> {
  filter(req?: FilterRequest): Promise<FilterResult<T>>;
  getOne(id: string | number): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  update(id: string | number, data: Partial<T>): Promise<T>;
  delete(id: string | number): Promise<{ ok: true; softDeleted: boolean }>;
  batchCreate(rows: Array<Partial<T>>): Promise<{ created: number }>;
  aggregate<R = Record<string, unknown>>(req: AggregateRequest): Promise<AggregateResult<R>>;
  getSelectOptions(field: string): Promise<{ options: Array<{ value: string; label: string }> }>;
}

export interface KintsugiClient {
  readonly appCode: string;
  readonly models: { [datasetCode: string]: DatasetClient };
  bff: {
    execute<T = unknown>(req: BffExecRequest): Promise<T>;
  };
  sql: {
    execute<T = Record<string, unknown>>(req: SqlExecRequest): Promise<SqlExecResult<T>>;
  };
  chats: {
    ask(req: Omit<ChatsAskRequest, 'appCode'>): Promise<ChatsAskResult>;
  };
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

/**
 * 协议约定：null / undefined / 空对象 / 空字符串 → ''。
 * 服务端 hmac.guard 用同样规则。
 */
function serializeBodyForSign(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && Object.keys(body as Record<string, unknown>).length === 0) {
    return '';
  }
  return JSON.stringify(body);
}

export function createClient(opts: KintsugiClientOptions): KintsugiClient {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('No fetch implementation available; pass opts.fetch');
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${base}${path}`;
    const bodyStr = serializeBodyForSign(body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (opts.auth?.kind === 'token') {
      headers['Authorization'] = `Bearer ${opts.auth.token}`;
    } else if (opts.auth?.kind === 'accessKey') {
      // 协议：path 不带 query；body 为 null/undefined/空对象/空字符串 时签 ''。
      const signPath = path.split('?')[0]!;
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = crypto.randomBytes(8).toString('hex');
      const canonical = [method.toUpperCase(), signPath, timestamp, nonce, bodyStr].join('\n');
      const sig = crypto.createHmac('sha256', opts.auth.secretKey).update(canonical).digest('hex');
      headers['X-Access-Key'] = opts.auth.accessKey;
      headers['X-Timestamp'] = timestamp;
      headers['X-Nonce'] = nonce;
      headers['X-Signature'] = sig;
    }
    const res = await fetchImpl(url, {
      method,
      headers,
      credentials: opts.auth?.kind === 'cookie' ? 'include' : 'omit',
      body: bodyStr || undefined,
    });
    const ct = res.headers.get('content-type') ?? '';
    const raw = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new KintsugiHttpError(res.status, raw);
    return raw as T;
  }

  function makeDatasetClient(datasetCode: string): DatasetClient {
    const dsBase = `/api/apps/${opts.appCode}/ds/${datasetCode}`;
    return {
      filter: (req) => request('POST', `${dsBase}/filter`, req ?? {}),
      getOne: (id) => request('GET', `${dsBase}/${encodeURIComponent(String(id))}`),
      create: (data) => request('POST', dsBase, data),
      update: (id, data) =>
        request('PATCH', `${dsBase}/${encodeURIComponent(String(id))}`, data),
      delete: (id) =>
        request<{ ok: true; softDeleted: boolean }>(
          'DELETE',
          `${dsBase}/${encodeURIComponent(String(id))}`,
        ),
      batchCreate: (rows) =>
        request<{ created: number }>('POST', `${dsBase}/batchCreate`, { rows }),
      aggregate: (req) => request('POST', `${dsBase}/aggregate`, req),
      getSelectOptions: (field) =>
        request('GET', `${dsBase}/options/${encodeURIComponent(field)}`),
    };
  }

  const modelsCache = new Map<string, DatasetClient>();
  const models = new Proxy({} as Record<string, DatasetClient>, {
    get(_t, prop: string) {
      if (!modelsCache.has(prop)) modelsCache.set(prop, makeDatasetClient(prop));
      return modelsCache.get(prop)!;
    },
  });

  return {
    appCode: opts.appCode,
    models,
    bff: {
      execute: <T = unknown>(req: BffExecRequest) =>
        request<T>(
          'POST',
          `/api/bff/exec/${opts.appCode}/${encodeURIComponent(req.scriptName)}`,
          { payload: req.payload },
        ),
    },
    sql: {
      execute: <T = Record<string, unknown>>(req: SqlExecRequest) =>
        request<SqlExecResult<T>>(
          'POST',
          `/api/sql/${encodeURIComponent(req.sqlCode)}/execute`,
          {
            params: req.params ?? {},
            actor: req.actor ?? 'human',
            sqlSafe: req.sqlSafe ?? false,
          },
        ),
    },
    chats: {
      ask: (req) =>
        request<ChatsAskResult>('POST', `/api/chats/ask`, {
          appCode: opts.appCode,
          question: req.question,
          ...(req.maxTables !== undefined ? { maxTables: req.maxTables } : {}),
        }),
    },
    request,
  };
}
