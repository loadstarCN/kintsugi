/**
 * 把 src/modules/mail/mail.templates.ts 里定义的所有模板 idempotent 地
 * upsert 到 mailpilot 项目里。
 *
 * 触发：模板内容（subject / body / description）改了，跑一次：
 *   pnpm --filter @kintsugi/server mail:bootstrap
 *
 * env 必填：
 *   MAILPILOT_BASE_URL=https://mailpilot.example.com
 *   MAILPILOT_API_KEY=<your-api-key>
 *
 * 流程：
 *  1) GET /templates/{name} → 404 → POST /templates 新建
 *  2) GET /templates/{name} → 200 → PUT /templates/{name} 部分更新
 *  3) 对每个模板都跑一遍，相互独立；任一失败立即抛错（CI / 本地都该红）
 *
 * 不删除：脚本不会清理 mailpilot 上多余的模板（手动管理）。
 */

import { MailService } from '../src/modules/mail/mail.service';
import { TEMPLATES } from '../src/modules/mail/mail.templates';

async function main(): Promise<void> {
  if (!process.env['MAILPILOT_BASE_URL'] || !process.env['MAILPILOT_API_KEY']) {
    console.error(
      '✗ MAILPILOT_BASE_URL 和 MAILPILOT_API_KEY 必填；本地调试可在 .env 里写好后再跑',
    );
    process.exit(1);
  }

  const svc = new MailService();
  let created = 0;
  let updated = 0;

  for (const tpl of TEMPLATES) {
    const exists = await svc.getTemplateByName(tpl.name);
    if (exists) {
      await svc.updateTemplate(tpl.name, {
        subject: tpl.subject,
        body_html: tpl.body_html,
        body_text: tpl.body_text,
        description: tpl.description,
      });
      updated += 1;
      console.log(`  ↻ updated: ${tpl.name}`);
    } else {
      await svc.createTemplate(tpl);
      created += 1;
      console.log(`  ✓ created: ${tpl.name}`);
    }
  }

  console.log(
    `\nmail bootstrap done — created ${created}, updated ${updated} of ${TEMPLATES.length} templates`,
  );
}

main().catch((err) => {
  console.error('✗ mail bootstrap failed:', err);
  process.exit(1);
});
