import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { KintsugiError } from '@kintsugi/shared';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { TEMPLATE_NAMES } from '../mail/mail.templates';

const meter = metrics.getMeter('kintsugi-trial');
/**
 * Trial application 流转计数。labels:
 *   action=apply | approve | reject
 *   outcome=ok | dup | conflict | not_found | error
 */
const trialActionCounter = meter.createCounter('kintsugi_trial_application_total', {
  description: 'Trial application lifecycle events (apply/approve/reject).',
});

/**
 * 试用账户参数。env 可覆盖让平台方调档。
 *
 * 限制策略（默认值）：
 *   · 期限：14 天 (TRIAL_DAYS)
 *   · 数据源：1 个 (TRIAL_MAX_DATASOURCES)
 *   · 数据集：3 个 (TRIAL_MAX_DATASETS)
 *   · 每天 LLM 调用：50 次 (TRIAL_MAX_DAILY_LLM_CALLS)
 *   · AI credit：5 元 (TRIAL_AI_CREDIT_INIT)
 *
 * 试用过期后 AuthService.login 拒绝；现有 access key 也按 quota / aiCredits 限。
 */
function trialDays(): number {
  return Number(process.env['TRIAL_DAYS'] ?? '14');
}
function trialDefaults(): {
  maxDataSources: number;
  maxDatasets: number;
  maxDailyLlmCalls: number;
  initCredit: number;
} {
  return {
    maxDataSources: Number(process.env['TRIAL_MAX_DATASOURCES'] ?? '1'),
    maxDatasets: Number(process.env['TRIAL_MAX_DATASETS'] ?? '3'),
    maxDailyLlmCalls: Number(process.env['TRIAL_MAX_DAILY_LLM_CALLS'] ?? '50'),
    initCredit: Number(process.env['TRIAL_AI_CREDIT_INIT'] ?? '5'),
  };
}

export interface ApplyInput {
  contactName: string;
  email: string;
  phone?: string;
  company?: string;
  useCase?: string;
}

export interface ApproveInput {
  /** 平台方分配给申请人的 tenantCode（短业务可读串，如 'acme'） */
  tenantCode: string;
  /** 平台方分配的 tenantName（中文显示名） */
  tenantName: string;
  /** 首位 admin user 的 username + 一次性临时密码 */
  username: string;
  password: string;
  /** review note （可选）写进 reviewNote */
  note?: string;
  /** 审批者 user.id */
  reviewerUserId: string;
}

