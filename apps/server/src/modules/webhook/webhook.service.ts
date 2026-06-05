import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { encrypt, decrypt } from '../../common/crypto';
import { assertHostAllowed, SsrfBlocked } from '../../common/ssrf';

/**
 * 出向 webhook：at-least-once 投递。
 *
 * 流程：
 *   1. dispatch() 写一条 WebhookDelivery (status=pending, attempts=0,
 *      nextAttemptAt=now)，立即触发一次 deliverOnce()
 *   2. deliverOnce() 成功 → status=success
 *      失败 → attempts++; 若 ≥ MAX_ATTEMPTS → status=dead_lettered
 *             否则 nextAttemptAt = now + backoff(attempts)
 *   3. SchedulerService 周期性扫 status=pending 且 nextAttemptAt<now → 再发
 *
 * 退避：1m / 5m / 30m / 2h / 12h（合计 ~14h），抗短期 outage。
 *
 * 失败 payload 落库：dispatch 时一次性把 body 写入 payloadJson，重试不依赖
 * 调用方再次提供（业务事务可能已经过去；重试是异步系统的事）。
 *
 * 签名：HMAC-SHA256 over body，每次重发用同一 body 重算（secret 解密同样靠 sub.secretCipher）。
 *
 * 读 attempts 后写：用 Prisma 的 update with where { id, attempts: prev } 做乐观锁，
 * 防止两个 worker 同时拿到一条 pending row 撞车。
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private static readonly TIMEOUT_MS = 8000;
  private static readonly MAX_ATTEMPTS = 5;
  /** 退避序列：第 N 次失败后的 next-attempt 偏移；i = (新)attempts (1-based)。 */
  private static readonly BACKOFF_MS = [
    60_000, // attempt 1 失败 → 1m 后再试
    5 * 60_000, // attempt 2 → 5m
    30 * 60_000, // attempt 3 → 30m
    2 * 60 * 60_000, // attempt 4 → 2h
    12 * 60 * 60_000, // 备用（实际 attempt 5 失败就 DLQ）
  ];

  constructor(private readonly prisma: PrismaService) {}

  // ---- subscription CRUD ----

  /** appCode 必须属于 tenantCode；tenantCode=null 走 access-key 路径放行 */
  private async assertAppOwned(appCode: string, tenantCode: string | null): Promise<void> {
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: { tenantCode: true },
    });
    if (!app) throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    if (tenantCode !== null && app.tenantCode !== tenantCode) {
      // 不暴露目标存在
      throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    }
  }

  /** 通过 sub.id 反查 appCode + 校验租户 */
  private async assertSubOwned(subId: string, tenantCode: string | null): Promise<{ appCode: string }> {
    const sub = await this.prisma.webhookSub.findUnique({
      where: { id: subId },
      select: { appCode: true },
    });
    if (!sub) throw new KintsugiError('NOT_FOUND', `webhook ${subId} not found`);
    await this.assertAppOwned(sub.appCode, tenantCode);
    return sub;
  }

  async create(
    input: {
      appCode: string;
      url: string;
      events: string[];
      description?: string;
    },
    tenantCode: string | null,
  ): Promise<{ id: string; secret: string }> {
    await this.assertAppOwned(input.appCode, tenantCode);
    if (!/^https?:\/\//.test(input.url)) {
      throw new KintsugiError('VALIDATION_FAILED', 'webhook url must be http(s)');
    }
    // SSRF：拒绝指向私网/loopback/link-local（含 169.254.169.254 metadata）的 URL。
    // create 时一次性挡掉 + deliver 路径运行时再校验一次（防 DNS rebinding）。
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(input.url);
    } catch {
      throw new KintsugiError('VALIDATION_FAILED', 'webhook url is malformed');
    }
    try {
      await assertHostAllowed(parsedUrl.hostname);
    } catch (err) {
      if (err instanceof SsrfBlocked) {
        throw new KintsugiError('VALIDATION_FAILED', `webhook url rejected: ${err.message}`);
      }
      throw err;
    }
    if (!Array.isArray(input.events) || input.events.length === 0) {
      throw new KintsugiError('VALIDATION_FAILED', 'events must be non-empty');
    }
    const secret = `whs_${crypto.randomBytes(24).toString('hex')}`;
    const sub = await this.prisma.webhookSub.create({
      data: {
        appCode: input.appCode,
        url: input.url,
        events: input.events,
        secretCipher: encrypt(secret),
        description: input.description ?? null,
      },
      select: { id: true },
    });
    return { id: sub.id, secret };
  }

  async list(appCode: string, tenantCode: string | null) {
    await this.assertAppOwned(appCode, tenantCode);
    return this.prisma.webhookSub.findMany({
      where: { appCode },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        appCode: true,
        url: true,
        events: true,
        description: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async setEnabled(id: string, enabled: boolean, tenantCode: string | null): Promise<{ ok: true }> {
    await this.assertSubOwned(id, tenantCode);
    await this.prisma.webhookSub.update({ where: { id }, data: { enabled } });
    return { ok: true };
  }

  async remove(id: string, tenantCode: string | null): Promise<{ ok: true }> {
    await this.assertSubOwned(id, tenantCode);
    await this.prisma.webhookSub.delete({ where: { id } });
    return { ok: true };
  }

  /** UI 调试用：列出某条 sub 的最近投递记录（按 createdAt desc 分页）。 */
  async listDeliveries(
    subId: string,
    opts: { page?: number; pageSize?: number; status?: 'pending' | 'success' | 'dead_lettered' } = {},
    tenantCode: string | null = null,
  ) {
    await this.assertSubOwned(subId, tenantCode);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where = { subId, ...(opts.status ? { status: opts.status } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          event: true,
          status: true,
          attempts: true,
          nextAttemptAt: true,
          lastHttpStatus: true,
          lastErrorMsg: true,
          lastDurationMs: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  // ---- 派发 ----

  /**
   * 给指定 appCode + event 的所有订阅写入 pending delivery + 立即尝试一次。
   * 调用方 fire-and-forget。
   */
  async dispatch(
    appCode: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const subs = await this.prisma.webhookSub
      .findMany({ where: { appCode, enabled: true, events: { has: event } } })
      .catch(() => [] as Array<{ id: string; url: string; secretCipher: string }>);
    for (const sub of subs) {
      const payloadJson = { event, timestamp: Math.floor(Date.now() / 1000), data: payload };
      let delivery: { id: string };
      try {
        delivery = await this.prisma.webhookDelivery.create({
          data: {
            subId: sub.id,
            event,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: new Date(),
            payloadJson: payloadJson as object,
          },
          select: { id: true },
        });
      } catch (err) {
        this.logger.warn(
          `webhook delivery row create failed for sub=${sub.id}: ${(err as Error).message}`,
        );
        continue;
      }
      void this.deliverOnce(delivery.id);
    }
  }

  /**
   * Scheduler 每 tick 调一次：扫 pending 且 nextAttemptAt < now 的 delivery，
   * 限量批处理避免单个 tick 把 LLM/网络挤满。
   */
  async retryPending(maxBatch = 50): Promise<{ retried: number; deadLettered: number }> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: maxBatch,
      select: { id: true },
    });
    let retried = 0;
    let deadLettered = 0;
    for (const d of due) {
      const result = await this.deliverOnce(d.id);
      if (result === 'dead_lettered') deadLettered += 1;
      else retried += 1;
    }
    return { retried, deadLettered };
  }

  /**
   * 单条 delivery 的一次尝试。返回新状态。
   *
   * 多实例并发安全：进 fetch 之前**先 claim**——把 nextAttemptAt 推到将来
   * （TIMEOUT_MS + 30s），第二个实例的 retryPending 扫不到。如果本实例 crash
   * 或 fetch 卡死，lease 过期后其他实例又能接管。原乐观锁（where attempts=prev）
   * 只能防止 markSuccess 双写，**HTTP 已经发出去了**——典型 at-most-once-claim
   * 模型，不靠最后一步阻拦。
   */
  private async deliverOnce(deliveryId: string): Promise<'success' | 'pending' | 'dead_lettered'> {
    const d = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { sub: { select: { url: true, secretCipher: true, enabled: true } } },
    });
    if (!d || d.status !== 'pending') return (d?.status ?? 'pending') as never;

    // Claim：原子推进 nextAttemptAt。失败 → 别人已经接走了，本次直接退出。
    const lease = new Date(Date.now() + WebhookService.TIMEOUT_MS + 30_000);
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        status: 'pending',
        nextAttemptAt: d.nextAttemptAt,
      },
      data: { nextAttemptAt: lease },
    });
    if (claimed.count === 0) {
      this.logger.debug?.(`webhook ${deliveryId}: lost claim race, skipping`);
      return 'pending';
    }
    if (!d.sub.enabled) {
      await this.markDeadLettered(d.id, d.attempts, 0, null, 'sub disabled', 0);
      return 'dead_lettered';
    }

    const prevAttempts = d.attempts;
    const newAttempts = prevAttempts + 1;
    const body = JSON.stringify(d.payloadJson);

    let secret: string;
    try {
      secret = decrypt(d.sub.secretCipher);
    } catch (err) {
      this.logger.warn(`webhook ${d.id} secret undecryptable: ${(err as Error).message}`);
      await this.markDeadLettered(d.id, newAttempts, 0, null, 'secret-undecryptable', 0);
      return 'dead_lettered';
    }
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

    // SSRF：deliver 时再校验一次 host（防 DNS rebinding：create 时是公网 IP，
    // deliver 时被改成私网 IP）。失败转 dead-letter，不重试——重试也是 fail。
    try {
      const u = new URL(d.sub.url);
      await assertHostAllowed(u.hostname);
    } catch (err) {
      const msg = err instanceof SsrfBlocked ? err.message : (err as Error).message;
      this.logger.warn(`webhook ${d.id} → ${d.sub.url} blocked by SSRF guard: ${msg}`);
      await this.markDeadLettered(d.id, newAttempts, 0, null, `ssrf-blocked: ${msg}`, 0);
      return 'dead_lettered';
    }

    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WebhookService.TIMEOUT_MS);
    try {
      const res = await fetch(d.sub.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Kintsugi-Event': d.event,
          'X-Kintsugi-Timestamp': ts,
          'X-Kintsugi-Signature': `sha256=${sig}`,
          'X-Kintsugi-Attempts': String(newAttempts),
          // delivery id 让 receiver 端做幂等：HMAC 签名后的 retry 走相同 id，
          // receiver 收到重复 id 直接 200 跳过即可。无此 header 时，HTTP 抖动
          // （服务端 200 但响应丢失 → 我们重发）会让 receiver 重复处理。
          'X-Kintsugi-Delivery-Id': d.id,
          'User-Agent': 'kintsugi-webhook/0.1',
        },
        body,
      });
      const text = await res.text().catch(() => '');
      const duration = Date.now() - t0;
      if (res.ok) {
        await this.markSuccess(d.id, prevAttempts, newAttempts, res.status, text.slice(0, 1000), duration);
        return 'success';
      }
      return await this.scheduleRetryOrDeadLetter(
        d.id,
        prevAttempts,
        newAttempts,
        res.status,
        text.slice(0, 1000),
        `non-2xx ${res.status}`,
        duration,
      );
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const duration = Date.now() - t0;
      this.logger.warn(`webhook ${d.id} → ${d.sub.url} attempt ${newAttempts}: ${msg}`);
      return await this.scheduleRetryOrDeadLetter(
        d.id,
        prevAttempts,
        newAttempts,
        0,
        null,
        msg.slice(0, 1000),
        duration,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private backoff(attempts: number): Date {
    const i = Math.min(attempts - 1, WebhookService.BACKOFF_MS.length - 1);
    return new Date(Date.now() + WebhookService.BACKOFF_MS[i]!);
  }

  private async markSuccess(
    id: string,
    prevAttempts: number,
    newAttempts: number,
    status: number,
    response: string | null,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.webhookDelivery
      .update({
        where: { id, attempts: prevAttempts }, // 乐观锁；claim 已经先于 fetch 推进 nextAttemptAt
        data: {
          status: 'success',
          attempts: newAttempts,
          nextAttemptAt: null,
          lastHttpStatus: status,
          lastResponse: response,
          lastErrorMsg: null,
          lastDurationMs: durationMs,
        },
      })
      .catch((err) => {
        // 此前是 .catch(() => undefined) 直接吞掉。现在至少 log 一下——
        // claim 已经防止真双投递，但乐观锁失败仍意味着有别的实例在并发改这条
        // delivery（异常路径），oncall 应该看到。
        this.logger.warn(`webhook ${id}: markSuccess lock-failed: ${(err as Error).message}`);
      });
  }

  private async scheduleRetryOrDeadLetter(
    id: string,
    prevAttempts: number,
    newAttempts: number,
    status: number,
    response: string | null,
    errorMsg: string | null,
    durationMs: number,
  ): Promise<'pending' | 'dead_lettered'> {
    if (newAttempts >= WebhookService.MAX_ATTEMPTS) {
      await this.markDeadLettered(id, newAttempts, status, response, errorMsg, durationMs);
      return 'dead_lettered';
    }
    const next = this.backoff(newAttempts);
    await this.prisma.webhookDelivery
      .update({
        where: { id, attempts: prevAttempts },
        data: {
          attempts: newAttempts,
          nextAttemptAt: next,
          lastHttpStatus: status,
          lastResponse: response,
          lastErrorMsg: errorMsg,
          lastDurationMs: durationMs,
        },
      })
      .catch((err) => {
        this.logger.warn(`webhook ${id}: scheduleRetry lock-failed: ${(err as Error).message}`);
      });
    return 'pending';
  }

  private async markDeadLettered(
    id: string,
    attempts: number,
    status: number,
    response: string | null,
    errorMsg: string | null,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.webhookDelivery
      .update({
        where: { id },
        data: {
          status: 'dead_lettered',
          attempts,
          nextAttemptAt: null,
          lastHttpStatus: status,
          lastResponse: response,
          lastErrorMsg: errorMsg,
          lastDurationMs: durationMs,
        },
      })
      .catch(() => undefined);
    this.logger.warn(`webhook delivery ${id} dead-lettered after ${attempts} attempts`);
  }
}
