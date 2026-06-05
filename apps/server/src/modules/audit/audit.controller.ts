import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { AuditService } from './audit.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

interface ResLike {
  setHeader(k: string, v: string): void;
  write(chunk: string): boolean | void;
  end(): void;
}

/** JWT 或 HMAC 都派生 tenantCode；都没有才 null（@Public 路由用）。
 *  audit 的 whereOf 在 tenantCode=null 时不过滤——所以 HMAC 路径必须把 tenant 注入进来，
 *  否则 access-key 调用方能看到全租户的日志（leak）。 */
function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly svc: AuditService) {}

  @Permission('audit:read')
  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('appCode') appCode?: string,
    @Query('userId') userId?: string,
    @Query('accessKey') accessKey?: string,
    @Query('action') action?: string,
    @Query('traceparent') traceparent?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list(tenantOf(req), {
      ...(appCode ? { appCode } : {}),
      ...(userId ? { userId } : {}),
      ...(accessKey ? { accessKey } : {}),
      ...(action ? { action } : {}),
      ...(traceparent ? { traceparent } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(page ? { page: Number(page) } : {}),
      ...(pageSize ? { pageSize: Number(pageSize) } : {}),
    });
  }

  /**
   * 流式 CSV 导出。硬上限 50k 行（service 端兜底）；超过的请求需先窄化时间范围。
   * 不含 afterJson（payload 体大且可能含敏感数据；查询 GET 接口能拿到）。
   */
  @Permission('audit:read')
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  async exportCsv(
    @Req() req: ReqWithUser,
    @Res() res: ResLike,
    @Query('appCode') appCode?: string,
    @Query('userId') userId?: string,
    @Query('accessKey') accessKey?: string,
    @Query('action') action?: string,
    @Query('traceparent') traceparent?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const q = {
      ...(appCode ? { appCode } : {}),
      ...(userId ? { userId } : {}),
      ...(accessKey ? { accessKey } : {}),
      ...(action ? { action } : {}),
      ...(traceparent ? { traceparent } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
    for await (const line of this.svc.exportCsv(tenantOf(req), q)) {
      res.write(line);
    }
    res.end();
  }
}
