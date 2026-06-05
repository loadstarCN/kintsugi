import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ApiError, api } from './api';

function stubFetch(response: unknown, status = 200, contentType = 'application/json'): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(typeof response === 'string' ? response : JSON.stringify(response), {
      status,
      headers: { 'content-type': contentType },
    });
  }) as unknown as typeof fetch;
  return { calls };
}

describe('apiFetch', () => {
  beforeEach(() => {
    // jsdom 默认 location=about:blank；handleUnauthorized 模块级 guard 在 import 时已初始化，
    // 跨用例不重置；这里把 location 强行写到 /，且非 /login，单独验 401 用例时再覆盖
    Object.defineProperty(window, 'location', {
      value: { pathname: '/', assign: vi.fn() },
      writable: true,
    });
  });

  it('GET prepends /api and parses JSON', async () => {
    const { calls } = stubFetch({ ok: true, value: 1 });
    const r = await api.get<{ ok: boolean; value: number }>('/foo');
    expect(r).toEqual({ ok: true, value: 1 });
    expect(calls[0]!.url).toBe('/api/foo');
    expect(calls[0]!.init.method).toBeUndefined();
  });

  it('POST sends JSON body + content-type', async () => {
    const { calls } = stubFetch({ id: 'x' });
    await api.post('/foo', { name: 'a' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.body).toBe('{"name":"a"}');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('throws ApiError with backend message on 4xx JSON response', async () => {
    stubFetch({ message: '名字不能为空' }, 400);
    await expect(api.post('/foo', {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: '名字不能为空',
    });
  });

  it('hides 5xx backend message; surfaces generic Chinese msg', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch({ message: 'pg: relation foo does not exist' }, 500);
    await expect(api.get('/foo')).rejects.toMatchObject({
      status: 500,
      message: '服务器开小差了，请稍后重试',
    });
    // 后端 message 仍写到 console.warn，方便 debug
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('pg: relation foo does not exist'),
    );
    warn.mockRestore();
  });

  it('falls back to "HTTP <status>" when 4xx body has no message', async () => {
    stubFetch('plain text body', 404, 'text/plain');
    await expect(api.get('/missing')).rejects.toMatchObject({
      status: 404,
      message: 'HTTP 404',
    });
  });

  it('ApiError carries raw body for inspection', async () => {
    stubFetch({ message: 'bad', detail: { field: 'name' } }, 400);
    try {
      await api.get('/foo');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).body).toEqual({ message: 'bad', detail: { field: 'name' } });
    }
  });

  it('DELETE / PATCH / PUT route through correct method', async () => {
    const { calls } = stubFetch({ ok: true });
    await api.delete('/x');
    await api.patch('/x', { a: 1 });
    await api.put('/x', { a: 2 });
    expect(calls.map((c) => c.init.method)).toEqual(['DELETE', 'PATCH', 'PUT']);
  });
});
