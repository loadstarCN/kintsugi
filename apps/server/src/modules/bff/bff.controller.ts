import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { BffService, type BffScriptType } from './bff.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class SaveBffDto {
  @IsString() appCode!: string;
  @IsString() scriptName!: string;
  @IsIn(['BEFORE_HOOK', 'AFTER_HOOK', 'ENDPOINT', 'PUBLIC_FUNCTION'])
  type!: BffScriptType;
  @IsOptional() @IsString() boundDataset?: string;
  @IsString() code!: string;
  @IsOptional() @IsString() submitter?: string;
}

class ExecuteDto {
  @IsOptional() payload?: unknown;
}

@Controller('bff')
export class BffController {
  constructor(private readonly svc: BffService) {}

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

  @Get(':id/code')
  getCode(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.getCode(id, tenantOf(req));
  }

  @Permission('bff:write')
  @Post()
  save(@Req() req: ReqWithUser, @Body() body: SaveBffDto) {
    return this.svc.save(
      {
        appCode: body.appCode,
        scriptName: body.scriptName,
        type: body.type,
        code: body.code,
        ...(body.boundDataset !== undefined ? { boundDataset: body.boundDataset } : {}),
        ...(body.submitter !== undefined ? { submitter: body.submitter } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('bff:write')
  @Delete(':id')
  remove(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.delete(id, tenantOf(req));
  }

  @Permission('bff:exec')
  @Post('exec/:appCode/:scriptName')
  execute(
    @Param('appCode') appCode: string,
    @Param('scriptName') scriptName: string,
    @Body() body: ExecuteDto,
  ) {
    // :appCode 在 URL 上 → TenantGuard 已校归属；这里不再二次包 tenantCode。
    return this.svc.executeEndpoint({
      appCode,
      scriptName,
      payload: body.payload,
      user: null,
    });
  }
}
