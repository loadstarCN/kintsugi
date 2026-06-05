/**
 * 邮件模板定义（中文）。
 *
 * 模板 name 是与 mailpilot 项目内的唯一标识（同项目唯一）；
 * subject / body 都是 Jinja2，变量在 {{ var }} 占位。
 *
 * 维护规则：
 *  - 改任何模板（subject / body_html / body_text / description）→ 跑
 *    pnpm --filter @kintsugi/server mail:bootstrap 同步到 mailpilot
 *  - 上面那个脚本是 idempotent 的：name 已存在用 PUT，不存在用 POST
 *  - 模板里的变量名要和 trial.service / scheduler.service 调用 sendTemplate
 *    时传的 variables 对得上
 */

export const TEMPLATE_NAMES = {
  trialApplyReceived: 'kintsugi_trial_apply_received',
  trialApproved: 'kintsugi_trial_approved',
  trialRejected: 'kintsugi_trial_rejected',
  trialExpiringSoon: 'kintsugi_trial_expiring_soon',
  trialExpired: 'kintsugi_trial_expired',
  upgradeRequested: 'kintsugi_upgrade_requested',
  upgradeApproved: 'kintsugi_upgrade_approved',
  upgradeRejected: 'kintsugi_upgrade_rejected',
  subscriptionExpiringSoon: 'kintsugi_subscription_expiring_soon',
  subscriptionExpired: 'kintsugi_subscription_expired',
} as const;

export interface TemplateDef {
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  description: string;
}

const COMMON_FOOTER_HTML = `
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="color:#94a3b8;font-size:12px;margin:0;">
    本邮件由 Kintsugi 锦缮平台自动发送，请勿直接回复。
    如有疑问请联系 <a href="mailto:{{ support_email }}">{{ support_email }}</a>
  </p>
`;

const COMMON_FOOTER_TEXT = `
---
本邮件由 Kintsugi 锦缮平台自动发送，请勿直接回复。
如有疑问请联系 {{ support_email }}
`;

