import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type JwtPayload } from '../auth/auth.service';
import { AccessKeyService } from './access-key.service';
import { IS_PUBLIC_KEY } from '../auth/auth.guard';

interface ExpressReqLike {
  method: string;
  originalUrl?: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
  rawBody?: Buffer;
  body?: unknown;
  user?: JwtPayload;
  accessKeyCtx?: {
    appCode: string;
    accessKey: string;
    tenantCode: string;
    /** access key 的 createdBy（建 key 的 dev / 系统标识；非 end-user）。audit 用。 */
    createdBy: string | null;
    /** 可选：access key 显式绑定给某个 user。绑了 → HMAC 路径注入 kintsugi.user_id
     *  让 scope=self 的 RLS 生效；audit 也按这个 user 记录。null = 系统级 key。 */
    boundUserId: string | null;
  };
}

/**
 * OR 型认证 Guard：
 *  1. 路由 / 控制器标 @Public() → 直接放行
 *  2. 请求带 JWT cookie / Bearer → 走 AuthService.verify
 *  3. 否则需要带 X-Access-Key + X-Signature + X-Timestamp + X-Nonce，按 HMAC-SHA256 验签
 *
 * 适合作为 APP_GUARD 全局注册：默认所有路由都要认证；前后端共用 JWT，外部系统走 access key。
 */
@Injectable()
export class HmacOrJwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly ak: AccessKeyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getHandler()) ||
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getClass());
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<ExpressReqLike>();

    // 1. 先尝试 JWT / cookie，含 revocation 检查
    const cookie = req.cookies?.['kintsugi_session'];
    const bearer = req.headers['authorization'];
    const token = cookie ?? (typeof bearer === 'string' && bearer.startsWith('Bearer ') ? bearer.slice(7) : null);
    if (token) {
      try {
        req.user = await this.auth.verifyAndCheckRevocation(token);
        return true;
      } catch {
        // fall through to HMAC
      }
    }

    // 2. 再尝试 HMAC
    const accessKey = strHeader(req.headers['x-access-key']);
    const signature = strHeader(req.headers['x-signature']);
    const timestamp = strHeader(req.headers['x-timestamp']);
    const nonce = strHeader(req.headers['x-nonce']);
    if (accessKey && signature && timestamp && nonce) {
      const path = (req.originalUrl ?? req.url).split('?')[0] ?? req.url;
      const body = serializeBody(req.body);
      const ok = await this.ak.verifySignature({
        accessKey,
        signature,
        timestamp,
        nonce,
        method: req.method,
        path,
        body,
      });
      if (ok) {
        req.accessKeyCtx = {
          appCode: ok.appCode,
          accessKey,
          tenantCode: ok.tenantCode,
          createdBy: ok.createdBy,
          boundUserId: ok.boundUserId,
        };
        return true;
      }
    }

    throw new UnauthorizedException('missing or invalid credentials (need JWT cookie OR X-Access-Key/X-Signature)');
  }
}

function strHeader(v: string | string[] | undefined): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

/**
 * 序列化请求体用于签名校验。
 * 协议约定：null / undefined / 空对象 / 空字符串 → ''。
 * 这样 GET 请求（Express 给 `req.body = {}`）跟 SDK 端"未传 body"的 `''` 能对齐。
 */
function serializeBody(body: unknown): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && Object.keys(body as Record<string, unknown>).length === 0) return '';
  try {
    return JSON.stringify(body);
  } catch {
    return '';
  }
}
