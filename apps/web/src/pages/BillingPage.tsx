import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CrownOutlined } from '@ant-design/icons';
import * as React from 'react';
import dayjs from 'dayjs';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { message } from '../notify';
import { COLORS } from '../theme';

/**
 * 用户端订阅 / 升级 / 续费页。
 *
 * 上半：当前订阅状态卡片（edition / plan / 到期 / 自动续费 / AI 余额）
 * 下半：套餐卡片列表（PRO 月/年 / 企业版） + 选时长 + 提"升级 / 续费"申请
 *
 * 提交后进入 PENDING；admin 在 /admin/upgrade-requests 审批通过后才生效。
 * 不接外部支付，本期是"提单 → 商务确认收款 → admin 审批"模式。
 */

type Edition = 'TRIAL' | 'PRO' | 'ENTERPRISE';

interface Plan {
  code: string;
  edition: Edition;
  displayName: string;
  tagline: string;
  priceYuanPerMonth: number;
  durationsMonths: number[];
  quota: {
    maxDataSources: number | null;
    maxDatasets: number | null;
    maxDailyLlmCalls: number | null;
  };
  monthlyAiCreditYuan: number;
  features: string[];
}

interface MeSubscription {
  tenantCode: string;
  edition: Edition;
  currentPlanCode: string | null;
  plan: Plan | null;
  trialExpiresAt: string | null;
  subscriptionExpiresAt: string | null;
  autoRenew: boolean;
  aiCredits: string;
  quota: {
    maxDataSources: number | null;
    maxDatasets: number | null;
    maxDailyLlmCalls: number | null;
  };
}

interface UpgradeForm {
  contactName: string;
  contactEmail: string;
  phone?: string;
  durationMonths: number;
  note?: string;
}

const EDITION_TAG: Record<Edition, { color: string; label: string }> = {
  TRIAL: { color: 'gold', label: '试用' },
  PRO: { color: 'blue', label: 'PRO' },
  ENTERPRISE: { color: 'purple', label: '企业版' },
};

function fmtQuota(n: number | null): string {
  return n == null ? '不限' : String(n);
}

function fmtDate(s: string | null): string {
  return s ? dayjs(s).format('YYYY-MM-DD HH:mm') : '—';
}

