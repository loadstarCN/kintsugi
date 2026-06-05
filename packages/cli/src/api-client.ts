/**
 * 轻量 API client，用在 CLI / Runtime CLI 两套。
 * 通过 KINTSUGI_API_BASE + KINTSUGI_TOKEN（或 KINTSUGI_ACCESS_KEY/SECRET）访问后端。
 */

export class CliApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CliApiError';
  }
}

export interface CliCredentials {
  baseUrl: string;
  token?: string;
}

export function credsFromEnv(): CliCredentials {
  return {
    baseUrl: process.env['KINTSUGI_API_BASE'] ?? 'http://localhost:4000',
    ...(process.env['KINTSUGI_TOKEN'] ? { token: process.env['KINTSUGI_TOKEN'] } : {}),
  };
}

export async function request<T>(
  creds: CliCredentials,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(creds.token ? { authorization: `Bearer ${creds.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const raw = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new CliApiError(`HTTP ${res.status}: ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`, res.status, raw);
  }
  return raw as T;
}
