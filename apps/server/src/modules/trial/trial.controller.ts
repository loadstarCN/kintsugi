import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { TrialService } from './trial.service';
import { Public } from '../auth/auth.guard';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
}

class ApplyDto {
  @IsString() @MinLength(2) @MaxLength(64) contactName!: string;
  @IsEmail() @MaxLength(128) email!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(128) company?: string;
  @IsOptional() @IsString() @MaxLength(2000) useCase?: string;
}

class ApproveDto {
  @IsString() @MinLength(2) @MaxLength(32) tenantCode!: string;
  @IsString() @MinLength(2) @MaxLength(64) tenantName!: string;
  @IsString() @MinLength(2) @MaxLength(32) username!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class RejectDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@Controller('trial')
export class TrialController {
  constructor(private readonly svc: TrialService) {}

  /**
   * 公开提交：不需要认证。
   * 拒重复 PENDING；email 大小写归一化在 service 层。
   */
  @Public()
  @Post('apply')
  apply(@Body() body: ApplyDto): Promise<{ id: string }> {
    return this.svc.apply(body);
  }
}

@Controller('admin/trials')
export class TrialAdminController {
  constructor(private readonly svc: TrialService) {}

  @Permission('admin:read')
  @Get()
  list(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listPending({
      ...(status ? { status } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  @Permission('admin:write')
  @Post(':id/approve')
  approve(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Body() body: ApproveDto,
  ): Promise<{ tenantCode: string; userId: string }> {
    const reviewerUserId = req.user?.sub;
    if (!reviewerUserId) {
      throw new ForbiddenException('approve requires authenticated user');
    }
    return this.svc.approve(id, { ...body, reviewerUserId });
  }

  @Permission('admin:write')
  @Post(':id/reject')
  reject(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Body() body: RejectDto,
  ): Promise<{ ok: true }> {
    const reviewerUserId = req.user?.sub;
    if (!reviewerUserId) {
      throw new ForbiddenException('reject requires authenticated user');
    }
    return this.svc.reject(id, reviewerUserId, body.note);
  }
}
