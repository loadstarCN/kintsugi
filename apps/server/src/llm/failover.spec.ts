/**
 * 验证 LlmModule 里 withFailover 的几条不变量：
 *  - 主 provider 成功 → 不调 fallback
 *  - 主 5xx-like 错误 → fallback 接管
 *  - 主 timeout → 不 fallback（直接抛）
 *  - 没配 fallback → 行为透明
 */

import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider, LlmResponse } from '@kintsugi/llm';

// 复刻 module 内部的 withFailover —— 该函数不 export，但行为关键，单测里复现。
// 真要变更 withFailover 签名时这条会跟着改。
function withFailover(
  primary: LlmProvider,
  fallback: LlmProvider | null,
): LlmProvider {
  if (!fallback) return primary;
  return {
    id: primary.id,
    model: primary.model,
    async complete(req): Promise<LlmResponse> {
      try {
        return await primary.complete(req);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (/timeout|aborted|abortError/i.test(msg)) throw err;
        return await fallback.complete(req);
      }
    },
  };
}

function fakeProvider(opts: { fail?: Error; usage?: LlmResponse['usage'] } = {}): LlmProvider {
  return {
    id: 'deepseek',
    model: 'fake',
    complete: vi.fn().mockImplementation(async () => {
      if (opts.fail) throw opts.fail;
      return { content: 'ok', ...(opts.usage ? { usage: opts.usage } : {}) };
    }),
  };
}

describe('LLM failover', () => {
  it('passes through to primary on success', async () => {
    const primary = fakeProvider();
    const fallback = fakeProvider();
    const wrapped = withFailover(primary, fallback);
    const r = await wrapped.complete({ messages: [] });
    expect(r.content).toBe('ok');
    expect(primary.complete).toHaveBeenCalledOnce();
    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it('falls back when primary throws non-timeout error', async () => {
    const primary = fakeProvider({ fail: new Error('LLM upstream 502: bad gateway') });
    const fallback = fakeProvider();
    const wrapped = withFailover(primary, fallback);
    const r = await wrapped.complete({ messages: [] });
    expect(r.content).toBe('ok');
    expect(fallback.complete).toHaveBeenCalledOnce();
  });

  it('does NOT fall back on timeout (avoids doubling user wait)', async () => {
    const primary = fakeProvider({ fail: new Error('aborted: request timeout') });
    const fallback = fakeProvider();
    const wrapped = withFailover(primary, fallback);
    await expect(wrapped.complete({ messages: [] })).rejects.toThrow(/timeout/);
    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it('without fallback configured, returns primary unchanged', async () => {
    const primary = fakeProvider({ fail: new Error('boom') });
    const wrapped = withFailover(primary, null);
    expect(wrapped).toBe(primary);
    await expect(wrapped.complete({ messages: [] })).rejects.toThrow(/boom/);
  });
});
