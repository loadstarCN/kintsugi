import { Alert, Button, Form, Input, Typography } from 'antd';
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { message } from '../notify';
import { COLORS, FONTS, GOLD_RULE_HORIZONTAL } from '../theme';

interface ApplyForm {
  contactName: string;
  email: string;
  phone?: string;
  company?: string;
  useCase?: string;
}

/**
 * 申请试用页。提交后写入 TrialApplication（PENDING），平台方审批通过会拿到一封
 * 含临时密码的邮件（邮件流尚未实现，目前管理员手动通知）。
 *
 * 商业系统：公开 register 已关闭；新租户唯一入口就是这条 + 平台方直建。
 */
export function ApplyPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ id: string } | null>(null);

  const submit = async (values: ApplyForm) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ id: string }>('/trial/apply', {
        contactName: values.contactName.trim(),
        email: values.email.trim().toLowerCase(),
        ...(values.phone?.trim() ? { phone: values.phone.trim() } : {}),
        ...(values.company?.trim() ? { company: values.company.trim() } : {}),
        ...(values.useCase?.trim() ? { useCase: values.useCase.trim() } : {}),
      });
      setDone(r);
      message.success('申请已提交');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('该邮箱已有 PENDING 申请，请耐心等待审批通知');
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: COLORS.paper,
        color: COLORS.ink,
        fontFamily: FONTS.ui,
        display: 'grid',
        placeItems: 'center',
        padding: '48px 24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <Header />

        {done ? (
          <SuccessPanel applicationId={done.id} onBack={() => navigate('/login')} />
        ) : (
          <FormPanel busy={busy} err={err} onSubmit={submit} setErr={setErr} />
        )}

        <FooterMeta />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: COLORS.gold,
          marginBottom: 12,
        }}
      >
        ⟡ Trial Application · 申请试用
      </div>
      <Typography.Title
        level={2}
        style={{
          fontFamily: FONTS.serif,
          fontWeight: 600,
          margin: '0 0 12px',
          color: COLORS.ink,
        }}
      >
        申请使用 Kintsugi
      </Typography.Title>
      <Typography.Paragraph
        style={{ color: COLORS.muted, marginBottom: 0, fontSize: 14, lineHeight: 1.7 }}
      >
        Kintsugi 是商业产品，新租户走<strong style={{ color: COLORS.ink }}>申请审批 → 平台方建账户</strong>流程。提交后我们会在 1-2 个工作日内回复，
        审批通过将开通试用账户（14 天 · 1 个数据源 · 3 个数据集 · 50 次/天 LLM 调用）。
      </Typography.Paragraph>
      <div style={{ height: 1, background: GOLD_RULE_HORIZONTAL, marginTop: 24 }} />
    </div>
  );
}

function FormPanel(props: {
  busy: boolean;
  err: string | null;
  setErr: (e: string | null) => void;
  onSubmit: (v: ApplyForm) => Promise<void>;
}) {
  const [form] = Form.useForm<ApplyForm>();
  return (
    <Form
      form={form}
      layout="vertical"
      requiredMark={false}
      onFinish={(v) => void props.onSubmit(v)}
      onValuesChange={() => props.err && props.setErr(null)}
    >
      {props.err && (
        <Alert type="error" showIcon message={props.err} style={{ marginBottom: 16 }} />
      )}

      <Form.Item
        name="contactName"
        label="联系人姓名"
        rules={[{ required: true, message: '请填写姓名', min: 2, max: 64 }]}
      >
        <Input size="large" placeholder="张三" />
      </Form.Item>

      <Form.Item
        name="email"
        label="邮箱"
        rules={[
          { required: true, message: '请填写邮箱' },
          { type: 'email', message: '邮箱格式不正确' },
        ]}
      >
        <Input size="large" placeholder="you@company.com" autoComplete="email" />
      </Form.Item>

      <Form.Item name="phone" label="手机（可选）" rules={[{ max: 32 }]}>
        <Input size="large" placeholder="13800000000" />
      </Form.Item>

      <Form.Item name="company" label="公司 / 团队（可选）" rules={[{ max: 128 }]}>
        <Input size="large" placeholder="Acme Inc." />
      </Form.Item>

      <Form.Item
        name="useCase"
        label="拟用场景（可选，越具体越快批）"
        rules={[{ max: 2000 }]}
      >
        <Input.TextArea
          rows={4}
          placeholder="例：我们有一个 50 张表的电商业务库，想用 Kintsugi 出 BI 报表 + 给 Claude 跑 NL→SQL"
        />
      </Form.Item>

      <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
        <Button
          htmlType="submit"
          type="primary"
          size="large"
          loading={props.busy}
          block
          style={{
            background: COLORS.ink,
            borderColor: COLORS.ink,
            fontFamily: FONTS.mono,
            letterSpacing: '0.1em',
            fontSize: 13,
            height: 44,
          }}
        >
          提 交 申 请
        </Button>
      </Form.Item>

      <div
        style={{
          marginTop: 16,
          fontFamily: FONTS.mono,
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: COLORS.muted,
          textAlign: 'center',
        }}
      >
        已经有账号？
        <Link
          to="/login"
          style={{
            color: COLORS.gold,
            borderBottom: `1px solid ${COLORS.goldSoft}`,
            marginLeft: 8,
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          ← 返回登录
        </Link>
      </div>
    </Form>
  );
}

function SuccessPanel(props: { applicationId: string; onBack: () => void }) {
  return (
    <div>
      <Alert
        type="success"
        showIcon
        message="申请已提交"
        description={
          <>
            <p style={{ margin: '8px 0' }}>
              申请编号：<code style={{ fontFamily: FONTS.mono }}>{props.applicationId}</code>
            </p>
            <p style={{ margin: '8px 0' }}>
              我们会在 1-2 个工作日内审核完毕，结果会以邮件通知。审批通过后会附带：
            </p>
            <ul style={{ margin: '8px 0', paddingLeft: 20, lineHeight: 1.8 }}>
              <li>tenantCode（租户标识）</li>
              <li>初始管理员用户名 + 一次性临时密码（首次登录后请立即修改）</li>
              <li>试用期 14 天起算</li>
            </ul>
          </>
        }
        style={{ marginBottom: 24 }}
      />
      <Button block size="large" onClick={props.onBack}>
        返回登录
      </Button>
    </div>
  );
}

function FooterMeta() {
  return (
    <div
      style={{
        marginTop: 48,
        paddingTop: 20,
        borderTop: `1px solid ${COLORS.ruleSoft}`,
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: COLORS.mutedSoft,
        textAlign: 'center',
      }}
    >
      Kintsugi · 锦缮 · 商业产品 v0.1
    </div>
  );
}
