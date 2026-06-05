import {
  Alert,
  Button,
  Form,
  Input,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { COLORS, FONTS, GOLD_RULE_HORIZONTAL } from '../theme';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // 注册暂未开放；统一只走登录。
  const submit = async (
    values: { tenantCode: string; username: string; password: string },
    _mode?: 'login',
  ) => {
    void _mode;
    setBusy(true);
    setErr(null);
    try {
      await login(values);
      message.success('已登录');
      navigate('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="k-login-shell"
      style={{
        minHeight: '100vh',
        background: COLORS.paper,
        color: COLORS.ink,
        fontFamily: FONTS.ui,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 480px)',
      }}
    >
      <BrandPanel />
      <FormPanel busy={busy} err={err} setErr={setErr} submit={submit} />
    </div>
  );
}

// ----------------- 左侧品牌区 -----------------

function BrandPanel() {
  return (
    <section
      className="k-login-brand"
      style={{
        position: 'relative',
        padding: '72px 64px 56px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: GOLD_RULE_HORIZONTAL,
          opacity: 0.55,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: COLORS.gold,
            marginBottom: 28,
          }}
        >
          Kintsugi · 锦缮 · v0.1
        </div>

        <h1
          style={{
            fontFamily: FONTS.serif,
            fontWeight: 400,
            fontSize: 56,
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            margin: 0,
            color: COLORS.ink,
            maxWidth: 640,
          }}
        >
          给一个数据库连接，
          <br />
          <span style={{ fontStyle: 'italic', color: COLORS.gold }}>
            自动生成可被 AI 调用的企业系统。
          </span>
        </h1>

        <p
          style={{
            marginTop: 24,
            maxWidth: 560,
            color: COLORS.muted,
            fontSize: 15,
            lineHeight: 1.7,
          }}
        >
          DBAgent 逆向理解结构 · Instant API / 业务模型一键生成 · BFF 与 Custom SQL
          按需扩展。所有产物为可审计的真实代码，通过 SDK / CLI / MCP 暴露给 Agent。
        </p>
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        <FeatureGrid />
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            style={{
              flex: '0 0 56px',
              height: 1,
              background: GOLD_RULE_HORIZONTAL,
              opacity: 0.55,
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              letterSpacing: '0.16em',
              color: COLORS.muted,
            }}
          >
            DBAgent · Instant API · Pages · Reports · BFF · MCP
          </span>
        </div>
      </div>

      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -60,
          bottom: -100,
          fontFamily: FONTS.serif,
          fontSize: 480,
          fontWeight: 400,
          color: COLORS.ink,
          opacity: 0.04,
          userSelect: 'none',
          pointerEvents: 'none',
          lineHeight: 0.9,
          letterSpacing: '-0.04em',
        }}
      >
        錦
      </div>
    </section>
  );
}

function FeatureGrid() {
  const items = [
    { caption: 'Modeling', label: '逆向理解 · 中文语义 · 关系推断' },
    { caption: 'Instant API', label: 'filter / aggregate / CRUD 自动 RESTful' },
    { caption: 'AI-Native', label: 'NL → SQL · NL → 页面 · NL → 报表' },
    { caption: 'Audit-grade', label: '产物为真实代码 · 可 git 可 review' },
  ];
  return (
    <div
      className="k-login-feature-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '20px 32px',
        maxWidth: 560,
      }}
    >
      {items.map((it) => (
        <div key={it.caption}>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: COLORS.gold,
              marginBottom: 6,
            }}
          >
            {it.caption}
          </div>
          <div style={{ fontSize: 14, color: COLORS.ink2, lineHeight: 1.55 }}>
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------- 右侧表单区 -----------------

interface FormPanelProps {
  busy: boolean;
  err: string | null;
  setErr: (s: string | null) => void;
  submit: (
    v: { tenantCode: string; username: string; password: string },
    mode?: 'login',
  ) => Promise<void>;
}

function FormPanel({ busy, err, setErr, submit }: FormPanelProps) {
  return (
    <section
      className="k-login-form"
      style={{
        position: 'relative',
        background: '#ffffff',
        borderLeft: `1px solid ${COLORS.rule}`,
        padding: '88px 60px 60px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 1,
          background: `linear-gradient(180deg, transparent 0%, ${COLORS.gold} 25%, ${COLORS.goldSoft} 50%, ${COLORS.gold} 75%, transparent 100%)`,
          opacity: 0.45,
        }}
      />

      <div style={{ maxWidth: 360 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: COLORS.mutedSoft,
            marginBottom: 14,
          }}
        >
          Sign in / Register
        </div>

        <h2
          style={{
            fontFamily: FONTS.serif,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.2,
            margin: 0,
            marginBottom: 32,
            color: COLORS.ink,
            letterSpacing: '-0.01em',
          }}
        >
          登录控制台
        </h2>

        {err && (
          <Alert
            style={{ marginBottom: 16 }}
            type="error"
            message={err}
            closable
            onClose={() => setErr(null)}
          />
        )}

        <Form
          layout="vertical"
          onFinish={(v) => void submit(v, 'login')}
          initialValues={{ tenantCode: 'demo' }}
          requiredMark={false}
        >
          <Form.Item label={<L>租户</L>} name="tenantCode" rules={[{ required: true }]}>
            <Input size="large" />
          </Form.Item>
          <Form.Item label={<L>用户名</L>} name="username" rules={[{ required: true }]}>
            <Input size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item label={<L>密码</L>} name="password" rules={[{ required: true, min: 6 }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button
            htmlType="submit"
            type="primary"
            block
            size="large"
            loading={busy}
            style={{
              background: COLORS.ink,
              borderColor: COLORS.ink,
              fontFamily: FONTS.mono,
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            登录
          </Button>
        </Form>
        <div
          style={{
            marginTop: 18,
            fontFamily: FONTS.mono,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: COLORS.muted,
            textAlign: 'center',
          }}
        >
          没有账号？
          <Link
            to="/apply"
            style={{
              color: COLORS.gold,
              borderBottom: `1px solid ${COLORS.goldSoft}`,
              marginLeft: 8,
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            申请试用 →
          </Link>
        </div>

        <div
          style={{
            marginTop: 40,
            paddingTop: 20,
            borderTop: `1px solid ${COLORS.ruleSoft}`,
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: COLORS.mutedSoft,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>SSO · LDAP · IDP（企业版）</span>
          <a
            href="/api/apps/app-demo0001/docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: COLORS.mutedSoft, textDecoration: 'none' }}
          >
            OpenAPI ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text
      style={{
        fontFamily: FONTS.mono,
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: COLORS.muted,
      }}
    >
      {children}
    </Typography.Text>
  );
}
