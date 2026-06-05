import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import type { PagedResult } from '@kintsugi/shared';
import { DatasetService, type DatasetSummary } from './dataset.service';
import type { DoJson } from './do';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class IngestFromScanBody {
  @IsString()
  appCode!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  include?: string[];
}

class UpdateDoBody {
  // 客户端透传整个 DO JSON；结构校验在 service 层做，这里先确保是对象。
  @IsObject()
  doJson!: Record<string, unknown>;

  /**
   * 乐观锁：客户端记下 GET 时拿到的 version 一并回传。
   * 服务端会做 conditional update —— 别人改过了就抛 BLOCKED_BY_CONCURRENT_EDIT。
   * 老客户端不传该字段时回退到不安全的"静默覆盖"路径（service 端会 warn 一条）。
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

@Controller('datasets')
export class DatasetController {
  constructor(private readonly svc: DatasetService) {}

  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('appCode') appCode: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ): Promise<PagedResult<DatasetSummary>> {
    return this.svc.list(
      appCode,
      {
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
        ...(keyword ? { keyword } : {}),
      },
      tenantOf(req),
    );
  }

  @Get(':datasetCode')
  get(@Req() req: ReqWithUser, @Param('datasetCode') datasetCode: string) {
    return this.svc.get(datasetCode, tenantOf(req));
  }

  /**
   * 输出 PG RLS policy SQL（建议态，不替用户执行 DDL）。
   * 仅 dataset.dataSource.dialect = postgres 才有意义。
   */
  @Permission('dataset:read')
  @Get(':datasetCode/rls-policy')
  rlsPolicy(@Req() req: ReqWithUser, @Param('datasetCode') datasetCode: string) {
    return this.svc.getRlsPolicy(datasetCode, tenantOf(req));
  }

  @Permission('dataset:write')
  @Patch(':datasetCode/do')
  updateDo(
    @Req() req: ReqWithUser,
    @Param('datasetCode') datasetCode: string,
    @Body() body: UpdateDoBody,
  ) {
    return this.svc.updateDoJson(
      datasetCode,
      body.doJson as unknown as DoJson,
      undefined,
      tenantOf(req),
      body.expectedVersion,
    );
  }

  @Permission('dataset:write')
  @Delete(':datasetCode')
  remove(@Req() req: ReqWithUser, @Param('datasetCode') datasetCode: string) {
    return this.svc.softDelete(datasetCode, tenantOf(req));
  }

  @Permission('dataset:write')
  @Post('from-scan/:jobId')
  ingestFromScan(
    @Req() req: ReqWithUser,
    @Param('jobId') jobId: string,
    @Body() body: IngestFromScanBody,
  ) {
    return this.svc.ingestFromScan(
      { jobId, appCode: body.appCode, ...(body.include ? { include: body.include } : {}) },
      tenantOf(req),
    );
  }
}
