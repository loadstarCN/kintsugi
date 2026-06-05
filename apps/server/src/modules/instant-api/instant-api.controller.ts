import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { InstantApiService, type FilterRequest } from './instant-api.service';
import type { FilterOp } from './sql-builder';
import type { CtxUser } from './rls';
import type { JwtPayload } from '../auth/auth.service';
import { datasetCallCounter } from '../../common/metrics';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: {
    appCode: string;
    tenantCode: string;
    createdBy: string | null;
    boundUserId: string | null;
  };
}

/**
 * 派生 RLS 用的 CtxUser：
 *  - JWT 路径：完整 ctx（userId/tenantCode/roles），user-scope 规则生效
 *  - HMAC 路径：tenantCode 必给；如果 access key 绑定了具体 user（boundUserId），
 *    一并给 userId，让 scope=self 的 RLS 也对这条 key 生效
 *  - HMAC 未绑 user：只 tenant scope；user-scope policy 命中失败（按 RLS 默认拒）
 */
function userOf(req: ReqWithUser): CtxUser {
  if (req.user) {
    return {
      userId: req.user.sub,
      tenantCode: req.user.tenantCode,
      roles: req.user.roles ?? [],
    };
  }
  if (req.accessKeyCtx) {
    return {
      tenantCode: req.accessKeyCtx.tenantCode,
      ...(req.accessKeyCtx.boundUserId
        ? { userId: req.accessKeyCtx.boundUserId }
        : {}),
    };
  }
  return {};
}

function track(
  action: string,
  appCode: string,
  ctx: { tenantCode?: string },
): { tenant?: string; app: string; action: string } {
  return {
    ...(ctx.tenantCode ? { tenant: ctx.tenantCode } : {}),
    app: appCode,
    action,
  };
}

@Controller('apps/:appCode/ds/:datasetCode')
export class InstantApiController {
  constructor(private readonly svc: InstantApiService) {}

  @Post('filter')
  filter(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Body() body: FilterRequest,
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('filter', appCode, u));
    return this.svc.filter(appCode, datasetCode, body ?? {}, u);
  }

  @Get(':id')
  getOne(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Param('id') id: string,
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('getOne', appCode, u));
    return this.svc.getOne(appCode, datasetCode, id, u);
  }

  @Post()
  create(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Body() body: Record<string, unknown>,
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('create', appCode, u));
    return this.svc.create(appCode, datasetCode, body, u);
  }

  @Patch(':id')
  update(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('update', appCode, u));
    return this.svc.update(appCode, datasetCode, id, body, u);
  }

  @Delete(':id')
  remove(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Param('id') id: string,
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('remove', appCode, u));
    return this.svc.remove(appCode, datasetCode, id, u);
  }

  @Post('batchCreate')
  batchCreate(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Body() body: { rows: Array<Record<string, unknown>> },
  ) {
    const u = userOf(req);
    datasetCallCounter.add(1, track('batchCreate', appCode, u));
    return this.svc.batchCreate(appCode, datasetCode, body.rows ?? [], u);
  }

  @Post('aggregate')
  aggregate(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Body()
    body: {
      groupBy?: string[];
      metrics: Array<{
        op: 'count' | 'sum' | 'avg' | 'min' | 'max';
        field?: string;
        alias: string;
      }>;
      where?: Array<{ field: string; op: FilterOp; value?: unknown }>;
      limit?: number;
    },
  ) {
    return this.svc.aggregate(appCode, datasetCode, body, undefined, userOf(req));
  }

  @Get('options/:field')
  getSelectOptions(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Param('datasetCode') datasetCode: string,
    @Param('field') field: string,
    @Query() _q: Record<string, unknown>,
  ) {
    return this.svc.getSelectOptions(appCode, datasetCode, field, userOf(req));
  }
}
