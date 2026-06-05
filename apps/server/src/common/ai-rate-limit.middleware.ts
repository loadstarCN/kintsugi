import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { createRateLimitStore, type RateLimitStore } from './rate-limit-store';
import { rateLimitHitCounter } from './metrics';

/**
 * AI hot-path 严限流：只挂在烧 LLM token / 拉外部 DB 的端点。
 *
 *   - /api/chats/ask
 *   - /api/apps/:appCode/reports/ask
 *   - /api/apps/:appCode/pages/generate
 *   - /api/pages/:id/regenerate
 *   - /api/pages/:id/publish
 *   - /api/dbagent/datasources/:dataSourceId/scan
 *   - /api/dbagent/datasources/:dataSourceId/sync
 *   - /api/bridges/feishu/webhook
 *
 * 默认 10/min, 200/hour。可通过 AI_RATE_LIMIT_PER_MIN / AI_RATE_LIMIT_PER_HOUR 调。
 *
 * Key 优先 user.tenantCode（JWT 路径）→ appCode（params/query）→ IP。
 */
@Injectable()
export class AiRateLimitMiddleware implements NestMiddleware {
  private readonly store: RateLimitStore = createRateLimitStore('ai');
  private readonly limits = {
    minute: { max: Number(process.env['AI_RATE_LIMIT_PER_MIN'] ?? 10), windowMs: 60_000 },
    hour: { max: Number(process.env['AI_RATE_LIMIT_PER_HOUR'] ?? 200), windowMs: 3_600_000 },
  };

  async use(
    req: {
      ip?: string;
      user?: { tenantCode?: string };
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      socket?: { remoteAddress?: string };
    },
    res: { setHeader(k: string, v: string | number): void },
    next: () => void,
  ): Promise<void> {
    const { key: baseKey, kind: keyKind } = this.keyFor(req);
    let lastMinute: { count: number; resetAt: number } | null = null;

    for (const w of ['minute', 'hour'] as const) {
      const conf = this.limits[w];
      const r = await this.store.hit(`${w}:${baseKey}`, conf.windowMs);
      if (w === 'minute') lastMinute = r;
      if (r.count > conf.max) {
        rateLimitHitCounter.add(1, { scope: `ai-${w}`, key_kind: keyKind });
        res.setHeader('X-RateLimit-Scope', `ai-${w}`);
        res.setHeader('X-RateLimit-Limit', conf.max);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('Retry-After', Math.ceil((r.resetAt - Date.now()) / 1000));
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: `AI endpoint rate limit hit (${w}): ${conf.max}/${w}`,
            resetAt: r.resetAt,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    if (lastMinute) {
      res.setHeader(
        'X-AI-RateLimit-Remaining',
        Math.max(0, this.limits.minute.max - lastMinute.count),
      );
    }
    next();
  }

  private keyFor(req: {
    ip?: string;
    user?: { tenantCode?: string };
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    socket?: { remoteAddress?: string };
  }): { key: string; kind: 'tenant' | 'app' | 'ip' } {
    if (req.user?.tenantCode) return { key: `tenant:${req.user.tenantCode}`, kind: 'tenant' };
    const appCode =
      req.params?.['appCode'] ??
      (typeof req.query?.['appCode'] === 'string' ? (req.query['appCode'] as string) : undefined);
    if (appCode) return { key: `app:${appCode}`, kind: 'app' };
    return { key: `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`, kind: 'ip' };
  }
}
