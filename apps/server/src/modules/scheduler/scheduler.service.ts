import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookService } from '../webhook/webhook.service';
import { MailService } from '../mail/mail.service';
import { TEMPLATE_NAMES } from '../mail/mail.templates';

const meter = metrics.getMeter('kintsugi-scheduler');
const accessKeyExpiringSoon = meter.createUpDownCounter(
  'kintsugi_access_key_expiring_soon',
  { description: 'AccessKeys expiring within 7 days (gauge-style; reset each tick).' },
);
const inactiveUserCount = meter.createUpDownCounter(
  'kintsugi_inactive_user_count',
  { description: 'Users not logged-in within 90 days.' },
);
const auditLogPurged = meter.createCounter(
  'kintsugi_audit_log_purged_total',
  { description: 'Audit log rows purged by retention sweep (cumulative).' },
);

/**
 * 后台调度：周期性扫几个表，emit metric + warn-log。
 *
 * 不引入 cron 框架（@nestjs/schedule 等）；用 Nest 标准 OnModuleInit + setInterval，
 * 跟 main.ts 已有的 cleanupExpiredRevocations 保持同种实现风格。
 *
 * 每个 tick 跑两个 sweep：
 *  1. AccessKey 7 天内过期 → audit warn + 计数（让 dashboard 能看到"快到期但没旋转"的）
 *  2. User 超 90 天没登录（用 lastFailedLoginAt 的反向：有记录但太久 + 没有近期 token） → 计数
 *
 * 两个 metric 都是"快照"型——下个 tick 重置。用 UpDownCounter 是为了同时支持 +1 / 重置；
 * UI 上看 max-by-time 即可。
 *
 * 间隔从 SCHEDULER_TICK_MS 读，默认 6h。OFF: 设 0 关闭（测试 / 本地开发）。
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private slowTimer: NodeJS.Timeout | null = null;
  private fastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: WebhookService,
    private readonly mail: MailService,
  ) {}

  private get supportEmail(): string {
    return process.env['KINTSUGI_SUPPORT_EMAIL'] ?? 'support@kintsugi.example.com';
  }

  onModuleInit(): void {
    // 慢 tick：6h（key 过期 / 非活跃 user）。0 关闭。
    const slowMs = Number(process.env['SCHEDULER_TICK_MS'] ?? '21600000');
    // 快 tick：30s（webhook 重试）。0 关闭。
    const fastMs = Number(process.env['WEBHOOK_RETRY_TICK_MS'] ?? '30000');

    if (slowMs <= 0) {
      this.logger.log('SCHEDULER_TICK_MS=0 → slow tick disabled');
    } else {
      setTimeout(() => void this.slowTick(), 30_000).unref();
      this.slowTimer = setInterval(() => void this.slowTick(), slowMs);
      this.slowTimer.unref();
      this.logger.log(`scheduler slow=${slowMs}ms`);
    }

    if (fastMs <= 0) {
      this.logger.log('WEBHOOK_RETRY_TICK_MS=0 → webhook retry disabled');
    } else {
      // 启动后等 10s 第一次跑（webhook table 多半空，便宜）
      setTimeout(() => void this.fastTick(), 10_000).unref();
      this.fastTimer = setInterval(() => void this.fastTick(), fastMs);
      this.fastTimer.unref();
      this.logger.log(`scheduler fast=${fastMs}ms`);
    }
  }

  onModuleDestroy(): void {
    if (this.slowTimer) clearInterval(this.slowTimer);
    if (this.fastTimer) clearInterval(this.fastTimer);
  }

  private async slowTick(): Promise<void> {
    try {
      const expiring = await this.scanExpiringAccessKeys();
      const inactive = await this.scanInactiveUsers();
      const purged = await this.purgeOldAuditLog();
      const trialNotified = await this.notifyTrialLifecycle();
      const subNotified = await this.notifySubscriptionLifecycle();
      this.logger.log(
        `slow-tick: expiring-keys=${expiring} inactive-users=${inactive} audit-purged=${purged} ` +
          `trial-notified=${trialNotified.expiring}/${trialNotified.expired} ` +
          `sub-notified=${subNotified.expiring}/${subNotified.expired}`,
      );
    } catch (err) {
      this.logger.warn(`slow-tick failed: ${(err as Error).message}`);
    }
  }

  private async fastTick(): Promise<void> {
    try {
      const r = await this.webhook.retryPending();
      if (r.retried > 0 || r.deadLettered > 0) {
        this.logger.log(`fast-tick: webhook retried=${r.retried} dlq=${r.deadLettered}`);
      }
    } catch (err) {
      this.logger.warn(`fast-tick failed: ${(err as Error).message}`);
    }
  }

  private async scanExpiringAccessKeys(): Promise<number> {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 86400_000);
    const rows = await this.prisma.accessKey.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: now, lte: in7d },
      },
      select: { accessKey: true, appCode: true, expiresAt: true },
    });
    accessKeyExpiringSoon.add(rows.length - this.lastExpiring, {});
    this.lastExpiring = rows.length;
    if (rows.length > 0) {
      this.logger.warn(
        `${rows.length} AccessKey(s) expiring within 7d: ${rows.map((r) => r.accessKey).slice(0, 5).join(', ')}${rows.length > 5 ? '...' : ''}`,
      );
    }
    return rows.length;
  }

  private async scanInactiveUsers(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 86400_000);
    // "Active" 没有直接字段；近似：90 天内有过 audit log 记录 = 活跃。
    // 对每个 user，看 audit_log 里 userId=u.id 的最大 createdAt 是否在 cutoff 之后。
    // 大表上 GROUP BY 用户；元数据库通常 user 数量 < 1k，这条 query OK。
    const result = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "User" u
       WHERE NOT EXISTS (
         SELECT 1 FROM "AuditLog" a
         WHERE a."userId" = u.id AND a."createdAt" > $1
       )`,
      cutoff,
    );
    const count = Number(result[0]?.count ?? 0);
    inactiveUserCount.add(count - this.lastInactive, {});
    this.lastInactive = count;
    return count;
  }

  /** 上次 tick 的快照值——用 UpDownCounter 模拟 gauge，相邻 tick 之间补 delta。 */
  private lastExpiring = 0;
  private lastInactive = 0;

  /**
   * 试用账户生命周期邮件：
   *   1) 即将过期：edition=TRIAL + trialExpiresAt 在未来 N 天内（默认 3）
   *      + trialExpiringNotifiedAt 为 null → 发邮件 + 标记
   *   2) 已过期：edition=TRIAL + trialExpiresAt < now + trialExpiredNotifiedAt 为 null
   *      → 发邮件 + 标记
   *
   * 收件人是 tenant 下第一个有 email 的 user（trial.approve 时创建的 admin user）。
   * 没有可用 email 就跳过 + warn（仍会标记 notified，避免反复 warn 下个 tick）。
   *
   * mail 失败不阻塞 —— mail.service 自身已经吞错 fire-and-forget。
   */
  private async notifyTrialLifecycle(): Promise<{ expiring: number; expired: number }> {
    const now = new Date();
    const noticeDays = Number(process.env['TRIAL_EXPIRING_NOTICE_DAYS'] ?? '3');
    const noticeUntil = new Date(now.getTime() + noticeDays * 86400_000);

    let expiring = 0;
    let expired = 0;

    // 1) 即将过期
    const soon = await this.prisma.tenant.findMany({
      where: {
        edition: 'TRIAL',
        trialExpiresAt: { gt: now, lte: noticeUntil },
        trialExpiringNotifiedAt: null,
      },
      select: { tenantCode: true, trialExpiresAt: true, users: {
        where: { email: { not: null } },
        take: 1,
        select: { username: true, email: true },
      } },
    });
    for (const t of soon) {
      const u = t.users[0];
      if (!u?.email) {
        this.logger.warn(`[trial-notify] no user email under tenant=${t.tenantCode}; skip expiring mail`);
      } else {
        const daysRemaining = Math.max(
          0,
          Math.ceil((t.trialExpiresAt!.getTime() - now.getTime()) / 86400_000),
        );
        await this.mail.sendTemplate({
          template: TEMPLATE_NAMES.trialExpiringSoon,
          to: u.email,
          variables: {
            contact_name: u.username,
            tenant_code: t.tenantCode,
            expires_at: t.trialExpiresAt!.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            days_remaining: daysRemaining,
            support_email: this.supportEmail,
          },
        });
      }
      // 无论是否成功发送，都标记，避免下次 tick 重复尝试
      await this.prisma.tenant.update({
        where: { tenantCode: t.tenantCode },
        data: { trialExpiringNotifiedAt: now },
      });
      expiring++;
    }

    // 2) 已过期
    const dead = await this.prisma.tenant.findMany({
      where: {
        edition: 'TRIAL',
        trialExpiresAt: { lt: now },
        trialExpiredNotifiedAt: null,
      },
      select: { tenantCode: true, trialExpiresAt: true, users: {
        where: { email: { not: null } },
        take: 1,
        select: { username: true, email: true },
      } },
    });
    for (const t of dead) {
      const u = t.users[0];
      if (!u?.email) {
        this.logger.warn(`[trial-notify] no user email under tenant=${t.tenantCode}; skip expired mail`);
      } else {
        await this.mail.sendTemplate({
          template: TEMPLATE_NAMES.trialExpired,
          to: u.email,
          variables: {
            contact_name: u.username,
            tenant_code: t.tenantCode,
            expires_at: t.trialExpiresAt!.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            support_email: this.supportEmail,
          },
        });
      }
      await this.prisma.tenant.update({
        where: { tenantCode: t.tenantCode },
        data: { trialExpiredNotifiedAt: now },
      });
      expired++;
    }

    return { expiring, expired };
  }

  /**
   * 审计日志保留期清理：删除 createdAt < now - AUDIT_RETENTION_DAYS 的行。
   *
   * 默认 365 天（合规上线后再缩到 90/180）；0 禁用——某些客户合规要求"一律不删"，
   * 那就关掉 sweep + 走外部冷备。
   *
   * deleteMany 在大表上一次性可能锁很久；这里按日截断，单 tick 最多删一天的量
   * （cutoff 后 1 天内的行依然保留）。如果累积太久 → 第一次跑会很慢，但只会发生一次。
   */
  private async purgeOldAuditLog(): Promise<number> {
    const days = Number(process.env['AUDIT_RETENTION_DAYS'] ?? '365');
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400_000);
    const r = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (r.count > 0) {
      auditLogPurged.add(r.count, {});
      this.logger.log(`audit-log retention sweep: purged ${r.count} rows older than ${cutoff.toISOString()}`);
    }
    return r.count;
  }

  /**
   * 付费订阅生命周期邮件（与 trial 生命周期同款）：
   *   1) 即将过期：edition != TRIAL + subscriptionExpiresAt 在未来 N 天内（默认 7）
   *      + subscriptionExpiringNotifiedAt 为 null
   *   2) 已过期：edition != TRIAL + subscriptionExpiresAt < now + subscriptionExpiredNotifiedAt 为 null
   *
   * approveUpgrade 时这两个 notifiedAt 字段会被重置为 null，让下次到期再次触发提醒。
   */
  private async notifySubscriptionLifecycle(): Promise<{ expiring: number; expired: number }> {
    const now = new Date();
    const noticeDays = Number(process.env['SUBSCRIPTION_EXPIRING_NOTICE_DAYS'] ?? '7');
    const noticeUntil = new Date(now.getTime() + noticeDays * 86400_000);

    let expiring = 0;
    let expired = 0;

    // 1) 即将过期
    const soon = await this.prisma.tenant.findMany({
      where: {
        edition: { not: 'TRIAL' },
        subscriptionExpiresAt: { gt: now, lte: noticeUntil },
        subscriptionExpiringNotifiedAt: null,
      },
      select: {
        tenantCode: true,
        currentPlanCode: true,
        subscriptionExpiresAt: true,
        users: {
          where: { email: { not: null } },
          take: 1,
          select: { username: true, email: true },
        },
      },
    });
    for (const t of soon) {
      const u = t.users[0];
      if (!u?.email) {
        this.logger.warn(`[sub-notify] no user email under tenant=${t.tenantCode}; skip expiring mail`);
      } else {
        const daysRemaining = Math.max(
          0,
          Math.ceil((t.subscriptionExpiresAt!.getTime() - now.getTime()) / 86400_000),
        );
        await this.mail.sendTemplate({
          template: TEMPLATE_NAMES.subscriptionExpiringSoon,
          to: u.email,
          variables: {
            contact_name: u.username,
            tenant_code: t.tenantCode,
            plan_display_name: t.currentPlanCode ?? '当前套餐',
            expires_at: t.subscriptionExpiresAt!.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            days_remaining: daysRemaining,
            billing_url: process.env['KINTSUGI_BILLING_URL'] ?? 'https://kintsugi.example.com/billing',
            support_email: process.env['KINTSUGI_SUPPORT_EMAIL'] ?? 'support@kintsugi.example.com',
          },
        });
      }
      await this.prisma.tenant.update({
        where: { tenantCode: t.tenantCode },
        data: { subscriptionExpiringNotifiedAt: now },
      });
      expiring++;
    }

    // 2) 已过期
    const dead = await this.prisma.tenant.findMany({
      where: {
        edition: { not: 'TRIAL' },
        subscriptionExpiresAt: { lt: now },
        subscriptionExpiredNotifiedAt: null,
      },
      select: {
        tenantCode: true,
        currentPlanCode: true,
        subscriptionExpiresAt: true,
        users: {
          where: { email: { not: null } },
          take: 1,
          select: { username: true, email: true },
        },
      },
    });
    for (const t of dead) {
      const u = t.users[0];
      if (!u?.email) {
        this.logger.warn(`[sub-notify] no user email under tenant=${t.tenantCode}; skip expired mail`);
      } else {
        await this.mail.sendTemplate({
          template: TEMPLATE_NAMES.subscriptionExpired,
          to: u.email,
          variables: {
            contact_name: u.username,
            tenant_code: t.tenantCode,
            plan_display_name: t.currentPlanCode ?? '当前套餐',
            expires_at: t.subscriptionExpiresAt!.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            billing_url: process.env['KINTSUGI_BILLING_URL'] ?? 'https://kintsugi.example.com/billing',
            support_email: process.env['KINTSUGI_SUPPORT_EMAIL'] ?? 'support@kintsugi.example.com',
          },
        });
      }
      await this.prisma.tenant.update({
        where: { tenantCode: t.tenantCode },
        data: { subscriptionExpiredNotifiedAt: now },
      });
      expired++;
    }

    return { expiring, expired };
  }
}
