import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { WebhookService } from './webhook.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null; boundUserId: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class CreateWebhookDto {
  @IsString() appCode!: string;
  @IsString() url!: string;
  @IsArray() @IsString({ each: true }) events!: string[];
  @IsOptional() @IsString() description?: string;
}

class ToggleDto {
  @IsBoolean() enabled!: boolean;
}

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly svc: WebhookService) {}

  @Permission('webhook:write')
  @Post()
  create(@Req() req: ReqWithUser, @Body() body: CreateWebhookDto) {
    return this.svc.create(
      {
        appCode: body.appCode,
        url: body.url,
        events: body.events,
        ...(body.description !== undefined ? { description: body.description } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('webhook:read')
  @Get()
  list(@Req() req: ReqWithUser, @Query('appCode') appCode: string) {
    return this.svc.list(appCode, tenantOf(req));
  }

  @Permission('webhook:write')
  @Patch(':id/enabled')
  toggle(@Req() req: ReqWithUser, @Param('id') id: string, @Body() body: ToggleDto) {
    return this.svc.setEnabled(id, body.enabled, tenantOf(req));
  }

  @Permission('webhook:write')
  @Delete(':id')
  remove(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.remove(id, tenantOf(req));
  }

  /** 列出某条 sub 的投递历史；UI 调试用。 */
  @Permission('webhook:read')
  @Get(':id/deliveries')
  deliveries(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: 'pending' | 'success' | 'dead_lettered',
  ) {
    return this.svc.listDeliveries(
      id,
      {
        ...(page ? { page: Number(page) } : {}),
        ...(pageSize ? { pageSize: Number(pageSize) } : {}),
        ...(status ? { status } : {}),
      },
      tenantOf(req),
    );
  }
}
