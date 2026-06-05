/**
 * 限流存储抽象。
 *
 * 内存实现：单进程；多实例下各自计数（流量真实值是 N 倍，宽松）。
 * Redis 实现：跨实例共享一份计数；用 INCR + PEXPIRE 原子化（首次请求才设过期）。
 *
 * 切换：环境变量 REDIS_URL 存在 → 自动用 Redis；否则 fallback 内存。
 * Redis 客户端 ioredis 通过动态 import 加载——无 REDIS_URL 时不会触碰这个依赖，
 * 也允许未安装 ioredis 的部署正常起服务（用内存版）。
 */

import { Logger } from '@nestjs/common';

export interface RateLimitHit {
  /** 当前窗口内已用次数（含当前请求）。 */
  count: number;
  /** 窗口重置的 epoch ms。 */
  resetAt: number;
}

export interface RateLimitStore {
  /** 原子地把 key 计数 +1，并返回当前 count + resetAt。 */
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /** 仅查询，不递增（用于响应头里的 remaining 计算；可选实现）。 */
  peek?(key: string): Promise<RateLimitHit | null>;
}

// =========================================================================
// 内存实现
// =========================================================================

interface MemBucket {
  count: number;
  resetAt: number;
  lastTouchedAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, MemBucket>();
  private readonly pruneAt: number;

  constructor(opts: { pruneAt?: number } = {}) {
    this.pruneAt = opts.pruneAt ?? 10_000;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    if (this.buckets.size > this.pruneAt) this.prune(now, windowMs);

    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs, lastTouchedAt: now };
      this.buckets.set(key, b);
    }
    b.count += 1;
    b.lastTouchedAt = now;
    return { count: b.count, resetAt: b.resetAt };
  }

  async peek(key: string): Promise<RateLimitHit | null> {
    const b = this.buckets.get(key);
    if (!b) return null;
    if (Date.now() >= b.resetAt) return null;
    return { count: b.count, resetAt: b.resetAt };
  }

  private prune(now: number, windowMs: number): void {
    let removed = 0;
    for (const [k, v] of this.buckets) {
      if (now >= v.resetAt && now - v.lastTouchedAt > windowMs) {
        this.buckets.delete(k);
        removed += 1;
      }
    }
    // 仍超过阈值 → 按最近活跃度强制裁掉一半
    if (this.buckets.size > this.pruneAt) {
      const sorted = [...this.buckets.entries()].sort(
        (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt,
      );
      const drop = Math.floor(sorted.length / 2);
      for (let i = 0; i < drop; i++) this.buckets.delete(sorted[i]![0]);
      removed += drop;
    }
    if (removed > 0) {
       
      console.log(`[rate-limit:mem] pruned ${removed}, size=${this.buckets.size}`);
    }
  }

  /** 仅测试用：清空状态。 */
  _reset(): void {
    this.buckets.clear();
  }
}

// =========================================================================
// Redis 实现
// =========================================================================

interface MinimalRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  pttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
}

const HIT_LUA = `
local k = KEYS[1]
local windowMs = tonumber(ARGV[1])
local count = redis.call('INCR', k)
if count == 1 then
  redis.call('PEXPIRE', k, windowMs)
end
local pttl = redis.call('PTTL', k)
if pttl < 0 then
  -- 没设过期或已过期：兜底再设一次（避免 key 永久存留）
  redis.call('PEXPIRE', k, windowMs)
  pttl = windowMs
end
return { count, pttl }
`;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  constructor(
    private readonly client: MinimalRedis,
    private readonly keyPrefix: string,
  ) {}

  private k(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const k = this.k(key);
    const r = (await this.client.eval(HIT_LUA, 1, k, windowMs)) as [number, number];
    const count = Number(r[0]);
    const pttl = Number(r[1]);
    return { count, resetAt: Date.now() + Math.max(0, pttl) };
  }

  async peek(key: string): Promise<RateLimitHit | null> {
    const k = this.k(key);
    const v = await this.client.get(k);
    if (v == null) return null;
    const pttl = await this.client.pttl(k);
    if (pttl < 0) return null;
    return { count: Number(v), resetAt: Date.now() + pttl };
  }
}

// =========================================================================
// 工厂 + 单例
// =========================================================================

let cachedClient: MinimalRedis | null | 'unavailable' = null;

