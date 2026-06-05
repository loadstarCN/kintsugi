import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { createRateLimitStore, type RateLimitStore } from './rate-limit-store';
import { rateLimitHitCounter } from './metrics';

const LIMITS_BY_WINDOW = {
  minute: { max: Number(process.env['RATE_LIMIT_PER_MIN'] ?? 600), windowMs: 60_000 },
  hour: { max: Number(process.env['RATE_LIMIT_PER_HOUR'] ?? 10_000), windowMs: 3_600_000 },
  day: { max: Number(process.env['RATE_LIMIT_PER_DAY'] ?? 100_000), windowMs: 86_400_000 },
};

/**
 * 三档窗口（每分钟/每小时/每天）。
 * 默认走内存存储（单进程）；REDIS_URL 设置后自动切到 Redis 共享计数。
 *
 * Key 优先 appCode（path/query；body 不可信不参与），其次 IP。
 *
 * IP 来源：trust proxy 时取 X-Forwarded-For 首段，否则 socket.remoteAddress。
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly store: RateLimitStore = createRateLimitStore('global');

  async use(
    req: {
      ip?: string;
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
    },
    res: { setHeader(k: string, v: string | number): void },
    next: () => void,
  ): Promise<void> {
    const { key: baseKey, kind: keyKind } = this.keyFor(req);
    let lastMinute: { count: number; resetAt: number } | null = null;

    for (const w of ['minute', 'hour', 'day'] as const) {
      const conf = LIMITS_BY_WINDOW[w];
      const r = await this.store.hit(`${w}:${baseKey}`, conf.windowMs);
      if (w === 'minute') lastMinute = r;
      if (r.count > conf.max) {
        rateLimitHitCounter.add(1, { scope: w, key_kind: keyKind });
        res.setHeader('X-RateLimit-Scope', w);
        res.setHeader('X-RateLimit-Limit', conf.max);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('Retry-After', Math.ceil((r.resetAt - Date.now()) / 1000));
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: `rate limit hit (${w}): ${conf.max}/${w}`,
            resetAt: r.resetAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    if (lastMinute) {
      res.setHeader(
        'X-RateLimit-Remaining',
        Math.max(0, LIMITS_BY_WINDOW.minute.max - lastMinute.count),
      );
    }
    next();
  }

  private keyFor(req: {
    ip?: string;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    socket?: { remoteAddress?: string };
  }): { key: string; kind: 'app' | 'ip' } {
    // body 里的 appCode 攻击者可任意填，不参与限速 key。
    const appCode =
      req.params?.['appCode'] ??
      (typeof req.query?.['appCode'] === 'string' ? (req.query['appCode'] as string) : undefined);
    if (appCode) return { key: `app:${appCode}`, kind: 'app' };
    return { key: `ip:${ipOf(req)}`, kind: 'ip' };
  }
}

function ipOf(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
