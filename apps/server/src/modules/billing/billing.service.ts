import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { TEMPLATE_NAMES } from '../mail/mail.templates';
import { findPlan, PLANS, totalPriceYuan, type Plan } from './plans';

const meter = metrics.getMeter('kintsugi-billing');
const upgradeActionCounter = meter.createCounter('kintsugi_upgrade_request_total', {
  description: 'Upgrade request lifecycle events (request/approve/reject).',
});

export interface RequestUpgradeInput {
  tenantCode: string;
  requestedPlanCode: string;
  requestedDurationMonths: number;
  contactName: string;
  contactEmail: string;
  phone?: string;
  note?: string;
}

export interface ApproveUpgradeInput {
  reviewerUserId: string;
  /** admin 可选填备注（仅内部，不进申请人邮件正文） */
  reviewNote?: string;
}

/**
 * 订阅 / 升级 / 续费业务逻辑。
 *
 * 模型：admin-审批驱动 — 用户 /billing 提单 → 财务 / 商务对账确认收款 →
 * /admin/upgrade-requests 审批 approve → 系统延长订阅。
 *
 * 不接外部支付（微信支付 / 支付宝 / Stripe）；本期只做"提单 → 审批 → 开通"三步流程。
 *
 * 续费 = 同 tenant 重新提一条 upgrade-request；approve 时按
 *   newExpires = max(now, currentExpiresAt) + durationMonths * 30d
 * 计算，保证提前续费不会浪费时间窗口。
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ---- 公共数据 ----

  listPlans(): Plan[] {
    return PLANS;
  }

  /**
   * 获取某租户当前订阅状态：edition / 当前 plan / 到期 / autoRenew /
   * 配额。null tenantCode → 抛 NOT_FOUND。
   */
  async getCurrentSubscription(tenantCode: string): Promise<{
    tenantCode: string;
    edition: string;
    currentPlanCode: string | null;
    plan: Plan | null;
    trialExpiresAt: string | null;
    subscriptionExpiresAt: string | null;
    autoRenew: boolean;
    aiCredits: string; // Decimal -> 字符串保精度
    quota: {
      maxDataSources: number | null;
      maxDatasets: number | null;
      maxDailyLlmCalls: number | null;
    };
  }> {
    const t = await this.prisma.tenant.findUnique({
      where: { tenantCode },
      select: {
        tenantCode: true,
        edition: true,
        currentPlanCode: true,
        trialExpiresAt: true,
        subscriptionExpiresAt: true,
        autoRenew: true,
        aiCredits: true,
        maxDataSources: true,
        maxDatasets: true,
        maxDailyLlmCalls: true,
      },
    });
    if (!t) throw new KintsugiError('NOT_FOUND', `tenant ${tenantCode} not found`);
    return {
      tenantCode: t.tenantCode,
      edition: t.edition,
      currentPlanCode: t.currentPlanCode,
      plan: t.currentPlanCode ? findPlan(t.currentPlanCode) : null,
      trialExpiresAt: t.trialExpiresAt?.toISOString() ?? null,
      subscriptionExpiresAt: t.subscriptionExpiresAt?.toISOString() ?? null,
      autoRenew: t.autoRenew,
      aiCredits: String(t.aiCredits),
      quota: {
        maxDataSources: t.maxDataSources,
        maxDatasets: t.maxDatasets,
        maxDailyLlmCalls: t.maxDailyLlmCalls,
      },
    };
  }

  // ---- 用户提单 ----

  async requestUpgrade(input: RequestUpgradeInput): Promise<{ id: string; totalYuan: number }> {
    const plan = findPlan(input.requestedPlanCode);
    if (!plan) {
      throw new KintsugiError('VALIDATION_FAILED', `unknown plan ${input.requestedPlanCode}`);
    }
    if (!plan.durationsMonths.includes(input.requestedDurationMonths)) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `plan ${plan.code} does not support duration=${input.requestedDurationMonths} months ` +
          `(allowed: ${plan.durationsMonths.join(', ')})`,
      );
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantCode: input.tenantCode },
      select: { tenantCode: true },
    });
    if (!tenant) {
      throw new KintsugiError('NOT_FOUND', `tenant ${input.tenantCode} not found`);
    }

    const row = await this.prisma.upgradeRequest.create({
      data: {
        tenantCode: input.tenantCode,
        requestedPlanCode: input.requestedPlanCode,
        requestedDurationMonths: input.requestedDurationMonths,
        contactName: input.contactName.trim(),
        contactEmail: input.contactEmail.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        note: input.note?.trim() || null,
      },
      select: { id: true },
    });
    const totalYuan = totalPriceYuan(plan, input.requestedDurationMonths);
    upgradeActionCounter.add(1, { action: 'request', outcome: 'ok' });
    this.logger.log(
      `[upgrade-request] ${row.id} tenant=${input.tenantCode} plan=${plan.code} ` +
        `duration=${input.requestedDurationMonths}m total=¥${totalYuan}`,
    );

    // 通知申请人 — fire-and-forget
    void this.mail
      .sendTemplate({
        to: input.contactEmail,
        template: TEMPLATE_NAMES.upgradeRequested,
        variables: {
          contact_name: input.contactName.trim(),
          request_id: row.id,
          tenant_code: input.tenantCode,
          plan_display_name: plan.displayName,
          duration_months: input.requestedDurationMonths,
          total_yuan: totalYuan,
          support_email: this.supportEmail,
        },
      })
      .catch((e) => this.logger.warn(`[upgrade-request] mail failed: ${(e as Error).message}`));

    return { id: row.id, totalYuan };
  }

  // ---- 管理端 ----

  async listAdminPending(opts: {
    page?: number;
    pageSize?: number;
    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  } = {}): Promise<{
    data: Array<{
      id: string;
      tenantCode: string;
      requestedPlanCode: string;
      requestedDurationMonths: number;
      contactName: string;
      contactEmail: string;
      phone: string | null;
      note: string | null;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
      reviewedBy: string | null;
      reviewNote: string | null;
      reviewedAt: Date | null;
      approvedExpiresAt: Date | null;
      createdAt: Date;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where = opts.status ? { status: opts.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.upgradeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.upgradeRequest.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async approveUpgrade(
    requestId: string,
    input: ApproveUpgradeInput,
  ): Promise<{ tenantCode: string; expiresAt: Date; aiCreditAdded: number }> {
    const req = await this.prisma.upgradeRequest.findUnique({ where: { id: requestId } });
    if (!req) {
      upgradeActionCounter.add(1, { action: 'approve', outcome: 'not_found' });
      throw new KintsugiError('NOT_FOUND', `upgrade-request ${requestId} not found`);
    }
    if (req.status !== 'PENDING') {
      upgradeActionCounter.add(1, { action: 'approve', outcome: 'conflict' });
      throw new KintsugiError(
        'CONFLICT',
        `upgrade-request ${requestId} is already ${req.status}`,
      );
    }
    const plan = findPlan(req.requestedPlanCode);
    if (!plan) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `requested plan ${req.requestedPlanCode} no longer exists; reject and ask user to re-pick`,
      );
    }

    // 提前续费：从 max(now, currentExpiresAt) 起算
    const now = new Date();
    const currentExpires = await this.prisma.tenant.findUnique({
      where: { tenantCode: req.tenantCode },
      select: { subscriptionExpiresAt: true, edition: true },
    });
    const baseTime =
      currentExpires?.subscriptionExpiresAt && currentExpires.subscriptionExpiresAt > now
        ? currentExpires.subscriptionExpiresAt
        : now;
    const newExpires = new Date(baseTime.getTime() + req.requestedDurationMonths * 30 * 86400_000);
    const aiCreditAdded = plan.monthlyAiCreditYuan * req.requestedDurationMonths;

    // 一次性 transaction：claim request → 升级 tenant
    try {
      await this.prisma.$transaction(async (tx) => {
        const claim = await tx.upgradeRequest.updateMany({
          where: { id: requestId, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            reviewedBy: input.reviewerUserId,
            reviewNote: input.reviewNote ?? null,
            reviewedAt: now,
            approvedExpiresAt: newExpires,
          },
        });
        if (claim.count === 0) {
          throw new KintsugiError(
            'CONFLICT',
            `upgrade-request ${requestId} concurrently approved/rejected`,
          );
        }
        await tx.tenant.update({
          where: { tenantCode: req.tenantCode },
          data: {
            edition: plan.edition,
            currentPlanCode: plan.code,
            subscriptionExpiresAt: newExpires,
            // 重置即将过期 / 已过期通知 — 让下次到期再触发提醒
            subscriptionExpiringNotifiedAt: null,
            subscriptionExpiredNotifiedAt: null,
            // 升级后 quota 同步到 plan 上限（plan.quota 里 null 表示不限，
            // 这里把字段设成 null —— Prisma 接受 null 写入意味着"不限"）
            maxDataSources: plan.quota.maxDataSources ?? null,
            maxDatasets: plan.quota.maxDatasets ?? null,
            maxDailyLlmCalls: plan.quota.maxDailyLlmCalls ?? null,
            // AI 余额累加（不替换）
            aiCredits: { increment: aiCreditAdded },
          },
        });
      });
    } catch (err) {
      if (err instanceof KintsugiError) throw err;
      throw err;
    }

    upgradeActionCounter.add(1, { action: 'approve', outcome: 'ok' });
    this.logger.log(
      `[upgrade-approve] ${requestId} tenant=${req.tenantCode} plan=${plan.code} → ` +
        `expires=${newExpires.toISOString()} (+¥${aiCreditAdded} AI credit)`,
    );

    void this.mail
      .sendTemplate({
        to: req.contactEmail,
        template: TEMPLATE_NAMES.upgradeApproved,
        variables: {
          contact_name: req.contactName,
          request_id: requestId,
          tenant_code: req.tenantCode,
          plan_display_name: plan.displayName,
          expires_at: newExpires.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          ai_credit_added: aiCreditAdded,
          billing_url: this.billingUrl,
          support_email: this.supportEmail,
        },
      })
      .catch((e) => this.logger.warn(`[upgrade-approve] mail failed: ${(e as Error).message}`));

    return { tenantCode: req.tenantCode, expiresAt: newExpires, aiCreditAdded };
  }

  async rejectUpgrade(
    requestId: string,
    reviewerUserId: string,
    reason?: string,
  ): Promise<{ ok: true }> {
    // 原子 claim：与 trial.reject 同款模式
    const before = await this.prisma.upgradeRequest.findUnique({
      where: { id: requestId },
      select: { contactEmail: true, contactName: true, status: true },
    });
    const claim = await this.prisma.upgradeRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerUserId,
        reviewNote: reason ?? null,
        reviewedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      if (!before) {
        upgradeActionCounter.add(1, { action: 'reject', outcome: 'not_found' });
        throw new KintsugiError('NOT_FOUND', `upgrade-request ${requestId} not found`);
      }
      upgradeActionCounter.add(1, { action: 'reject', outcome: 'conflict' });
      throw new KintsugiError(
        'CONFLICT',
        `upgrade-request ${requestId} is already ${before.status}`,
      );
    }
    upgradeActionCounter.add(1, { action: 'reject', outcome: 'ok' });
    this.logger.log(`[upgrade-reject] ${requestId} by ${reviewerUserId}`);

    if (before?.contactEmail) {
      void this.mail
        .sendTemplate({
          to: before.contactEmail,
          template: TEMPLATE_NAMES.upgradeRejected,
          variables: {
            contact_name: before.contactName,
            request_id: requestId,
            reason: reason ?? '',
            support_email: this.supportEmail,
          },
        })
        .catch((e) => this.logger.warn(`[upgrade-reject] mail failed: ${(e as Error).message}`));
    }
    return { ok: true };
  }

  // ---- 用户操作：开关自动续费 ----

  async setAutoRenew(tenantCode: string, autoRenew: boolean): Promise<{ autoRenew: boolean }> {
    await this.prisma.tenant.update({
      where: { tenantCode },
      data: { autoRenew },
    });
    return { autoRenew };
  }

  /** 给 AuthService.login 用：付费订阅是否过期。 */
  isSubscriptionExpired(t: { edition: string; subscriptionExpiresAt: Date | null }): boolean {
    if (t.edition === 'TRIAL') return false; // 试用走 trialExpiresAt 那条路径
    if (!t.subscriptionExpiresAt) return false; // 没设过期 → 不过期（可能是平台直建的 lifetime tenant）
    return t.subscriptionExpiresAt.getTime() < Date.now();
  }

  // ---- 内部工具 ----

  private get supportEmail(): string {
    return process.env['KINTSUGI_SUPPORT_EMAIL'] ?? 'support@kintsugi.example.com';
  }

  private get billingUrl(): string {
    return process.env['KINTSUGI_BILLING_URL'] ?? 'https://kintsugi.example.com/billing';
  }
}
