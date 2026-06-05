import {
  Body,
  Controller,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { DingtalkService } from './dingtalk.service';
import { Public } from '../auth/auth.guard';

@Public()
@Controller('bridges/dingtalk')
export class DingtalkController {
  constructor(private readonly svc: DingtalkService) {}

  /**
   * POST /api/bridges/dingtalk/webhook?appCode=app-x&timestamp=...&sign=...
   *
   * 钉钉 outgoing webhook 把 timestamp/sign 放进 query；body 是消息事件 JSON。
   * 返回 { reply: '...' } 或 { error: '...' }；外层接到 reply 后回到群。
   */
  @Post('webhook')
  async webhook(
    @Body() body: Record<string, unknown>,
    @Query('appCode') appCode: string,
    @Query('timestamp') timestamp?: string,
    @Query('sign') sign?: string,
  ) {
    if (!appCode) return { error: 'missing ?appCode=...' };
    const secret = process.env['DINGTALK_VERIFY_SECRET'];
    const ok = this.svc.verifySignature(timestamp, sign, secret);
    if (!ok) {
      throw new UnauthorizedException('invalid dingtalk signature');
    }
    return this.svc.handleEvent(body, appCode);
  }
}
