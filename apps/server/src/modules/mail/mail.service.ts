import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('kintsugi-mail');

/**
 * 邮件投递计数。labels:
 *   template = <模板 name>
 *   outcome  = ok | dry_run | error | disabled
 */
const mailCounter = meter.createCounter('kintsugi_mail_send_total', {
  description: 'Mailpilot send attempts via MailService.',
});

/**
 * Mailpilot HTTP 客户端 + 模板发送门面。
 *
 * 设计要点：
 *  - 发送是 fire-and-forget：mailpilot 本身就是异步队列（task_id + pending），
 *    SDK 调用立即返回；调用方业务流程不等邮件投递结果，邮件失败 warn-only，
 *    不阻塞 trial.apply / trial.approve 等关键路径。
 *  - 没配 MAILPILOT_BASE_URL / MAILPILOT_API_KEY → service 自动进 dry-run 模式：
 *    日志记一条 warn 但不抛错，方便本地 dev 不依赖外部服务。
 *  - 模板 name 维护在常量 TEMPLATE_NAMES（mail.templates.ts），随代码版本走；
 *    bootstrap 脚本（scripts/mail-bootstrap.ts）按这份常量在 mailpilot 项目里
 *    upsert 模板内容。
 *
 * 重试策略：mailpilot 服务自身有最大重试次数（max_retries 默认 3），所以这里
 * 不做客户端重试 —— 只关心"提交到 mailpilot 队列"这一步成功即可。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /**
   * fetch 的 override，仅供测试用（tests 直接 `new MailService()` 然后 svc.fetchImpl = mock）。
   *
   * **不**做构造器参数 —— Nest DI 看到带 type 的构造器参数会尝试 resolve，
   * 哪怕带默认值也照样查 token，找不到就启动期 throw（生产 MailModule 没注册
   * fetch provider，整个应用会启不来。round-13 first deploy 就栽这了）。
   */
  fetchImpl: typeof fetch = globalThis.fetch;

  /** 显式空 host / key → dry-run；运行时不抛。 */
  private isDryRun(): boolean {
    return !this.baseUrl || !this.apiKey;
  }

  private get baseUrl(): string {
    return (process.env['MAILPILOT_BASE_URL'] ?? '').replace(/\/+$/, '');
  }

  private get apiKey(): string {
    return process.env['MAILPILOT_API_KEY'] ?? '';
  }

  /** 全局 SMTP 配置 UUID（可空 → mailpilot 用项目默认配置）。 */
  private get smtpConfig(): string | null {
    return process.env['MAILPILOT_SMTP_CONFIG'] || null;
  }

  /**
   * 用模板发送邮件。立即返回 task_id 或 null（dry-run / 失败）。
   * 调用方业务路径不等结果，按 fire-and-forget 用。
   */
  async sendTemplate(input: {
    to: string | string[];
    template: string;
    variables?: Record<string, unknown>;
    cc?: string[];
    bcc?: string[];
  }): Promise<string | null> {
    const recipients = Array.isArray(input.to) ? input.to : [input.to];
    if (recipients.length === 0) {
      this.logger.warn(`[mail] sendTemplate ${input.template}: empty recipient list, skipped`);
      mailCounter.add(1, { template: input.template, outcome: 'error' });
      return null;
    }

    if (this.isDryRun()) {
      this.logger.warn(
        `[mail][dry-run] would send template=${input.template} to=${recipients.join(',')} ` +
          `vars=${JSON.stringify(input.variables ?? {})}`,
      );
      mailCounter.add(1, { template: input.template, outcome: 'dry_run' });
      return null;
    }

    const body: Record<string, unknown> = {
      to: recipients,
      template: input.template,
      variables: input.variables ?? {},
    };
    if (input.cc?.length) body['cc'] = input.cc;
    if (input.bcc?.length) body['bcc'] = input.bcc;
    const smtp = this.smtpConfig;
    if (smtp) body['smtp_config'] = smtp;

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/v1/send/template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(
          `[mail] mailpilot ${res.status} for template=${input.template}: ${text.slice(0, 200)}`,
        );
        mailCounter.add(1, { template: input.template, outcome: 'error' });
        return null;
      }
      const parsed = (() => {
        try {
          return JSON.parse(text) as { task_id?: string; status?: string };
        } catch {
          return null;
        }
      })();
      const taskId = parsed?.task_id ?? null;
      this.logger.log(
        `[mail] sent template=${input.template} to=${recipients.join(',')} task=${taskId}`,
      );
      mailCounter.add(1, { template: input.template, outcome: 'ok' });
      return taskId;
    } catch (err) {
      this.logger.warn(
        `[mail] send failed for template=${input.template}: ${(err as Error).message}`,
      );
      mailCounter.add(1, { template: input.template, outcome: 'error' });
      return null;
    }
  }

  /** Bootstrap 用：按 name 取模板，用于 upsert 判断"是新建还是更新"。 */
  async getTemplateByName(name: string): Promise<unknown | null> {
    if (this.isDryRun()) return null;
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/templates/${encodeURIComponent(name)}`,
      {
        headers: { 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`mailpilot getTemplate ${name} → ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  /** Bootstrap 用：创建模板。 */
  async createTemplate(tpl: {
    name: string;
    subject: string;
    body_html: string;
    body_text?: string;
    description?: string;
  }): Promise<void> {
    if (this.isDryRun()) {
      this.logger.warn(`[mail][dry-run] would create template ${tpl.name}`);
      return;
    }
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(tpl),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`mailpilot createTemplate ${tpl.name} → ${res.status}: ${await res.text()}`);
    }
  }

  /** Bootstrap 用：更新模板（PUT，部分字段）。 */
  async updateTemplate(
    name: string,
    patch: { subject?: string; body_html?: string; body_text?: string; description?: string },
  ): Promise<void> {
    if (this.isDryRun()) {
      this.logger.warn(`[mail][dry-run] would update template ${name}`);
      return;
    }
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/templates/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      throw new Error(`mailpilot updateTemplate ${name} → ${res.status}: ${await res.text()}`);
    }
  }
}