async function getRedisClient(): Promise<MinimalRedis | null> {
  if (cachedClient === 'unavailable') return null;
  if (cachedClient) return cachedClient;
  const url = process.env['REDIS_URL'];
  if (!url) {
    cachedClient = 'unavailable';
    return null;
  }
  try {
    // 动态 import：未安装 ioredis 也不会让进程无法起来
    // 用 Function('return import(...)') 绕开 TS 模块解析，避免编译期硬依赖。
    const dyn = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
    const mod = (await dyn('ioredis').catch(() => null)) as
      | { default: new (url: string) => MinimalRedis }
      | { Redis: new (url: string) => MinimalRedis }
      | null;
    if (!mod) {
       
      console.warn(
        '[rate-limit] REDIS_URL set but ioredis not installed; falling back to in-memory store',
      );
      cachedClient = 'unavailable';
      return null;
    }
    const Ctor =
      (mod as { default?: new (url: string) => MinimalRedis }).default ??
      (mod as { Redis?: new (url: string) => MinimalRedis }).Redis;
    if (!Ctor) {
      cachedClient = 'unavailable';
      return null;
    }
    cachedClient = new Ctor(url);
    return cachedClient;
  } catch (err) {
     
    console.warn(`[rate-limit] redis init failed: ${(err as Error).message}; using memory`);
    cachedClient = 'unavailable';
    return null;
  }
}

/**
 * 工厂：按 prefix 创建 store。
 *  - 进程内同 prefix 共享同一个 store（多个 middleware 之间共享统计）；
 *  - 首次调用会异步初始化 Redis；初始化期间命中的请求走 memory（grace fallback）。
 *
 * 注：返回的是同步可用的 store；它内部异步把 redis client wired up。
 * 这避免了在 Nest middleware 第一次调用时需要 await 工厂。
 */
const STORES = new Map<string, RateLimitStore>();

export function createRateLimitStore(prefix: string): RateLimitStore {
  const cached = STORES.get(prefix);
  if (cached) return cached;

  const memory = new MemoryRateLimitStore();
  let active: RateLimitStore = memory;
  let lastRedisErrorLogAt = 0;

  // 异步切换：拿到 redis client 后把 active 指过去
  void getRedisClient().then((client) => {
    if (client) {
      // 顶层命名空间从 env 读，默认 'kintsugi:rl'。多个 server 共享同一台 Redis 时
      // 务必给每个部署设置不冲突的 namespace（例如带短随机 tag），避免限流计数串桶。
      const ns = process.env['REDIS_KEY_NAMESPACE'] ?? 'kintsugi:rl';
      active = new RedisRateLimitStore(client, `${ns}:${prefix}`);

      console.log(`[rate-limit] using Redis backend ns=${ns} prefix=${prefix}`);
    }
  });

  const proxy = makeFallbackProxy(() => active, memory, prefix, () => lastRedisErrorLogAt, (t) => { lastRedisErrorLogAt = t; });
  STORES.set(prefix, proxy);
  return proxy;
}

/**
 * 代理：每次 hit 用最新 active；Redis 中途挂掉时 fall back 到本进程 memory，
 * 避免 hit() 抛 → 500 给用户。进程内 memory 仍然限速，只是不再跨实例共享
 * （多副本时是 N 倍宽松，可接受）。日志去抖：同 prefix 60s 内只 warn 一次。
 *
 * 导出供测试构造一个可控 active 验证回退路径。
 */
export function makeFallbackProxy(
  getActive: () => RateLimitStore,
  memory: RateLimitStore,
  prefix: string,
  getLastLog: () => number,
  setLastLog: (t: number) => void,
): RateLimitStore {
  return {
    hit: async (k, w) => {
      const active = getActive();
      try {
        return await active.hit(k, w);
      } catch (err) {
        if (active === memory) throw err;
        const now = Date.now();
        if (now - getLastLog() > 60_000) {
          setLastLog(now);

          console.warn(
            `[rate-limit] redis hit failed (prefix=${prefix}): ${(err as Error).message}; falling back to memory for this prefix`,
          );
        }
        return memory.hit(k, w);
      }
    },
    peek: async (k) => {
      const active = getActive();
      try {
        return active.peek ? await active.peek(k) : null;
      } catch {
        return memory.peek ? memory.peek(k) : null;
      }
    },
  };
}

/** 测试用：重置工厂缓存。 */
export function _resetRateLimitStoresForTests(): void {
  STORES.clear();
  cachedClient = null;
}