@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 邮件可选 —— 单测构造 service 时不必传；service 内部也是 fire-and-forget
    private readonly mail?: MailService,
  ) {}

  private get supportEmail(): string {
    return process.env['KINTSUGI_SUPPORT_EMAIL'] ?? 'support@kintsugi.example.com';
  }

  private get loginUrl(): string {
    return process.env['KINTSUGI_LOGIN_URL'] ?? 'https://kintsugi.example.com/login';
  }

  /** 发送邮件，失败仅 warn 不抛 —— 业务流程不受邮件影响。 */
  private async safeSend(
    template: string,
    to: string,
    variables: Record<string, unknown>,
  ): Promise<void> {
    if (!this.mail) return;
    try {
      await this.mail.sendTemplate({
        template,
        to,
        variables: { ...variables, support_email: this.supportEmail },
      });
    } catch (err) {
      this.logger.warn(
        `[trial] mail ${template} → ${to} failed: ${(err as Error).message}`,
      );
    }
  }

  // -------- 公开 apply --------

  async apply(input: ApplyInput): Promise<{ id: string }> {
    const email = input.email.trim().toLowerCase();
    // 快速 dedup（happy path 用户友好）：同 email + PENDING 已存在 → 拒
    const exists = await this.prisma.trialApplication.findFirst({
      where: { email, status: 'PENDING' },
      select: { id: true },
    });
    if (exists) {
      trialActionCounter.add(1, { action: 'apply', outcome: 'dup' });
      throw new KintsugiError(
        'CONFLICT',
        `email ${input.email} already has a pending application`,
      );
    }
    // DB 层兜底：migration 加了 partial unique index "(email) WHERE status='PENDING'"
    // 防 findFirst → create 两步之间的 race window（两并发 insert 时第二个 P2002）。
    try {
      const row = await this.prisma.trialApplication.create({
        data: {
          contactName: input.contactName.trim(),
          email,
          phone: input.phone?.trim() || null,
          company: input.company?.trim() || null,
          useCase: input.useCase?.trim() || null,
        },
        select: { id: true },
      });
      trialActionCounter.add(1, { action: 'apply', outcome: 'ok' });
      this.logger.log(
        `[trial-apply] new application from ${email} (${input.company ?? '-'})`,
      );
      // 异步通知申请人 —— fire-and-forget，邮件失败不阻塞 API 响应
      void this.safeSend(TEMPLATE_NAMES.trialApplyReceived, email, {
        contact_name: input.contactName.trim(),
        application_id: row.id,
        submitted_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      });
      return { id: row.id };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        trialActionCounter.add(1, { action: 'apply', outcome: 'dup' });
        throw new KintsugiError(
          'CONFLICT',
          `email ${input.email} already has a pending application`,
        );
      }
      throw err;
    }
  }

  // -------- admin --------

  async listPending(opts: { page?: number; pageSize?: number; status?: 'PENDING' | 'APPROVED' | 'REJECTED' } = {}): Promise<{
    data: Array<{
      id: string;
      contactName: string;
      email: string;
      phone: string | null;
      company: string | null;
      useCase: string | null;
      status: 'PENDING' | 'APPROVED' | 'REJECTED';
      approvedTenantCode: string | null;
      reviewedBy: string | null;
      reviewNote: string | null;
      createdAt: Date;
      reviewedAt: Date | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where = opts.status ? { status: opts.status } : {};
    const [data, total] = await Promise.all([
      this.prisma.trialApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.trialApplication.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async approve(applicationId: string, input: ApproveInput): Promise<{
    tenantCode: string;
    userId: string;
  }> {
    const app = await this.prisma.trialApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) {
      trialActionCounter.add(1, { action: 'approve', outcome: 'not_found' });
      throw new KintsugiError('NOT_FOUND', `application ${applicationId} not found`);
    }
    if (app.status !== 'PENDING') {
      trialActionCounter.add(1, { action: 'approve', outcome: 'conflict' });
      throw new KintsugiError(
        'CONFLICT',
        `application ${applicationId} is already ${app.status}`,
      );
    }

    // 检查 tenantCode 不冲突
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { tenantCode: input.tenantCode },
      select: { tenantCode: true },
    });
    if (existingTenant) {
      trialActionCounter.add(1, { action: 'approve', outcome: 'conflict' });
      throw new KintsugiError(
        'CONFLICT',
        `tenantCode '${input.tenantCode}' already exists`,
      );
    }

    const defaults = trialDefaults();
    const expiresAt = new Date(Date.now() + trialDays() * 86400_000);

    // 一次性 transaction：claim application (PENDING → APPROVED) → 建 Tenant → 建 admin User
    // claim 用 updateMany WHERE status='PENDING' 防止两个 admin 同时 approve 同一条。
    const passwordHash = await bcrypt.hash(input.password, 10);
    let result: { tenantCode: string; userId: string };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // (1) 原子 claim — 第二个并发 approve 调到这条会得到 count=0
        const claim = await tx.trialApplication.updateMany({
          where: { id: applicationId, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            approvedTenantCode: input.tenantCode,
            reviewedBy: input.reviewerUserId,
            reviewNote: input.note ?? null,
            reviewedAt: new Date(),
          },
        });
        if (claim.count === 0) {
          throw new KintsugiError(
            'CONFLICT',
            `application ${applicationId} was concurrently approved/rejected`,
          );
        }
        // (2) 建 tenant；P2002 由外层 catch 转 CONFLICT（tenantCode race / 重名）
        const tenant = await tx.tenant.create({
          data: {
            tenantCode: input.tenantCode,
            tenantName: input.tenantName,
            edition: 'TRIAL',
            aiCredits: defaults.initCredit,
            maxDataSources: defaults.maxDataSources,
            maxDatasets: defaults.maxDatasets,
            maxDailyLlmCalls: defaults.maxDailyLlmCalls,
            trialExpiresAt: expiresAt,
          },
        });
        // (3) 建 admin user
        const user = await tx.user.create({
          data: {
            tenantCode: tenant.tenantCode,
            username: input.username,
            email: app.email,
            phone: app.phone,
            passwordHash,
          },
          select: { id: true },
        });
        return { tenantCode: tenant.tenantCode, userId: user.id };
      });
    } catch (err) {
      // P2002 = unique constraint violation（tenantCode PK 冲突 / username 冲突）
      const code = (err as { code?: string }).code;
      if (code === 'P2002') {
        trialActionCounter.add(1, { action: 'approve', outcome: 'conflict' });
        throw new KintsugiError(
          'CONFLICT',
          `tenantCode '${input.tenantCode}' or username already exists`,
        );
      }
      // 已经是 KintsugiError → 透传 + 保 metric
      if (err instanceof KintsugiError) {
        if (err.code === 'CONFLICT') {
          trialActionCounter.add(1, { action: 'approve', outcome: 'conflict' });
        }
        throw err;
      }
      throw err;
    }

    trialActionCounter.add(1, { action: 'approve', outcome: 'ok' });
    this.logger.log(
      `[trial-approve] ${applicationId} → tenant=${result.tenantCode} user=${result.userId} ` +
        `expires=${expiresAt.toISOString()}`,
    );
    // 异步通知申请人 —— 含临时密码 / 登录入口 / 试用配额
    void this.safeSend(TEMPLATE_NAMES.trialApproved, app.email, {
      contact_name: app.contactName,
      application_id: applicationId,
      tenant_code: result.tenantCode,
      username: input.username,
      temp_password: input.password,
      login_url: this.loginUrl,
      trial_days: trialDays(),
      expires_at: expiresAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      max_data_sources: defaults.maxDataSources,
      max_datasets: defaults.maxDatasets,
      max_daily_llm_calls: defaults.maxDailyLlmCalls,
      ai_credit_init: defaults.initCredit,
    });
    return result;
  }

  async reject(applicationId: string, reviewerUserId: string, note?: string): Promise<{ ok: true }> {
    // 先抓 contact 信息给后面发邮件用（claim 之后状态变 REJECTED 仍能查到）
    const before = await this.prisma.trialApplication.findUnique({
      where: { id: applicationId },
      select: { email: true, contactName: true, status: true },
    });
    // 原子 claim — 两个 admin 同时 reject 同一条只放行一个；同时也防 approve/reject race。
    const claim = await this.prisma.trialApplication.updateMany({
      where: { id: applicationId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerUserId,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      // 区分 not_found vs conflict（已被 approve/reject）
      const app = await this.prisma.trialApplication.findUnique({
        where: { id: applicationId },
        select: { status: true },
      });
      if (!app) {
        trialActionCounter.add(1, { action: 'reject', outcome: 'not_found' });
        throw new KintsugiError('NOT_FOUND', `application ${applicationId} not found`);
      }
      trialActionCounter.add(1, { action: 'reject', outcome: 'conflict' });
      throw new KintsugiError(
        'CONFLICT',
        `application ${applicationId} is already ${app.status}`,
      );
    }
    trialActionCounter.add(1, { action: 'reject', outcome: 'ok' });
    this.logger.log(`[trial-reject] ${applicationId} by ${reviewerUserId}`);
    // 异步通知申请人（before 至少含 email + contactName 时才发，少见的 race
    // 情况下 before=null 但 claim 仍然 count>=1 是不可能的 —— PENDING 行还在）
    if (before?.email) {
      void this.safeSend(TEMPLATE_NAMES.trialRejected, before.email, {
        contact_name: before.contactName,
        application_id: applicationId,
        reason: note ?? '',
      });
    }
    return { ok: true };
  }

  /** 给 AuthService.login / 调用方查 trial 是否过期。返回 true = 过期 / 应拒。 */
  isTrialExpired(t: { edition: string; trialExpiresAt: Date | null }): boolean {
    if (t.edition !== 'TRIAL') return false;
    if (!t.trialExpiresAt) return false; // 没设过期时间 → 不过期
    return t.trialExpiresAt.getTime() < Date.now();
  }

  /** 一次性 nonce password 生成（admin 调用 approve 时用，避免管理员手敲弱口令） */
  generateTempPassword(): string {
    return crypto.randomBytes(12).toString('base64url');
  }
}
