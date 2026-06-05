import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from './rbac.service';
import { PERMISSION_KEY } from './permission.decorator';
import { IS_PUBLIC_KEY } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';

interface ExpressReqLike {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string };
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/**
 * PermissionGuard —— 注册成 APP_GUARD（跑在 TenantGuard 之后）。
 *
 *   1. @Public 路由：放行
 *   2. 没 @Permission 装饰：放行（默认所有已认证用户能调）
 *   3. 有 @Permission：
 *      a. Access key 路径 → 默认放行（access key 持有者隐含信任，受 TenantGuard 限定 appCode）
 *      b. JWT user 路径 → 拼成 `<appCode>:resource:action` 查 RbacService.userHasPermission，
 *         必须**全部** key 都通过才放行（多 key 是 AND 语义）
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getHandler()) ||
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getClass());
    if (isPublic) return true;

    // method-level 优先于 class-level
    const required =
      this.reflector.get<string[]>(PERMISSION_KEY, ctx.getHandler()) ??
      this.reflector.get<string[]>(PERMISSION_KEY, ctx.getClass());
    if (!required || required.length === 0) return true; // 默认放行

    const req = ctx.switchToHttp().getRequest<ExpressReqLike>();

    // Access key 路径：放行（受 TenantGuard 限定）
    if (req.accessKeyCtx) return true;

    if (!req.user) {
      throw new ForbiddenException('permission required but not authenticated');
    }
    const appCode = pickAppCode(req) ?? '*';
    for (const k of required) {
      const fullKey = `${appCode}:${k}`;
      const ok = await this.rbac.userHasPermission(req.user.sub, fullKey);
      if (!ok) {
        throw new ForbiddenException(
          `missing permission: ${fullKey} (user.roles must include this grant or wildcard)`,
        );
      }
    }
    return true;
  }
}

function pickAppCode(req: ExpressReqLike): string | null {
  const fromParams = req.params?.['appCode'];
  if (typeof fromParams === 'string' && fromParams) return fromParams;
  const fromQuery = req.query?.['appCode'];
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  const fromBody = req.body?.['appCode'];
  if (typeof fromBody === 'string' && fromBody) return fromBody;
  return null;
}
