import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../modules/auth/auth.guard';
import type { JwtPayload } from '../modules/auth/auth.service';

interface ExpressReqLike {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string };
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/**
 * TenantGuard —— 注册成 APP_GUARD 跑在 HmacOrJwtGuard 之后。
 *
 *   1. @Public 路由：放行
 *   2. JWT 用户：从请求里抽 appCode，查 application.tenantCode 必须等于 user.tenantCode
 *   3. AccessKey：HmacOrJwtGuard 已经验过签 + 绑定 ctx.appCode，这里只校验请求里的 appCode
 *      （如果有的话）跟 ctx.appCode 一致
 *   4. 路由不带 appCode（list 类）：放行；service 层应当用 user.tenantCode 过滤数据
 *
 * 此 Guard 只查"appCode → tenantCode"这条粗粒度边界。资源 id（dataSourceId / datasetCode 等）
 * 的 ownership 校验由 service 层负责。
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getHandler()) ||
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getClass());
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<ExpressReqLike>();
    const appCode = pickAppCode(req);
    if (!appCode) return true; // 没 appCode 的路由由 service 用 user.tenantCode 过滤

    if (req.accessKeyCtx) {
      if (req.accessKeyCtx.appCode !== appCode) {
        throw new ForbiddenException(
          `access key bound to ${req.accessKeyCtx.appCode}, request appCode is ${appCode}`,
        );
      }
      return true;
    }

    if (req.user) {
      const app = await this.prisma.application.findUnique({
        where: { appCode },
        select: { tenantCode: true },
      });
      // 不存在交给 service 层报 NOT_FOUND；guard 不应该返 403/404 模糊化
      if (!app) return true;
      if (app.tenantCode !== req.user.tenantCode) {
        throw new ForbiddenException('appCode does not belong to your tenant');
      }
      return true;
    }

    // 没 user 没 accessKeyCtx：HmacOrJwtGuard 应该先拦下；理论不会到这里
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
