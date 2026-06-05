import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { PagedResult } from '@kintsugi/shared';
import { DataSourceService, type DataSourcePublic } from './datasource.service';
import { CreateDataSourceDto, UpdateDataSourceDto } from './dto';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

/** 拿当前请求的 tenantCode：JWT → user.tenantCode；HMAC → accessKeyCtx.tenantCode。 */
function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

@Controller('datasources')
export class DataSourceController {
  constructor(private readonly svc: DataSourceService) {}

  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('appCode') appCode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<PagedResult<DataSourcePublic>> {
    return this.svc.list(
      { ...(appCode ? { appCode } : {}), tenantCode: tenantOf(req) },
      {
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
      },
    );
  }

  @Get(':id')
  get(@Req() req: ReqWithUser, @Param('id') id: string): Promise<DataSourcePublic> {
    return this.svc.get(id, tenantOf(req));
  }

  @Permission('datasource:write')
  @Post()
  create(
    @Req() req: ReqWithUser,
    @Body() dto: CreateDataSourceDto,
  ): Promise<DataSourcePublic> {
    return this.svc.create(dto, tenantOf(req));
  }

  @Permission('datasource:write')
  @Patch(':id')
  update(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateDataSourceDto,
  ): Promise<DataSourcePublic> {
    return this.svc.update(id, dto, tenantOf(req));
  }

  @Permission('datasource:write')
  @Delete(':id')
  @HttpCode(200)
  remove(@Req() req: ReqWithUser, @Param('id') id: string): Promise<{ ok: true }> {
    return this.svc.remove(id, tenantOf(req));
  }

  @Permission('datasource:write')
  @Post(':id/test')
  test(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    return this.svc.testConnection(id, tenantOf(req));
  }
}
