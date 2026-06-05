import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';
import { PagesService } from './pages.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

class GenerateDto {
  @IsString() prompt!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) datasetCodes?: string[];
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() routePath?: string;
  /** 截图 / 原型图：可以是 https URL 也可以是 data:image/png;base64,... */
  @IsOptional() @IsArray() @IsString({ each: true }) imageUrls?: string[];
}

class SaveSourceDto {
  @IsObject() sourceFiles!: Record<string, string>;
}

class RegenerateDto {
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) datasetCodes?: string[];
}

@Controller()
export class PagesController {
  constructor(private readonly svc: PagesService) {}

  @Get('pages')
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

  @Get('pages/:id')
  get(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.get(id, tenantOf(req));
  }

  @Permission('page:write')
  @Put('pages/:id/source')
  saveSource(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Body() body: SaveSourceDto,
  ) {
    return this.svc.saveSource(id, body.sourceFiles, tenantOf(req));
  }

  @Permission('page:write')
  @Post('pages/:id/publish')
  publish(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.publish(id, tenantOf(req));
  }

  @Permission('page:write')
  @Post('pages/:id/regenerate')
  regenerate(
    @Req() req: ReqWithUser,
    @Param('id') id: string,
    @Body() body: RegenerateDto,
  ) {
    return this.svc.regenerate(
      id,
      {
        ...(body.prompt ? { prompt: body.prompt } : {}),
        ...(body.datasetCodes ? { datasetCodes: body.datasetCodes } : {}),
      },
      tenantOf(req),
    );
  }

  @Permission('page:write')
  @Delete('pages/:id')
  remove(@Req() req: ReqWithUser, @Param('id') id: string) {
    return this.svc.delete(id, tenantOf(req));
  }

  @Permission('page:write')
  @Post('apps/:appCode/pages/generate')
  generate(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Body() body: GenerateDto,
  ) {
    return this.svc.generate(
      {
        appCode,
        prompt: body.prompt,
        ...(body.datasetCodes ? { datasetCodes: body.datasetCodes } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.routePath ? { routePath: body.routePath } : {}),
        ...(body.imageUrls ? { imageUrls: body.imageUrls } : {}),
      },
      tenantOf(req),
    );
  }
}
