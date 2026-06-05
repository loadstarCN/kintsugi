import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService, type JwtPayload } from './auth.service';
import { Public } from './auth.guard';

class RegisterDto {
  @IsString()
  tenantCode!: string;

  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(12, { message: 'password must be at least 12 chars' })
  password!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  department?: string;
}

class LoginDto {
  @IsString()
  tenantCode!: string;

  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

interface ExpressReqLike {
  cookies?: Record<string, string>;
  headers?: Record<string, string | string[] | undefined>;
}

interface ExpressResLike {
  cookie(name: string, val: string, opts?: Record<string, unknown>): ExpressResLike;
  clearCookie(name: string, opts?: Record<string, unknown>): ExpressResLike;
}

const COOKIE_NAME = 'kintsugi_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** 统一 set-cookie 选项；生产强制 secure（HTTPS-only） */
function sessionCookieOpts(): Record<string, unknown> {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    secure: process.env['NODE_ENV'] === 'production',
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly svc: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: ExpressResLike) {
    const r = await this.svc.register(body);
    res.cookie(COOKIE_NAME, r.token, sessionCookieOpts());
    return { id: r.id, token: r.token };
  }

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: ExpressResLike) {
    const r = await this.svc.login(body);
    res.cookie(COOKIE_NAME, r.token, sessionCookieOpts());
    return r;
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: ExpressReqLike, @Res({ passthrough: true }) res: ExpressResLike) {
    // 把当前 token 的 jti 写入撤销名单 —— 即使被截获也立即作废，不再等 7 天过期。
    const token = extractToken(req);
    if (token) {
      await this.svc.revokeToken(token);
    }
    // clear 时 secure/sameSite 也要带上，否则浏览器认为是不同 cookie 不会清
    res.clearCookie(COOKIE_NAME, {
      path: '/',
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: ExpressReqLike) {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('no token');
    let payload: JwtPayload;
    try {
      payload = this.svc.verify(token);
    } catch {
      throw new UnauthorizedException('invalid token');
    }
    return this.svc.me(payload.sub);
  }
}

function extractToken(req: ExpressReqLike): string | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (cookie) return cookie;
  const auth = req.headers?.['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}
