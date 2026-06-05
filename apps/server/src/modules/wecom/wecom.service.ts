import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ChatsService } from '../chats/chats.service';

/**
 * 企业微信（WeCom）outgoing webhook 接收器。
 *
 * 简化模式：
 *  - 用 WECOM_VERIFY_TOKEN 做签名校验（与 IP 白名单互补）
 *  - 期望 client 端用 application/json，文本消息 schema 类似钉钉
 *  - **不实现** 加密 XML 模式（企微"接收回调"那条路径要求 AES-CBC + GB2312-style
 *    XML 解析；上得很重；放到客户提需求时再做）
 *
 * 验签：与飞书 v2 一样的 SHA-1（msg_signature 是 sha1 而非 sha256，企微规定）：
 *   sig = sha1(sort([token, timestamp, nonce, encrypt or body]).join(''))
 *
 * 部署：
 *  - WECOM_VERIFY_TOKEN=<回调配置时填的 token>
 *  - dev 模式（NODE_ENV != production）token 缺省时放行 + warn
 */
@Injectable()
export class WecomService {
  private readonly logger = new Logger(WecomService.name);

  constructor(private readonly chats: ChatsService) {}

  async handleEvent(
    body: Record<string, unknown>,
    appCodeHint: string,
  ): Promise<{ reply?: string; error?: string }> {
    // 文本消息：自建配置时常见 shape
    //   { msgtype: "text", text: { content: "..." } }
    if (body['msgtype'] !== 'text') {
      return { reply: '（目前只支持文本消息；图片/语音忽略）' };
    }
    const text = ((body['text'] as { content?: string } | undefined)?.content ?? '').trim();
    const cleaned = stripMention(text);
    if (!cleaned) return { reply: '说点什么呀？' };

    this.logger.log(`wecom → chats: ${cleaned.slice(0, 60)}`);
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
   * 企微回调 SHA-1 验签（明文模式）：
   *   msg_signature = sha1(sort([token, timestamp, nonce, body_or_echostr]).join(''))
   * 接 ?msg_signature=...&timestamp=...&nonce=...
   *
   * 企微的 "URL 接入校验" 把消息体替成 echostr=...；其他时候用 raw body。
   * Caller 自己决定第 4 个字段；这里做通用校验。
   */
  verifySignature(
    msgSignature: string | undefined,
    timestamp: string | undefined,
    nonce: string | undefined,
    payload: string,
    token: string | undefined,
  ): boolean {
    if (!token) {
      // 生产强拒；非生产 + KINTSUGI_BRIDGE_DEV_BYPASS=true 才放行
      if (process.env['NODE_ENV'] === 'production') {
        this.logger.warn(
          'WECOM_VERIFY_TOKEN unset in production — webhook denied. ' +
            'Set WECOM_VERIFY_TOKEN env var to enable WeCom integration.',
        );
        return false;
      }
      if (process.env['KINTSUGI_BRIDGE_DEV_BYPASS'] !== 'true') {
        this.logger.warn(
          'WECOM_VERIFY_TOKEN 未设置；webhook 拒绝。' +
            '本地调试可设 KINTSUGI_BRIDGE_DEV_BYPASS=true 临时放行（仅 dev）。',
        );
        return false;
      }
      this.logger.warn(
        'WECOM_VERIFY_TOKEN 未设置 + KINTSUGI_BRIDGE_DEV_BYPASS=true，放行 webhook',
      );
      return true;
    }
    if (!msgSignature || !timestamp || !nonce) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts < 0) return false;
    const nowSec = Date.now() / 1000;
    if (ts > nowSec + 60) return false;
    if (ts < nowSec - 300) return false; // 5min 防重放
    const expected = crypto
      .createHash('sha1')
      .update([token, timestamp, nonce, payload].sort().join(''))
      .digest('hex');
    if (expected.length !== msgSignature.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(msgSignature));
    } catch {
      return false;
    }
  }
}

function stripMention(s: string): string {
  return s.replace(/^@\S+\s*/, '').trim();
}
