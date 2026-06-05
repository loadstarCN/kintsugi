import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { createRateLimitStore, type RateLimitStore } from './rate-limit-store';
import { rateLimitHitCounter } from './metrics';

const WINDOW_MS = 60_000;

/**
 * 通用 IP 节流模板：按 IP 每分钟最多 N 次。比通用 RateLimitMiddleware 严格。
 *
 * key 前缀区分场景（login / access-key 创建 等）。Store 按场景隔离前缀；
 * REDIS_URL 设置后自动跨实例共享。
 *
 * IP 来源：trust proxy 已配（main.ts），优先 req.ip；fallback socket.remoteAddress。
 */
abstract class AbstractIpThrottleMiddleware implements NestMiddleware {
  protected abstract readonly keyPrefix: string;
  protected abstract readonly maxPerWindow: number;
  protected abstract readonly errorMessage: string;
  private _store: RateLimitStore | null = null;

  private get store(): RateLimitStore {
    // lazy：保证子类的 keyPrefix 已就位
    if (!this._store) this._store = createRateLimitStore(this.keyPrefix);
    return this._store;
  }

  async use(
    req: {
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
    },
    res: { setHeader(k: string, v: string | number): void },
    next: () => void,
  ): Promise<void> {
    const ip = ipOf(req);
    const r = await this.store.hit(ip, WINDOW_MS);
    if (r.count > this.maxPerWindow) {
      rateLimitHitCounter.add(1, { scope: this.keyPrefix, key_kind: 'ip' });
      res.setHeader('Retry-After', Math.ceil((r.resetAt - Date.now()) / 1000));
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `${this.errorMessage}; max ${this.maxPerWindow}/min`,
          resetAt: r.resetAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    next();
  }
}

/** 登录暴破节流：默认 5/min。 */
@Injectable()
export class LoginThrottleMiddleware extends AbstractIpThrottleMiddleware {
  protected readonly keyPrefix = 'login';
  protected readonly maxPerWindow = Number(process.env['LOGIN_RATE_LIMIT_PER_MIN'] ?? 5);
  protected readonly errorMessage = 'too many login attempts';
}

/** Access key 创建节流：默认 10/min。频繁创建说明被滥用，且每条都要落库 + 加密。 */
@Injectable()
export class AccessKeyCreateThrottleMiddleware extends AbstractIpThrottleMiddleware {
  protected readonly keyPrefix = 'akcreate';
  protected readonly maxPerWindow = Number(process.env['ACCESS_KEY_CREATE_RATE_PER_MIN'] ?? 10);
  protected readonly errorMessage = 'too many access-key creations';
}

/** 试用申请节流：默认 3/min。/api/trial/apply 公开 endpoint，防机器人填表填爆 RDS。
 *  正常人填错重试不会卡（partial unique 还会 dedup 同 email），3/min 留足用户改字段重试。 */
@Injectable()
export class TrialApplyThrottleMiddleware extends AbstractIpThrottleMiddleware {
  protected readonly keyPrefix = 'trialapply';
  protected readonly maxPerWindow = Number(process.env['TRIAL_APPLY_RATE_PER_MIN'] ?? 3);
  protected readonly errorMessage = 'too many trial applications from this IP';
}

/** Express 在 main.ts 配了 trust proxy 后用 req.ip；否则 fallback socket.remoteAddress。 */
function ipOf(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