export function BillingPage(): React.ReactElement {
  const { me } = useAuth();
  const [me$, setMe] = React.useState<MeSubscription | null>(null);
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [picked, setPicked] = React.useState<Plan | null>(null);
  const [form] = Form.useForm<UpgradeForm>();
  const [submitting, setSubmitting] = React.useState(false);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, plansRes] = await Promise.all([
        api.get<MeSubscription>('/billing/me'),
        api.get<{ data: Plan[] }>('/billing/plans'),
      ]);
      setMe(meRes);
      setPlans(plansRes.data);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const openPick = (p: Plan): void => {
    setPicked(p);
    form.resetFields();
    form.setFieldsValue({
      contactName: me?.username ?? '',
      contactEmail: '', // 用户登录态没有 email；让用户自己填
      durationMonths: p.durationsMonths[0]!,
    });
  };

  const submitRequest = async (): Promise<void> => {
    if (!picked) return;
    try {
      const v = await form.validateFields();
      setSubmitting(true);
      const r = await api.post<{ id: string; totalYuan: number }>('/billing/upgrade-request', {
        requestedPlanCode: picked.code,
        requestedDurationMonths: v.durationMonths,
        contactName: v.contactName,
        contactEmail: v.contactEmail,
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.note ? { note: v.note } : {}),
      });
      message.success(`已提交申请 ${r.id}（总价 ¥${r.totalYuan}）。商务同事会与您确认付款方式。`);
      setPicked(null);
      void reload();
    } catch (err) {
      const e = err as ApiError & { errorFields?: unknown };
      if ('errorFields' in e && e.errorFields) return;
      message.error(e.message ?? '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAutoRenew = async (next: boolean): Promise<void> => {
    try {
      await api.post('/billing/auto-renew', { autoRenew: next ? 'on' : 'off' });
      message.success(next ? '已开启自动续费提醒' : '已关闭自动续费提醒');
      void reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ margin: '0 0 16px' }}>
        订阅与计费
      </Typography.Title>

      <Card
        loading={loading}
        title={
          <Space>
            <span>当前订阅</span>
            {me$ && (
              <Tag color={EDITION_TAG[me$.edition].color}>
                {EDITION_TAG[me$.edition].label}
              </Tag>
            )}
          </Space>
        }
        extra={
          me$ && me$.edition !== 'TRIAL' ? (
            <Space>
              <span style={{ color: COLORS.muted, fontSize: 13 }}>自动续费提醒</span>
              <Switch checked={me$.autoRenew} onChange={toggleAutoRenew} />
            </Space>
          ) : null
        }
        style={{ marginBottom: 24 }}
      >
        {me$ && (
          <Row gutter={[24, 12]}>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                当前套餐
              </Typography.Text>
              <div style={{ fontWeight: 500, marginTop: 4 }}>
                {me$.plan?.displayName ?? (me$.edition === 'TRIAL' ? '试用账户' : '—')}
              </div>
            </Col>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {me$.edition === 'TRIAL' ? '试用到期时间' : '订阅到期时间'}
              </Typography.Text>
              <div style={{ fontWeight: 500, marginTop: 4 }}>
                {me$.edition === 'TRIAL'
                  ? fmtDate(me$.trialExpiresAt)
                  : fmtDate(me$.subscriptionExpiresAt)}
              </div>
            </Col>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                AI 余额
              </Typography.Text>
              <div style={{ fontWeight: 500, marginTop: 4 }}>¥{me$.aiCredits}</div>
            </Col>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                数据源上限
              </Typography.Text>
              <div style={{ marginTop: 4 }}>{fmtQuota(me$.quota.maxDataSources)}</div>
            </Col>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                数据集上限
              </Typography.Text>
              <div style={{ marginTop: 4 }}>{fmtQuota(me$.quota.maxDatasets)}</div>
            </Col>
            <Col xs={12} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                每日 AI 调用上限
              </Typography.Text>
              <div style={{ marginTop: 4 }}>{fmtQuota(me$.quota.maxDailyLlmCalls)}</div>
            </Col>
          </Row>
        )}
      </Card>

      <Alert
        type="info"
        showIcon
        message="不接外部支付，目前是「提单 → 商务确认付款 → 平台审批 → 自动开通」流程"
        description="提交申请后，商务同事会通过邮件 / 电话与您确认付款方式（对公转账 / 微信 / 支付宝）；
          收款到账后 admin 在后台一键开通，您会收到开通确认邮件。"
        style={{ marginBottom: 24 }}
      />

      <Typography.Title level={4} style={{ margin: '0 0 12px' }}>
        选择套餐
      </Typography.Title>
      <Row gutter={[16, 16]}>
        {plans.map((p) => (
          <Col xs={24} md={8} key={p.code}>
            <Card
              hoverable
              title={
                <Space>
                  {p.edition === 'ENTERPRISE' ? <CrownOutlined style={{ color: COLORS.gold }} /> : null}
                  <span>{p.displayName}</span>
                </Space>
              }
              extra={
                <Tag color={EDITION_TAG[p.edition].color}>{EDITION_TAG[p.edition].label}</Tag>
              }
              actions={[
                <Button
                  key="pick"
                  type="primary"
                  block
                  onClick={() => openPick(p)}
                  disabled={loading}
                >
                  {me$?.currentPlanCode === p.code ? '续费此套餐' : '选择'}
                </Button>,
              ]}
            >
              <Typography.Text type="secondary">{p.tagline}</Typography.Text>
              <div style={{ margin: '12px 0' }}>
                <span style={{ fontSize: 28, fontWeight: 600, color: COLORS.gold }}>
                  ¥{p.priceYuanPerMonth.toLocaleString()}
                </span>
                <span style={{ color: COLORS.muted, marginLeft: 4 }}>/ 月</span>
              </div>
              <ul style={{ paddingLeft: 18, color: COLORS.ink, lineHeight: 1.85, marginBottom: 0 }}>
                {p.features.map((f, i) => (
                  <li key={i}>
                    <CheckCircleOutlined style={{ color: COLORS.ok, marginRight: 6 }} />
                    {f}
                  </li>
                ))}
              </ul>
            </Card>
          </Col>
        ))}
      </Row>

      <Modal
        title={picked ? `${picked.displayName} — 提交订阅申请` : ''}
        open={!!picked}
        onCancel={() => setPicked(null)}
        onOk={submitRequest}
        confirmLoading={submitting}
        okText="提交申请"
        width={520}
        destroyOnClose
      >
        {picked && (
          <Form form={form} layout="vertical">
            <Alert
              type="info"
              message={`${picked.displayName} · ¥${picked.priceYuanPerMonth} / 月`}
              description={picked.tagline}
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              label="购买时长（月）"
              name="durationMonths"
              rules={[{ required: true }]}
              extra={`套餐允许 ${picked.durationsMonths.join(' / ')} 个月`}
            >
              <Select
                options={picked.durationsMonths.map((m) => ({
                  value: m,
                  label: `${m} 个月（合计 ¥${(picked.priceYuanPerMonth * m).toLocaleString()}）`,
                }))}
              />
            </Form.Item>
            <Form.Item label="联系人" name="contactName" rules={[{ required: true, min: 2, max: 64 }]}>
              <Input placeholder="对接同事姓名" />
            </Form.Item>
            <Form.Item
              label="联系邮箱"
              name="contactEmail"
              rules={[{ required: true, type: 'email' }]}
              extra="确认邮件 + 后续付款指引会发到这个邮箱"
            >
              <Input placeholder="contact@your-company.com" />
            </Form.Item>
            <Form.Item label="联系电话（可选）" name="phone">
              <Input placeholder="可选" />
            </Form.Item>
            <Form.Item label="备注（可选）" name="note">
              <Input.TextArea rows={2} maxLength={2000} placeholder="例如：希望开发票 / 折扣码 / 特殊配置需求" />
            </Form.Item>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              注：提交后状态为「待审批」，平台商务同事会与您确认付款，到账后才会真正开通。
            </Typography.Text>
          </Form>
        )}
      </Modal>
    </div>
  );
}
