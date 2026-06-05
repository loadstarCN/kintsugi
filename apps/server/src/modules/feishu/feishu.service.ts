import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ChatsService } from '../chats/chats.service';

/**
 * 飞书事件 webhook 接收器。
 * 支持：
 *  - URL 校验（event_callback verification）
 *  - 消息事件（im.message.receive_v1）→ 提取文本 → 调 ChatsService.ask → 通过调用方再把结果发回去
 *  - X-Lark-Signature 校验（按 v2：base64(sha256(timestamp + nonce + verify_token + body))）
 *
 * 部署：
 *  - 设置 FEISHU_VERIFY_TOKEN 启用验签；缺省 → 仅记 warn 放行（dev 模式）
 *  - 不在后端直接调飞书 tenant-access-token 接口回消息（需要 app-id/secret）。
 *    本 bridge 返回 reply 字段，由外层调用方自行发消息。
 */
@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);

  constructor(private readonly chats: ChatsService) {}

  /**
   * URL 校验：飞书第一次绑定 webhook 时会发 challenge，我们原样 echo。
   */
  async handleEvent(
    body: Record<string, unknown>,
    appCodeHint: string,
  ): Promise<{ challenge?: string; reply?: string; error?: string }> {
    // 1. URL verification
    if (body['type'] === 'url_verification' && typeof body['challenge'] === 'string') {
      return { challenge: body['challenge'] as string };
    }

    // 2. 消息事件
    const header = body['header'] as { event_type?: string } | undefined;
    const event = body['event'] as
      | {
          message?: {
            message_type?: string;
            content?: string;
          };
          sender?: { sender_id?: { open_id?: string } };
        }
      | undefined;

    if (header?.event_type !== 'im.message.receive_v1' || !event?.message) {
      return { error: 'unsupported event type' };
    }

    const msgType = event.message.message_type;
    if (msgType !== 'text') {
      return { reply: '（目前只支持文本消息；图片/卡片等忽略）' };
    }
    let text = '';
    try {
      const parsed = JSON.parse(event.message.content ?? '{}') as { text?: string };
      text = parsed.text ?? '';
    } catch {
      return { error: 'cannot parse message content' };
    }
    text = stripMention(text);
    if (!text.trim()) return { reply: '说点什么呀？' };

    this.logger.log(`feishu → chats: ${text.slice(0, 60)}`);
    try {
      const result = await this.chats.ask({ appCode: appCodeHint, question: text });
      const rows = result.data.slice(0, 5);
      const summary =
        rows.length === 0
          ? '查询结果为空'
          : rows.map((r) => Object.values(r).join(' | ')).join('\n');
      return { reply: `${result.explanation || 'SQL 已执行'}\n\n📊 ${result.rowCount} 行，前 5 行：\n${summary}` };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /**
   * 验签（飞书 v2 非加密订阅）：
   *   expected = base64(sha256(timestamp + nonce + verify_token + body))
   * 与 X-Lark-Signature 比较（timing-safe）。
   *
   * 加密订阅（启用了 encrypt key）走另一套：先 AES 解密 body 再验签。
   * 本实现仅覆盖非加密场景，符合大多数自建机器人。
   *
   * 返回值：
   *   true  → 通过（含未配 token 的"开发模式放行"）
   *   false → 拒绝
   */
  verifySignature(
    signature: string | undefined,
    timestamp: string | undefined,
    nonce: string | undefined,
    rawBody: string,
    verifyToken: string | undefined,
  ): boolean {
    if (!verifyToken) {
      // 生产强制要 token；非生产 + KINTSUGI_BRIDGE_DEV_BYPASS=true 才放行——
      // 否则 NODE_ENV 漏配 = 任何人能命中 chats.ask，烧 LLM + 查租户 DB
      if (process.env['NODE_ENV'] === 'production') {
        this.logger.warn(
          'FEISHU_VERIFY_TOKEN unset in production — webhook denied. ' +
            'Set FEISHU_VERIFY_TOKEN env var to enable Feishu integration.',
        );
        return false;
      }
      if (process.env['KINTSUGI_BRIDGE_DEV_BYPASS'] !== 'true') {
        this.logger.warn(
          'FEISHU_VERIFY_TOKEN 未设置；webhook 拒绝。' +
            '本地调试可设 KINTSUGI_BRIDGE_DEV_BYPASS=true 临时放行（仅 dev）。',
        );
        return false;
      }
      this.logger.warn(
        'FEISHU_VERIFY_TOKEN 未设置 + KINTSUGI_BRIDGE_DEV_BYPASS=true，放行 webhook',
      );
      return true;
    }
    if (!signature || !timestamp || !nonce) return false;
    // 5 分钟时间窗（秒级时间戳）
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts < 0) return false;
    const nowSec = Date.now() / 1000;
    if (ts > nowSec + 60) return false;
    if (ts < nowSec - 300) return false;
    const toSign = `${timestamp}${nonce}${verifyToken}${rawBody}`;
    const expected = crypto.createHash('sha256').update(toSign).digest('base64');
    if (expected.length !== signature.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}

function stripMention(s: string): string {
  return s.replace(/<at[^>]*>.*?<\/at>/g, '').trim();
}
