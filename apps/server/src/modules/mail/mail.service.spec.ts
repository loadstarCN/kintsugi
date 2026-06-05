import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MailService } from './mail.service';

describe('MailService', () => {
  const ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV };
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    delete process.env['MAILPILOT_BASE_URL'];
    delete process.env['MAILPILOT_API_KEY'];
    delete process.env['MAILPILOT_SMTP_CONFIG'];
  });

  it('dry-run: 没设 BASE_URL/API_KEY → 不调 fetch + 返回 null', async () => {
    const fetchMock = vi.fn();
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    const r = await svc.sendTemplate({
      to: 'a@b.com',
      template: 'kintsugi_trial_apply_received',
      variables: { x: 1 },
    });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('真发：post 到 /api/v1/send/template 含 X-API-Key + smtp_config（如设）', async () => {
    process.env['MAILPILOT_BASE_URL'] = 'https://mailpilot.example.com';
    process.env['MAILPILOT_API_KEY'] = 'k_test';
    process.env['MAILPILOT_SMTP_CONFIG'] = 'uuid-1';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task_id: 't-1', status: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    const taskId = await svc.sendTemplate({
      to: ['a@b.com', 'c@d.com'],
      template: 'kintsugi_trial_approved',
      variables: { contact_name: 'X' },
    });
    expect(taskId).toBe('t-1');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://mailpilot.example.com/api/v1/send/template');
    expect((init as { headers: Record<string, string> }).headers['X-API-Key']).toBe('k_test');
    const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>;
    expect(body['template']).toBe('kintsugi_trial_approved');
    expect(body['to']).toEqual(['a@b.com', 'c@d.com']);
    expect(body['smtp_config']).toBe('uuid-1');
    expect(body['variables']).toEqual({ contact_name: 'X' });
  });

  it('mailpilot 4xx → warn + 返回 null（不抛）', async () => {
    process.env['MAILPILOT_BASE_URL'] = 'https://mailpilot.example.com';
    process.env['MAILPILOT_API_KEY'] = 'k';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"detail":"bad"}', { status: 400 }),
    );
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    const r = await svc.sendTemplate({ to: 'a@b', template: 'x', variables: {} });
    expect(r).toBeNull();
  });

  it('网络异常 → 返回 null（不抛 → 业务流程不被邮件挂起）', async () => {
    process.env['MAILPILOT_BASE_URL'] = 'https://mailpilot.example.com';
    process.env['MAILPILOT_API_KEY'] = 'k';
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    const r = await svc.sendTemplate({ to: 'a@b', template: 'x', variables: {} });
    expect(r).toBeNull();
  });

  it('空 to[] → warn + null，不打 fetch', async () => {
    process.env['MAILPILOT_BASE_URL'] = 'https://mailpilot.example.com';
    process.env['MAILPILOT_API_KEY'] = 'k';
    const fetchMock = vi.fn();
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    const r = await svc.sendTemplate({ to: [], template: 'x', variables: {} });
    expect(r).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createTemplate / getTemplateByName / updateTemplate 在 dry-run 不抛', async () => {
    const fetchMock = vi.fn();
    const svc = Object.assign(new MailService(), { fetchImpl: fetchMock });
    await expect(
      svc.createTemplate({ name: 't', subject: 's', body_html: '<p>x</p>' }),
    ).resolves.toBeUndefined();
    expect(await svc.getTemplateByName('t')).toBeNull();
    await expect(svc.updateTemplate('t', { subject: 's2' })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
