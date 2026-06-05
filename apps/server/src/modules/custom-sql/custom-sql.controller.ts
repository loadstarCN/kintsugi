import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { CustomSqlService, type CustomSqlPublic } from './custom-sql.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: {
    appCode: string;
    tenantCode: string;
    createdBy: string | null;
    boundUserId: string | null;
  };
}

/** JWT → user.tenantCode；HMAC → accessKeyCtx.tenantCode；都没有 → null（公开端点用） */
function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

/**
 * actor 由 server 端从 auth 上下文派生，**不接受 body 携带**：
 *  - JWT 路径（控制台真人）→ 'human'
 *  - accessKey 路径（程序化）→ 'ai'（更严格 —— BLOCKED_BY_AI / readonly tx 兜底）
 *
 * 之前 `body.actor ?? 'human'` 让任意调用方可冒充 human 绕过 BLOCKED_BY_AI / critical 闸。
 */
function actorOf(req: ReqWithUser): 'human' | 'ai' {
  return req.user ? 'human' : 'ai';
}

class SaveSqlDto {
  @IsString() appCode!: string;
  @IsString() dataSourceId!: string;
  @IsString() sqlName!: string;
  @IsString() content!: string;
  @IsOptional() paramsSchema?: unknown;
  @IsOptional() @IsString() submitter?: string;
}

class UpdateSqlDto {
  @IsOptional() @IsString() sqlName?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() paramsSchema?: unknown;
  @IsOptional() @IsString() submitter?: string;
}

class ExecSqlDto {
  @IsOptional() params?: Record<string, unknown>;
  @IsOptional() sqlSafe?: boolean;
  // 不再接受 body.actor —— 见上方 actorOf()
}

class ValidateSqlDto {
  @IsString() content!: string;
}

@Controller('sql')
export class CustomSqlController {
  constructor(private readonly svc: CustomSqlService) {}

  @Get()
  list(
    @Req() req: ReqWithUser,
    @Query('appCode') appCode: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
  ) {
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

  @Get(':sqlCode')
  get(@Req() req: ReqWithUser, @Param('sqlCode') sqlCode: string): Promise<CustomSqlPublic> {
    return this.svc.get(sqlCode, tenantOf(req));
  }

  @Permission('sql:write')
  @Post()
  save(@Req() req: ReqWithUser, @Body() body: SaveSqlDto) {
    return this.svc.save(
      {
        appCode: body.appCode,
        dataSourceId: body.dataSourceId,
        sqlName: body.sqlName,
        content: body.content,
        ...(body.paramsSchema !== undefined ? { paramsSchema: body.paramsSchema } : {}),
        ...(body.submitter !== undefined ? { submitter: body.submitter } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('sql:write')
  @Patch(':sqlCode')
  update(@Req() req: ReqWithUser, @Param('sqlCode') sqlCode: string, @Body() body: UpdateSqlDto) {
    return this.svc.update(
      sqlCode,
      {
        ...(body.sqlName !== undefined ? { sqlName: body.sqlName } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.paramsSchema !== undefined ? { paramsSchema: body.paramsSchema } : {}),
        ...(body.submitter !== undefined ? { submitter: body.submitter } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('sql:write')
  @Delete(':sqlCode')
  async remove(@Param('sqlCode') _sqlCode: string) {
    // soft delete not modeled on CustomSql; keep stub for API symmetry
    return { ok: true };
  }

  @Post('validate')
  validate(@Body() body: ValidateSqlDto) {
    return this.svc.validate(body.content);
  }

  @Permission('sql:exec')
  @Post(':sqlCode/execute')
  execute(@Req() req: ReqWithUser, @Param('sqlCode') sqlCode: string, @Body() body: ExecSqlDto) {
    return this.svc.execute(sqlCode, body.params ?? {}, {
      actor: actorOf(req),
      sqlSafe: body.sqlSafe ?? false,
      tenantCode: tenantOf(req),
      userId: req.user?.sub ?? req.accessKeyCtx?.boundUserId ?? null,
    });
  }
}
