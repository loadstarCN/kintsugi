import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { WecomService } from './wecom.service';
import { Public } from '../auth/auth.guard';

interface ReqWithRaw {
  rawBody?: Buffer;
}

@Public()
@Controller('bridges/wecom')
export class WecomController {
  constructor(private readonly svc: WecomService) {}

  /**
   * URL 接入校验（GET）。企微在配置 URL 时发：
   *   GET /api/bridges/wecom/webhook?appCode=...
   *     &msg_signature=...&timestamp=...&nonce=...&echostr=<encrypted base64>
   * 简化模式：echostr 走原路返回（适合 plain-text 模式，不接加密回调）。
   */
  @Get('webhook')
  verify(
    @Query('appCode') appCode: string,
    @Query('msg_signature') sig?: string,
    @Query('timestamp') ts?: string,
    @Query('nonce') nonce?: string,
    @Query('echostr') echostr?: string,
  ): string {
    if (!appCode || !echostr) throw new UnauthorizedException('missing params');
    const ok = this.svc.verifySignature(sig, ts, nonce, echostr, process.env['WECOM_VERIFY_TOKEN']);
    if (!ok) throw new UnauthorizedException('invalid wecom signature');
    return echostr;
  }

  /**
   * 消息事件（POST + JSON）。注意：企微"自建机器人"才支持 plain JSON；
   * "应用回调"是 XML+AES，本 endpoint 不接管。
   */
  @Post('webhook')
  async webhook(
    @Req() req: ReqWithRaw,
    @Body() body: Record<string, unknown>,
    @Query('appCode') appCode: string,
    @Query('msg_signature') sig?: string,
    @Query('timestamp') ts?: string,
    @Query('nonce') nonce?: string,
  ) {
    if (!appCode) return { error: 'missing ?appCode=...' };
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const ok = this.svc.verifySignature(sig, ts, nonce, rawBody, process.env['WECOM_VERIFY_TOKEN']);
    if (!ok) throw new UnauthorizedException('invalid wecom signature');
    return this.svc.handleEvent(body, appCode);
  }
}
