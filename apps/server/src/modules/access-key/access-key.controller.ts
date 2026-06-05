import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccessKeyService } from './access-key.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class CreateKeyDto {
  @IsString() appCode!: string;
  @IsOptional() @IsString() createdBy?: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) expiresInDays?: number;
  /** 把 key 绑给具体 user；HMAC 路径会注入 kintsugi.user_id GUC 让 scope=self 生效。 */
  @IsOptional() @IsString() boundUserId?: string;
}

@Controller('access-keys')
export class AccessKeyController {
  constructor(private readonly svc: AccessKeyService) {}

  @Permission('accessKey:write')
  @Post()
  create(@Req() req: ReqWithUser, @Body() body: CreateKeyDto) {
    return this.svc.create(
      {
        appCode: body.appCode,
        ...(body.createdBy !== undefined ? { createdBy: body.createdBy } : {}),
        ...(body.expiresInDays !== undefined ? { expiresInDays: body.expiresInDays } : {}),
        ...(body.boundUserId !== undefined ? { boundUserId: body.boundUserId } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('accessKey:read')
  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('appCode') appCode: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list(
      appCode,
      {
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('accessKey:write')
  @Delete(':accessKey')
  revoke(@Req() req: ReqWithUser, @Param('accessKey') accessKey: string) {
    return this.svc.revoke(accessKey, tenantOf(req));
  }

  /**
   * 旋转 secret。客户端必须在 graceMinutes 之内切到 newSecretKey。
   *
   * 默认 60 分钟（env ACCESS_KEY_ROTATE_GRACE_DEFAULT_MIN 调）。
   * 上限默认 240 分钟（env ACCESS_KEY_ROTATE_GRACE_MAX_MIN 调）——
   * 旧 audit 默认上限 1440 (24h) 太宽松：被偷的旧 secret 一天才失效。
   */
  @Permission('accessKey:write')
  @Post(':accessKey/rotate')
  rotate(
    @Req() req: ReqWithUser,
    @Param('accessKey') accessKey: string,
    @Query('graceMinutes') graceMinutes?: string,
  ) {
    const def = Number(process.env['ACCESS_KEY_ROTATE_GRACE_DEFAULT_MIN'] ?? '60');
    const max = Number(process.env['ACCESS_KEY_ROTATE_GRACE_MAX_MIN'] ?? '240');
    const grace = graceMinutes ? Math.min(max, Math.max(10, Number(graceMinutes))) : def;
    return this.svc.rotate(accessKey, tenantOf(req), grace);
  }
}