export const TEMPLATES: TemplateDef[] = [
  {
    name: TEMPLATE_NAMES.trialApplyReceived,
    description: '试用申请已收到 — 提交确认',
    subject: 'Kintsugi 试用申请已收到',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>我们已经收到您的 Kintsugi 锦缮平台试用申请。申请编号：<b>{{ application_id }}</b></p>
        <p>平台运营同事会在 1~2 个工作日内审核您的资料；审核结果会通过本邮箱另行通知。</p>
        <p>如需补充说明或调整需求，请回复此邮件，或联系我们的客户成功团队。</p>
        <p style="color:#64748b;font-size:13px;">提交时间：{{ submitted_at }}</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

我们已经收到您的 Kintsugi 锦缮平台试用申请。申请编号：{{ application_id }}

平台运营同事会在 1~2 个工作日内审核您的资料；审核结果会通过本邮箱另行通知。

如需补充说明或调整需求，请回复此邮件，或联系我们的客户成功团队。

提交时间：{{ submitted_at }}` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.trialApproved,
    description: '试用申请通过 — 含临时账号 + 登录入口',
    subject: 'Kintsugi 试用申请已通过 — 您的账号已开通',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您的 Kintsugi 试用申请已通过审核。我们为您开通了 <b>{{ trial_days }}</b> 天的试用账号：</p>

        <div style="background:#f5f1e8;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:16px 0;font-family:Menlo,Consolas,monospace;font-size:14px;">
          <div>登录地址：<a href="{{ login_url }}">{{ login_url }}</a></div>
          <div>租户编码（tenantCode）：<b>{{ tenant_code }}</b></div>
          <div>用户名（username）：<b>{{ username }}</b></div>
          <div>临时密码：<b style="color:#a07b3f;">{{ temp_password }}</b></div>
        </div>

        <p style="color:#b91c1c;"><b>请尽快首次登录并修改密码。</b>临时密码仅供首次登录使用。</p>

        <p>试用期内您可以使用：</p>
        <ul>
          <li>{{ max_data_sources }} 个数据源、{{ max_datasets }} 个数据集</li>
          <li>每天 {{ max_daily_llm_calls }} 次 AI 问数 / 报表调用</li>
          <li>初始 AI 余额 {{ ai_credit_init }} 元</li>
        </ul>

        <p>试用截止时间：<b>{{ expires_at }}</b>（北京时间）。期间欢迎随时联系我们升级到正式版本。</p>

        <p style="color:#64748b;font-size:13px;">本次审批申请编号：{{ application_id }}</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您的 Kintsugi 试用申请已通过审核。我们为您开通了 {{ trial_days }} 天的试用账号：

登录地址：{{ login_url }}
租户编码：{{ tenant_code }}
用户名：{{ username }}
临时密码：{{ temp_password }}

请尽快首次登录并修改密码。临时密码仅供首次登录使用。

试用期内您可以使用：
- {{ max_data_sources }} 个数据源、{{ max_datasets }} 个数据集
- 每天 {{ max_daily_llm_calls }} 次 AI 问数 / 报表调用
- 初始 AI 余额 {{ ai_credit_init }} 元

试用截止时间：{{ expires_at }}（北京时间）。
期间欢迎随时联系我们升级到正式版本。

本次审批申请编号：{{ application_id }}` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.trialRejected,
    description: '试用申请被拒 — 含原因（可选）',
    subject: '关于您的 Kintsugi 试用申请',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>非常感谢您对 Kintsugi 锦缮平台的关注。经过我们的审核，本次试用申请暂未通过：</p>
        {% if reason %}
        <blockquote style="margin:0 0 16px;padding:12px 16px;background:#fafaf7;border-left:3px solid #a07b3f;color:#475569;">
          {{ reason }}
        </blockquote>
        {% endif %}
        <p>如您后续有新的合作需求或希望了解更多产品方案，欢迎随时联系我们。</p>
        <p style="color:#64748b;font-size:13px;">本次申请编号：{{ application_id }}</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

非常感谢您对 Kintsugi 锦缮平台的关注。经过我们的审核，本次试用申请暂未通过：

{% if reason %}{{ reason }}

{% endif %}如您后续有新的合作需求或希望了解更多产品方案，欢迎随时联系我们。

本次申请编号：{{ application_id }}` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.trialExpiringSoon,
    description: '试用即将过期 — 默认 3 天前提醒',
    subject: 'Kintsugi 试用账号将在 {{ days_remaining }} 天后到期',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您在 Kintsugi 锦缮平台的试用账号 <b>{{ tenant_code }}</b> 将于 <b>{{ expires_at }}</b> 到期，
        距离到期还有 <b>{{ days_remaining }}</b> 天。</p>
        <p>到期后，账号会暂时停止登录；试用期内创建的数据集 / 页面 / SQL / BFF 等元数据会保留，
        升级到正式版本后无缝继续可用。</p>
        <p>如需续费或升级到正式版本，请联系平台运营同事或回复此邮件。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您在 Kintsugi 锦缮平台的试用账号 {{ tenant_code }} 将于 {{ expires_at }} 到期，距离到期还有 {{ days_remaining }} 天。

到期后，账号会暂时停止登录；试用期内创建的数据集 / 页面 / SQL / BFF 等元数据会保留，
升级到正式版本后无缝继续可用。

如需续费或升级到正式版本，请联系平台运营同事或回复此邮件。` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.trialExpired,
    description: '试用已到期 — 续费引导',
    subject: 'Kintsugi 试用账号已到期',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您在 Kintsugi 锦缮平台的试用账号 <b>{{ tenant_code }}</b> 已于 <b>{{ expires_at }}</b> 到期，
        当前已暂停登录。</p>
        <p>试用期内创建的所有数据资产仍然保留，升级到正式版本后立即恢复全部权限，无需迁移。</p>
        <p>如希望升级到正式版本，请回复此邮件或联系您的客户成功负责人。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您在 Kintsugi 锦缮平台的试用账号 {{ tenant_code }} 已于 {{ expires_at }} 到期，
当前已暂停登录。

试用期内创建的所有数据资产仍然保留，升级到正式版本后立即恢复全部权限，无需迁移。

如希望升级到正式版本，请回复此邮件或联系您的客户成功负责人。` + COMMON_FOOTER_TEXT,
  },

  // -------- 付费升级 / 续费 --------

  {
    name: TEMPLATE_NAMES.upgradeRequested,
    description: '升级 / 续费请求已收到',
    subject: 'Kintsugi 升级请求已收到',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>我们已经收到您的 Kintsugi 升级 / 续费请求。请求编号：<b>{{ request_id }}</b></p>
        <ul>
          <li>租户：<b>{{ tenant_code }}</b></li>
          <li>套餐：<b>{{ plan_display_name }}</b></li>
          <li>购买时长：<b>{{ duration_months }}</b> 个月</li>
          <li>金额合计：<b>¥{{ total_yuan }}</b></li>
        </ul>
        <p>平台财务 / 商务同事会与您确认付款方式（对公转账 / 微信 / 支付宝），
        付款到账后我们会立即开通新订阅；订阅生效后会再发一封确认邮件。</p>
        <p>如有问题请回复此邮件，或联系您的客户成功负责人。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

我们已经收到您的 Kintsugi 升级 / 续费请求。请求编号：{{ request_id }}

  · 租户：{{ tenant_code }}
  · 套餐：{{ plan_display_name }}
  · 购买时长：{{ duration_months }} 个月
  · 金额合计：¥{{ total_yuan }}

平台财务 / 商务同事会与您确认付款方式（对公转账 / 微信 / 支付宝），
付款到账后我们会立即开通新订阅；订阅生效后会再发一封确认邮件。

如有问题请回复此邮件，或联系您的客户成功负责人。` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.upgradeApproved,
    description: '升级 / 续费已开通',
    subject: 'Kintsugi 升级已开通 — {{ plan_display_name }}',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您的 Kintsugi 订阅已开通：</p>

        <div style="background:#f5f1e8;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin:16px 0;font-family:Menlo,Consolas,monospace;font-size:14px;">
          <div>租户：<b>{{ tenant_code }}</b></div>
          <div>套餐：<b>{{ plan_display_name }}</b></div>
          <div>到期时间：<b style="color:#a07b3f;">{{ expires_at }}</b>（北京时间）</div>
          <div>本次充值 AI 余额：<b>+¥{{ ai_credit_added }}</b></div>
        </div>

        <p>所有现有数据资产无缝继续可用，无需迁移；之前试用期内的限制已自动解除。</p>
        <p>到期前 7 天我们会发提醒邮件；如需调整套餐或开启自动续费，请到平台后台
        「<a href="{{ billing_url }}">订阅与计费</a>」页面操作。</p>
        <p style="color:#64748b;font-size:13px;">本次开通对应的请求编号：{{ request_id }}</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您的 Kintsugi 订阅已开通：

  · 租户：{{ tenant_code }}
  · 套餐：{{ plan_display_name }}
  · 到期时间：{{ expires_at }}（北京时间）
  · 本次充值 AI 余额：+¥{{ ai_credit_added }}

所有现有数据资产无缝继续可用，无需迁移；之前试用期内的限制已自动解除。

到期前 7 天我们会发提醒邮件；如需调整套餐或开启自动续费，
请到平台后台「订阅与计费」页面操作（{{ billing_url }}）。

本次开通对应的请求编号：{{ request_id }}` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.upgradeRejected,
    description: '升级 / 续费请求被拒（一般是付款异常 / 资料不全）',
    subject: '关于您的 Kintsugi 升级请求',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您的 Kintsugi 升级 / 续费请求 <b>{{ request_id }}</b> 暂未通过：</p>
        {% if reason %}
        <blockquote style="margin:0 0 16px;padding:12px 16px;background:#fafaf7;border-left:3px solid #a07b3f;color:#475569;">
          {{ reason }}
        </blockquote>
        {% endif %}
        <p>当前订阅状态没有变化。如希望重新提交，请到「订阅与计费」页面再次提单，
        或回复此邮件与商务同事直接对接。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您的 Kintsugi 升级 / 续费请求 {{ request_id }} 暂未通过：

{% if reason %}{{ reason }}

{% endif %}当前订阅状态没有变化。如希望重新提交，请到「订阅与计费」页面再次提单，
或回复此邮件与商务同事直接对接。` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.subscriptionExpiringSoon,
    description: '付费订阅即将到期 — 默认到期前 7 天',
    subject: 'Kintsugi 订阅 {{ plan_display_name }} 将在 {{ days_remaining }} 天后到期',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您的 Kintsugi 订阅 <b>{{ plan_display_name }}</b>（租户 <b>{{ tenant_code }}</b>）
        将于 <b>{{ expires_at }}</b> 到期，距离到期还有 <b>{{ days_remaining }}</b> 天。</p>
        <p>到期后账号将停止登录；现有数据资产保留，续费后立即恢复访问。</p>
        <p>请到「<a href="{{ billing_url }}">订阅与计费</a>」页面提交续费请求，
        或直接回复此邮件由商务同事帮您续期。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您的 Kintsugi 订阅 {{ plan_display_name }}（租户 {{ tenant_code }}）
将于 {{ expires_at }} 到期，距离到期还有 {{ days_remaining }} 天。

到期后账号将停止登录；现有数据资产保留，续费后立即恢复访问。

请到「订阅与计费」页面提交续费请求（{{ billing_url }}），
或直接回复此邮件由商务同事帮您续期。` + COMMON_FOOTER_TEXT,
  },

  {
    name: TEMPLATE_NAMES.subscriptionExpired,
    description: '付费订阅已到期 — 续费引导',
    subject: 'Kintsugi 订阅 {{ plan_display_name }} 已到期',
    body_html:
      `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#0f172a;line-height:1.7;">
        <p>{{ contact_name }}，您好：</p>
        <p>您的 Kintsugi 订阅 <b>{{ plan_display_name }}</b>（租户 <b>{{ tenant_code }}</b>）
        已于 <b>{{ expires_at }}</b> 到期，账号已暂停登录。</p>
        <p>所有数据资产仍然保留；续费后立即恢复访问。请到「<a href="{{ billing_url }}">订阅与计费</a>」
        页面提交续费请求，或回复此邮件与商务同事直接对接。</p>
      </div>
    ` + COMMON_FOOTER_HTML,
    body_text:
      `{{ contact_name }}，您好：

您的 Kintsugi 订阅 {{ plan_display_name }}（租户 {{ tenant_code }}）
已于 {{ expires_at }} 到期，账号已暂停登录。

所有数据资产仍然保留；续费后立即恢复访问。
请到「订阅与计费」页面提交续费请求（{{ billing_url }}），
或回复此邮件与商务同事直接对接。` + COMMON_FOOTER_TEXT,
  },
];
