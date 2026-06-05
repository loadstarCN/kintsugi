/**
 * RedisRateLimitStore 的单元测试。
 *
 * 不连真 Redis：手写一个最小 fake，实现我们的 Lua 脚本依赖的 4 个原语：
 *   INCR / PEXPIRE / PTTL  (+ GET 用于 peek)
 *
 * 这样可以在 CI / 本地都跑，不依赖网络也不依赖 ioredis-mock 这种额外依赖。
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { MemoryRateLimitStore, RedisRateLimitStore, makeFallbackProxy, type RateLimitStore } from './rate-limit-store';

interface Entry {
  value: number;
  expiresAt: number | null; // ms epoch；null = 永不过期
}

class FakeRedis {
  private kv = new Map<string, Entry>();

  private now(): number {
    return Date.now();
  }

  private getEntry(k: string): Entry | null {
    const e = this.kv.get(k);
    if (!e) return null;
    if (e.expiresAt != null && this.now() >= e.expiresAt) {
      this.kv.delete(k);
      return null;
    }
    return e;
  }

  async incr(k: string): Promise<number> {
    const e = this.getEntry(k);
    if (!e) {
      const fresh: Entry = { value: 1, expiresAt: null };
      this.kv.set(k, fresh);
      return 1;
    }
    e.value += 1;
    return e.value;
  }

  async pexpire(k: string, ms: number): Promise<number> {
    const e = this.getEntry(k);
    if (!e) return 0;
    e.expiresAt = this.now() + ms;
    return 1;
  }

  async pttl(k: string): Promise<number> {
    const e = this.getEntry(k);
    if (!e) return -2;
    if (e.expiresAt == null) return -1;
    return Math.max(0, e.expiresAt - this.now());
  }

  async get(k: string): Promise<string | null> {
    const e = this.getEntry(k);
    return e ? String(e.value) : null;
  }

  /** 模拟 ioredis 的 EVAL：解析少量 Lua 命令并 dispatch 到上面的方法。
   *  我们的脚本只用了 INCR / PEXPIRE / PTTL，按行模拟即可。 */
  async eval(_script: string, _numKeys: number, ...args: (string | number)[]): Promise<unknown> {
    const k = String(args[0]);
    const windowMs = Number(args[1]);

    const count = await this.incr(k);
    if (count === 1) {
      await this.pexpire(k, windowMs);
    }
    let pttl = await this.pttl(k);
    if (pttl < 0) {
      await this.pexpire(k, windowMs);
      pttl = windowMs;
    }
    return [count, pttl];
  }
}

describe('RedisRateLimitStore (fake redis)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts hits monotonically within window, sets expire on first hit', async () => {
    const fake = new FakeRedis();
    const store = new RedisRateLimitStore(fake, 'test:rl');
    const a = await store.hit('k1', 60_000);
    const b = await store.hit('k1', 60_000);
    const c = await store.hit('k1', 60_000);
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(c.count).toBe(3);
    // 第一次 hit 设了 60s 过期；后续 PTTL 应在 60s 之内
    expect(c.resetAt - Date.now()).toBeLessThanOrEqual(60_000);
    expect(c.resetAt - Date.now()).toBeGreaterThan(0);
  });

  it('isolates keys', async () => {
    const fake = new FakeRedis();
    const store = new RedisRateLimitStore(fake, 'test:rl');
    expect((await store.hit('a', 60_000)).count).toBe(1);
    expect((await store.hit('b', 60_000)).count).toBe(1);
    expect((await store.hit('a', 60_000)).count).toBe(2);
  });

  it('resets count after window expires', async () => {
    const fake = new FakeRedis();
    const store = new RedisRateLimitStore(fake, 'test:rl');
    await store.hit('k', 60_000);
    await store.hit('k', 60_000);
    vi.advanceTimersByTime(61_000);
    const r = await store.hit('k', 60_000);
    expect(r.count).toBe(1);
  });

  it('peek returns count + resetAt for live key, null for unknown', async () => {
    const fake = new FakeRedis();
    const store = new RedisRateLimitStore(fake, 'test:rl');
    expect(await store.peek('absent')).toBeNull();
    await store.hit('k', 60_000);
    const p = await store.peek('k');
    expect(p?.count).toBe(1);
    expect(p && p.resetAt > Date.now()).toBe(true);
  });

  it('applies the configured key prefix', async () => {
    const fake = new FakeRedis();
    const store = new RedisRateLimitStore(fake, 'kintsugi-prod-zk3p9wq2x7:rl:global');
    await store.hit('minute:ip:1.2.3.4', 60_000);
    // fake 里键是 prefix:userKey
    const v = await fake.get('kintsugi-prod-zk3p9wq2x7:rl:global:minute:ip:1.2.3.4');
    expect(v).toBe('1');
  });
});

describe('makeFallbackProxy (Redis 挂掉时回 memory)', () => {
  it('active 抛 → 走 memory 不抛 500', async () => {
    const flaky: RateLimitStore = {
      hit: async () => { throw new Error('ECONNREFUSED'); },
    };
    const memory = new MemoryRateLimitStore();
    let lastLog = 0;
    const proxy = makeFallbackProxy(() => flaky, memory, 'login', () => lastLog, (t) => { lastLog = t; });

    const r1 = await proxy.hit('1.2.3.4', 60_000);
    const r2 = await proxy.hit('1.2.3.4', 60_000);
    expect(r1.count).toBe(1);
    expect(r2.count).toBe(2); // memory 持续累计，仍然限速
  });

  it('active 恢复后立即走回 active（不黏在 memory）', async () => {
    let active: RateLimitStore = {
      hit: async () => { throw new Error('redis down'); },
    };
    const memory = new MemoryRateLimitStore();
    let lastLog = 0;
    const proxy = makeFallbackProxy(() => active, memory, 'p', () => lastLog, (t) => { lastLog = t; });

    await proxy.hit('k', 60_000); // 进 memory，count=1
    // 切回健康 active：内存里 count 不变；新的请求由健康 active 处理
    let activeCalls = 0;
    active = {
      hit: async () => {
        activeCalls += 1;
        return { count: 99, resetAt: Date.now() + 60_000 };
      },
    };
    const r = await proxy.hit('k', 60_000);
    expect(activeCalls).toBe(1);
    expect(r.count).toBe(99);
  });

  it('memory 抛 → 透传（防止隐藏 bug）', async () => {
    const broken: RateLimitStore = {
      hit: async () => { throw new Error('memory broken'); },
    };
    let lastLog = 0;
    // 当 active === memory（即没有 redis 时）抛错应原样透传，不静默吞
    const proxy = makeFallbackProxy(() => broken, broken, 'p', () => lastLog, (t) => { lastLog = t; });
    await expect(proxy.hit('k', 1000)).rejects.toThrow(/memory broken/);
  });
});
