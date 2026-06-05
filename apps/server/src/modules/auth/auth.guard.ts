import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type JwtPayload } from './auth.service';

export const IS_PUBLIC_KEY = 'kintsugi:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

interface ExpressReqLike {
  cookies?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
  user?: JwtPayload;
}

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic =
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getHandler()) ||
      this.reflector.get<boolean>(IS_PUBLIC_KEY, ctx.getClass());
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<ExpressReqLike>();
    const cookie = req.cookies?.['kintsugi_session'];
    const bearer = req.headers?.['authorization'];
    const token = cookie ?? (typeof bearer === 'string' && bearer.startsWith('Bearer ') ? bearer.slice(7) : null);
    if (!token) throw new UnauthorizedException('missing token');
    try {
      // verifyAndCheckRevocation 会验签 + 查 JwtRevocation 表，logout 后旧 token 立刻无效。
      // 之前用同步 verify() 跳过撤销表是 H2 漏洞；现在多一次 PK index lookup（已加索引）。
      req.user = await this.auth.verifyAndCheckRevocation(token);
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }
}
