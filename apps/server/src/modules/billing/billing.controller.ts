import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BillingService } from './billing.service';
import { Public } from '../auth/auth.guard';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
}

class RequestUpgradeDto {
  @IsString() @MinLength(2) @MaxLength(64) requestedPlanCode!: string;
  @IsInt() @Min(1) requestedDurationMonths!: number;
  @IsString() @MinLength(2) @MaxLength(64) contactName!: string;
  @IsEmail() @MaxLength(128) contactEmail!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

class RejectUpgradeDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class ApproveUpgradeDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class SetAutoRenewDto {
  @IsString() autoRenew!: 'on' | 'off'; // 字符串比 boolean 在 form / cli 里容错强
}

/**
 * Billing 端点分两层：
 *   - /api/billing/*       — 登录用户自己看 / 操作（需要 JWT）
 *   - /api/admin/upgrade-requests/* — 平台 admin 审批（需要 admin:read/write）
 *
 * /billing/plans 是公共信息，给未登录的官网 / 落地页直接调；其余都需要登录。
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  /** 公共：套餐列表，落地页 / 未登录用户也能看到价格 / 配额。 */
  @Public()
  @Get('plans')
  listPlans() {
    return { data: this.svc.listPlans() };
  }

  /** 当前订阅状态（登录用户）。 */
  @Get('me')
  async me(@Req() req: ReqWithUser) {
    const tenantCode = req.user?.tenantCode;
    if (!tenantCode) throw new ForbiddenException('subscription requires authenticated user');
    return this.svc.getCurrentSubscription(tenantCode);
  }

  /** 用户提单升级 / 续费。 */
  @Post('upgrade-request')
  async requestUpgrade(@Req() req: ReqWithUser, @Body() body: RequestUpgradeDto) {
    const tenantCode = req.user?.tenantCode;
    if (!tenantCode) throw new ForbiddenException('upgrade requires authenticated user');
    return this.svc.requestUpgrade({ ...body, tenantCode });
  }

  /** 切自动续费开关。 */
  @Post('auto-renew')
  async setAutoRenew(@Req() req: ReqWithUser, @Body() body: SetAutoRenewDto) {
    const tenantCode = req.user?.tenantCode;
    if (!tenantCode) throw new ForbiddenException('auto-renew requires authenticated user');
    return this.svc.setAutoRenew(tenantCode, body.autoRenew === 'on');
  }
}

@Controller('admin/upgrade-requests')
export class AdminUpgradeRequestsController {
  constructor(private readonly svc: BillingService) {}

  @Permission('admin:read')
  @Get()
  list(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listAdminPending({
      ...(status ? { status } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  @Permission('admin:write')
  @Post(':id/approve')
  approve(@Req() req: ReqWithUser, @Param('id') id: string, @Body() body: ApproveUpgradeDto) {
    const reviewerUserId = req.user?.sub;
    if (!reviewerUserId) {
      throw new ForbiddenException('approve requires authenticated user');
    }
    return this.svc.approveUpgrade(id, { reviewerUserId, reviewNote: body.note });
  }

  @Permission('admin:write')
  @Post(':id/reject')
  reject(@Req() req: ReqWithUser, @Param('id') id: string, @Body() body: RejectUpgradeDto) {
    const reviewerUserId = req.user?.sub;
    if (!reviewerUserId) {
      throw new ForbiddenException('reject requires authenticated user');
    }
    return this.svc.rejectUpgrade(id, reviewerUserId, body.note);
  }
}
