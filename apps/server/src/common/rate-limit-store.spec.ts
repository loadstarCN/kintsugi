import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRateLimitStore } from './rate-limit-store';

describe('MemoryRateLimitStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts hits in the same window monotonically', async () => {
    const s = new MemoryRateLimitStore();
    const a = await s.hit('k', 60_000);
    const b = await s.hit('k', 60_000);
    const c = await s.hit('k', 60_000);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(c.count).toBe(3);
    expect(a.resetAt).toBe(b.resetAt);
    expect(a.resetAt).toBe(c.resetAt);
  });

  it('isolates different keys', async () => {
    const s = new MemoryRateLimitStore();
    expect((await s.hit('a', 60_000)).count).toBe(1);
    expect((await s.hit('b', 60_000)).count).toBe(1);
    expect((await s.hit('a', 60_000)).count).toBe(2);
  });

  it('resets count after window expires', async () => {
    const s = new MemoryRateLimitStore();
    await s.hit('k', 60_000);
    await s.hit('k', 60_000);
    vi.advanceTimersByTime(61_000);
    const r = await s.hit('k', 60_000);
    expect(r.count).toBe(1);
  });

  it('peek returns null for unknown / expired keys', async () => {
    const s = new MemoryRateLimitStore();
    expect(await s.peek('none')).toBeNull();
    await s.hit('k', 60_000);
    expect((await s.peek('k'))?.count).toBe(1);
    vi.advanceTimersByTime(61_000);
    expect(await s.peek('k')).toBeNull();
  });

  it('prunes expired entries when over threshold', async () => {
    const s = new MemoryRateLimitStore({ pruneAt: 5 });
    for (let i = 0; i < 10; i++) await s.hit(`k${i}`, 1_000);
    vi.advanceTimersByTime(5_000);
    // 触发新的 hit；超过 pruneAt 触发 prune，把过期项删掉
    await s.hit('fresh', 60_000);
    // 旧 key 进入新窗口（重置计数）
    expect((await s.hit('k0', 60_000)).count).toBe(1);
  });
});
