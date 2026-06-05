import {
  Body,
  Controller,
  Headers,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { FeishuService } from './feishu.service';
import { Public } from '../auth/auth.guard';

interface ReqWithRaw {
  rawBody?: Buffer;
}

@Public()
@Controller('bridges/feishu')
export class FeishuController {
  constructor(private readonly svc: FeishuService) {}

  /**
   * POST /api/bridges/feishu/webhook?appCode=app-demo0001
   * 头：X-Lark-Signature / X-Lark-Request-Timestamp / X-Lark-Request-Nonce
   *
   * 返回：
   *  - URL 校验：{ challenge }
   *  - 消息：{ reply: '...' } 或 { error: '...' }
   * 外层接入方（飞书机器人转发器）拿到 reply 后回帖。
   */
  @Post('webhook')
  async webhook(
    @Req() req: ReqWithRaw,
    @Body() body: Record<string, unknown>,
    @Query('appCode') appCode: string,
    @Headers('x-lark-signature') sig?: string,
    @Headers('x-lark-request-timestamp') ts?: string,
    @Headers('x-lark-request-nonce') nonce?: string,
  ) {
    if (!appCode) return { error: 'missing ?appCode=...' };
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const verifyToken = process.env['FEISHU_VERIFY_TOKEN'];
    const ok = this.svc.verifySignature(sig, ts, nonce, rawBody, verifyToken);
    if (!ok) {
      throw new UnauthorizedException('invalid feishu signature');
    }
    return this.svc.handleEvent(body, appCode);
  }
}
