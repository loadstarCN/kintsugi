import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { PagedResult } from '@kintsugi/shared';
import { ApplicationService, type ApplicationSummary } from './application.service';
import type { JwtPayload } from '../auth/auth.service';
import { Permission } from '../rbac/permission.decorator';

class CreateApplicationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'appCode 只能含字母/数字/_-' })
  appCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(['production', 'daily', 'development'])
  environment?: 'production' | 'daily' | 'development';
}

interface ReqWithUser {
  user?: JwtPayload;
}

@Controller('applications')
export class ApplicationController {
  constructor(private readonly svc: ApplicationService) {}

  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('tenantCode') tenantCode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PagedResult<ApplicationSummary>> {
    // 已登录请求：强制按自己的 tenantCode 过滤；忽略 query 里的 tenantCode（防越权列出别 tenant）
    const effectiveTenant = req.user?.tenantCode ?? tenantCode;
    return this.svc.list(effectiveTenant, {
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  @Get(':appCode')
  get(@Param('appCode') appCode: string): Promise<ApplicationSummary> {
    // TenantGuard 已经保证 :appCode 属于 user.tenantCode（HMAC 路径匹 ctx.appCode）
    return this.svc.get(appCode);
  }

  @Permission('application:write')
  @Post()
  create(
    @Req() req: ReqWithUser,
    @Body() dto: CreateApplicationDto,
  ): Promise<ApplicationSummary> {
    // tenantCode 强制从 JWT 取，body 没有这个字段 —— 防止跨租户创建
    const tenantCode = req.user?.tenantCode;
    if (!tenantCode) {
      throw new ForbiddenException('application creation requires authenticated user');
    }
    return this.svc.create({
      tenantCode,
      appCode: dto.appCode,
      name: dto.name,
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.environment !== undefined ? { environment: dto.environment } : {}),
    });
  }
}
