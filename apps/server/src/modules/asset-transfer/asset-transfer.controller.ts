import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetTransferService } from './asset-transfer.service';
import { Permission } from '../rbac/permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ExpressLikeRes {
  setHeader(k: string, v: string): void;
  send(body: Buffer | string): void;
}

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

function tenantOf(req: ReqWithUser): string | null {
  return req.user?.tenantCode ?? req.accessKeyCtx?.tenantCode ?? null;
}

@Controller('apps/:appCode/transfer')
export class AssetTransferController {
  constructor(private readonly svc: AssetTransferService) {}

  @Permission('asset:read')
  @Get('export')
  async export(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @Res() res: ExpressLikeRes,
  ) {
    const { zip, filename } = await this.svc.exportBundle(appCode, tenantOf(req));
    res.setHeader('Content-Type', 'application/zip');
    // RFC 5987 编码：filename* 走 UTF-8 + percent-encoding，避免 appCode 含
    // 引号 / 换行 / CRLF 时被注入 Content-Disposition 头。filename= 留 ASCII fallback。
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.send(zip);
  }

  @Permission('asset:write')
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB —— 已经远超正常 bundle 大小
    }),
  )
  async import(
    @Req() req: ReqWithUser,
    @Param('appCode') appCode: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Query('overwrite') overwrite?: string,
    @Body() _body?: unknown,
  ) {
    if (!file) {
      return { error: 'multipart "file" field required' };
    }
    return this.svc.importBundle(
      appCode,
      file.buffer,
      { overwrite: overwrite === 'true' },
      tenantOf(req),
    );
  }
}
