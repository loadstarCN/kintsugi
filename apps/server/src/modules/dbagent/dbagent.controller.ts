import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DbAgentService } from './dbagent.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class ScanBody {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  sampleRowsPerTable?: number;
}

@Controller('dbagent')
export class DbAgentController {
  constructor(private readonly svc: DbAgentService) {}

  @Permission('datasource:write')
  @Post('datasources/:dataSourceId/scan')
  async scan(
    @Req() req: ReqWithUser,
    @Param('dataSourceId') dataSourceId: string,
    @Body() body: ScanBody,
  ): Promise<{ jobId: string }> {
    const opts: { sampleRowsPerTable?: number } = {};
    if (body.sampleRowsPerTable !== undefined) opts.sampleRowsPerTable = body.sampleRowsPerTable;
    const jobId = await this.svc.scan(dataSourceId, opts, tenantOf(req));
    return { jobId };
  }

  @Get('jobs/:jobId')
  getJob(@Req() req: ReqWithUser, @Param('jobId') jobId: string): Promise<unknown> {
    return this.svc.getJob(jobId, tenantOf(req));
  }

  @Permission('datasource:write')
  @Post('datasources/:dataSourceId/sync')
  sync(@Req() req: ReqWithUser, @Param('dataSourceId') dataSourceId: string) {
    return this.svc.sync(dataSourceId, tenantOf(req));
  }

  /** 拉 sync 差异 —— sync 已不阻塞，调用方先轮询 jobs/:jobId 到 succeeded，再来拿 diff。 */
  @Get('sync/diff')
  syncDiff(
    @Req() req: ReqWithUser,
    @Query('currentJobId') currentJobId: string,
    @Query('priorJobId') priorJobId?: string,
  ) {
    return this.svc.getSyncDiff(currentJobId, priorJobId ?? null, tenantOf(req));
  }

  @Get('datasources/:dataSourceId/jobs')
  listJobs(
    @Req() req: ReqWithUser,
    @Param('dataSourceId') dataSourceId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.listJobsForDataSource(
      dataSourceId,
      {
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
      },
      tenantOf(req),
    );
  }
}
