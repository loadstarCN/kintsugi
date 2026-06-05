import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ChatsService } from '../chats/chats.service';

/**
 * 钉钉机器人 outgoing webhook 接收器。与 FeishuService 同形态、不同验签算法。
 *
 * 钉钉自定义机器人加签（webhook 出向、入向都走相同的算法）：
 *   sign = base64(HMAC-SHA256(secret, timestamp + '\n' + secret))
 *   timestamp 是毫秒级 + 5 分钟窗口
 *
 * 注：钉钉 outgoing webhook 把 sign 作为 query string 传（不是 header），
 *     所以这里 verifySignature 也接 query。
 *
 * 部署：
 *  - DINGTALK_VERIFY_SECRET=<群机器人加签 secret> 启用
 *  - dev/test 不设 → warn 放行；prod 必须设否则拒
 *
 * 不主动调钉钉发消息接口；返回 { reply } 字符串由外层转发器投递。
 *
 * 钉钉 outgoing payload shape（简化）：
 *   {
 *     msgtype: "text",
 *     text: { content: "@机器人 你好" },
 *     senderNick, senderId, ...
 *   }
 */
@Injectable()
export class DingtalkService {
  private readonly logger = new Logger(DingtalkService.name);

  constructor(private readonly chats: ChatsService) {}

  async handleEvent(
    body: Record<string, unknown>,
    appCodeHint: string,
  ): Promise<{ reply?: string; error?: string }> {
    if (body['msgtype'] !== 'text') {
      return { reply: '（目前只支持文本消息）' };
    }
    const text = ((body['text'] as { content?: string } | undefined)?.content ?? '').trim();
    const cleaned = stripMention(text);
    if (!cleaned) return { reply: '说点什么呀？' };

    this.logger.log(`dingtalk → chats: ${cleaned.slice(0, 60)}`);
    try {
      const result = await this.chats.ask({ appCode: appCodeHint, question: cleaned });
      const rows = result.data.slice(0, 5);
      const summary =
        rows.length === 0
          ? '查询结果为空'
          : rows.map((r) => Object.values(r).join(' | ')).join('\n');
      return {
        reply: `${result.explanation || 'SQL 已执行'}\n\n📊 ${result.rowCount} 行，前 5 行：\n${summary}`,
      };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /**
   * 钉钉加签校验：
   *   sign 由 outgoing webhook 配置时生成；query 里给 ?timestamp=...&sign=...
   *   timestamp 单位 ms，5 分钟窗口防重放
   *   stringToSign = `${timestamp}\n${secret}`
   *   expected   = base64(HMAC-SHA256(secret, stringToSign))
   */
  verifySignature(
    timestamp: string | undefined,
    sign: string | undefined,
    secret: string | undefined,
  ): boolean {
    if (!secret) {
      // 生产强拒；非生产 + KINTSUGI_BRIDGE_DEV_BYPASS=true 才放行——之前
      // 默认 dev 放行太危险（生产 NODE_ENV 漏配 = 任何人能命中 chats.ask）
      if (process.env['NODE_ENV'] === 'production') {
        this.logger.warn(
          'DINGTALK_VERIFY_SECRET unset in production — webhook denied. ' +
            'Set DINGTALK_VERIFY_SECRET env var to enable DingTalk integration.',
        );
        return false;
      }
      if (process.env['KINTSUGI_BRIDGE_DEV_BYPASS'] !== 'true') {
        this.logger.warn(
          'DINGTALK_VERIFY_SECRET 未设置；webhook 拒绝。' +
            '本地调试可设 KINTSUGI_BRIDGE_DEV_BYPASS=true 临时放行（仅 dev）。',
        );
        return false;
      }
      this.logger.warn(
        'DINGTALK_VERIFY_SECRET 未设置 + KINTSUGI_BRIDGE_DEV_BYPASS=true，放行 webhook',
      );
      return true;
    }
    if (!timestamp || !sign) return false;
    const ts = Number(timestamp);
    // 时间窗检查：非有限数 / 负 / 太未来 / 太老 → 拒
    if (!Number.isFinite(ts) || ts < 0) return false;
    const now = Date.now();
    if (ts > now + 60_000) return false; // 不能来自未来超过 1min
    if (ts < now - 5 * 60_000) return false; // 5min 防重放
    const stringToSign = `${timestamp}\n${secret}`;
    const expected = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
    if (expected.length !== sign.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sign));
    } catch {
      return false;
    }
  }
}

function stripMention(s: string): string {
  // 钉钉 @机器人 通常被渲染为机器人 nick；这里粗略剥掉常见 @xxx 前缀
  return s.replace(/^@\S+\s*/, '').trim();
}
