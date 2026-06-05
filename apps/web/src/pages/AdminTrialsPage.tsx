import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import * as React from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { message } from '../notify';
import { hasGrant, useAuth } from '../auth';

/**
 * 平台管理员审批试用申请页面。替代之前的 curl /api/admin/trials/* 操作。
 *
 * 路由：/admin/trials（@Permission('admin:read'/'admin:write')）。
 * 列表 → 选条 → 「通过」（弹框填 tenantCode/tenantName/username/password）
 *      或「拒绝」（弹框填 reason）。
 *
 * 邮件通知由 server 端 trial.service 发；UI 不直接关心。
 */

type TrialStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface TrialApp {
  id: string;
  contactName: string;
  email: string;
  phone: string | null;
  company: string | null;
  useCase: string | null;
  status: TrialStatus;
  approvedTenantCode: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

const STATUS_TAG: Record<TrialStatus, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'default', label: '已拒绝' },
};

interface ApproveForm {
  tenantCode: string;
  tenantName: string;
  username: string;
  password: string;
  note?: string;
}

interface RejectForm {
  note?: string;
}

function genPassword(): string {
  // 16-字节 base64url（22 字符），足够强；管理员可保留用于首次发送给申请人
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 22);
}

export function AdminTrialsPage(): React.ReactElement {
  const { me } = useAuth();
  const canApprove = hasGrant(me, '*:admin:write');
  const [apps, setApps] = React.useState<TrialApp[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [statusFilter, setStatusFilter] = React.useState<TrialStatus | 'ALL'>('PENDING');
  const [loading, setLoading] = React.useState(false);
  const [approveTarget, setApproveTarget] = React.useState<TrialApp | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<TrialApp | null>(null);
  const [approveForm] = Form.useForm<ApproveForm>();
  const [rejectForm] = Form.useForm<RejectForm>();

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const r = await api.get<{
        data: TrialApp[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/admin/trials?${params.toString()}`);
      setApps(r.data);
      setTotal(r.total);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const openApprove = (app: TrialApp): void => {
    setApproveTarget(app);
    approveForm.resetFields();
    // 默认 tenantCode 用 email 前缀
    const localPart = app.email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
    approveForm.setFieldsValue({
      tenantCode: localPart || '',
      tenantName: app.company ?? app.contactName,
      username: localPart || 'admin',
      password: genPassword(),
    });
  };

  const submitApprove = async (): Promise<void> => {
    if (!approveTarget) return;
    try {
      const v = await approveForm.validateFields();
      await api.post(`/admin/trials/${approveTarget.id}/approve`, v);
      message.success(`已通过申请 ${approveTarget.id} → ${v.tenantCode}；通知邮件正在投递`);
      setApproveTarget(null);
      void reload();
    } catch (err) {
      // antd Form validation throws an object without .message — guard it
      const e = err as { message?: string; errorFields?: unknown };
      if (e.errorFields) return; // 表单校验未过，已显示
      message.error(e.message ?? '审批失败');
    }
  };

  const submitReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    try {
      const v = await rejectForm.validateFields();
      await api.post(`/admin/trials/${rejectTarget.id}/reject`, { note: v.note });
      message.success(`已拒绝申请 ${rejectTarget.id}；通知邮件正在投递`);
      setRejectTarget(null);
      void reload();
    } catch (err) {
      const e = err as { message?: string; errorFields?: unknown };
      if (e.errorFields) return;
      message.error(e.message ?? '操作失败');
    }
  };

  const columns = [
    {
      title: '申请编号',
      dataIndex: 'id',
      width: 220,
      render: (id: string) => (
        <Tooltip title={id}>
          <Typography.Text code copyable={{ text: id, tooltips: ['复制', '已复制'] }}>
            {id.slice(0, 8)}…
          </Typography.Text>
        </Tooltip>
      ),
    },
    { title: '联系人', dataIndex: 'contactName', width: 100 },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 220,
      render: (e: string) => <Typography.Text copyable={{ text: e }}>{e}</Typography.Text>,
    },
    { title: '公司', dataIndex: 'company', width: 160, render: (c: string | null) => c ?? '—' },
    { title: '电话', dataIndex: 'phone', width: 130, render: (p: string | null) => p ?? '—' },
    {
      title: '使用场景',
      dataIndex: 'useCase',
      ellipsis: true,
      render: (u: string | null) =>
        u ? (
          <Tooltip title={u} placement="topLeft" overlayStyle={{ maxWidth: 480 }}>
            <span>{u.length > 40 ? u.slice(0, 40) + '…' : u}</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: TrialStatus) => {
        const t = STATUS_TAG[s];
        return <Tag color={t.color}>{t.label}</Tag>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (d: string) => dayjs(d).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '已通过 → tenant',
      dataIndex: 'approvedTenantCode',
      width: 140,
      render: (t: string | null) => t ?? '—',
    },
    {
      title: '审核备注',
      dataIndex: 'reviewNote',
      ellipsis: true,
      render: (n: string | null) => n ?? '—',
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, app: TrialApp) =>
        app.status === 'PENDING' ? (
          canApprove ? (
            <Space size="small">
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => openApprove(app)}>
                通过
              </Button>
              <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectTarget(app)}>
                拒绝
              </Button>
            </Space>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              只读
            </Typography.Text>
          )
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已处理
          </Typography.Text>
        ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            试用申请审批
          </Typography.Title>
          <Space>
            <Select
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              style={{ width: 140 }}
              options={[
                { value: 'PENDING', label: '待审' },
                { value: 'APPROVED', label: '已通过' },
                { value: 'REJECTED', label: '已拒绝' },
                { value: 'ALL', label: '全部' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
              刷新
            </Button>
          </Space>
        </Space>

        <Alert
          type="info"
          showIcon
          message="审批通过后，系统会自动建租户 + admin 用户 + 14 天试用期"
          description="临时密码会发到申请人邮箱（mailpilot 异步投递）；UI 不在审批结果里再展示密码——以免管理员误传。"
        />

        <Table
          rowKey="id"
          dataSource={apps}
          columns={columns}
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Space>

      <Modal
        title={approveTarget ? `通过申请：${approveTarget.contactName} <${approveTarget.email}>` : ''}
        open={!!approveTarget}
        onCancel={() => setApproveTarget(null)}
        onOk={submitApprove}
        okText="通过并开通"
        width={520}
        destroyOnClose
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item
            label="租户编码 (tenantCode)"
            name="tenantCode"
            rules={[
              { required: true, min: 2, max: 32 },
              { pattern: /^[a-z][a-z0-9-]*$/, message: '小写英文 + 数字 + 短横线，必须以字母开头' },
            ]}
            extra="客户登录时用，全平台唯一，建议 2-32 个小写字母 / 数字 / 短横线"
          >
            <Input placeholder="acme" />
          </Form.Item>
          <Form.Item label="租户名 (tenantName)" name="tenantName" rules={[{ required: true, min: 2, max: 64 }]}>
            <Input placeholder="Acme 公司" />
          </Form.Item>
          <Form.Item
            label="首位 admin 用户名"
            name="username"
            rules={[{ required: true, min: 2, max: 32 }]}
          >
            <Input placeholder="admin" />
          </Form.Item>
          <Form.Item
            label="临时密码"
            name="password"
            rules={[{ required: true, min: 12, max: 128 }]}
            extra="自动生成 22 字符强密码；通过邮件发给申请人，首次登录后改"
          >
            <Input.Password />
          </Form.Item>
          <Form.Item label="审核备注（可选，仅内部）" name="note">
            <Input.TextArea rows={2} maxLength={500} placeholder="例如：合作类型、对接负责人" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={rejectTarget ? `拒绝申请：${rejectTarget.contactName} <${rejectTarget.email}>` : ''}
        open={!!rejectTarget}
        onCancel={() => setRejectTarget(null)}
        onOk={submitReject}
        okText="确认拒绝"
        okButtonProps={{ danger: true }}
        width={460}
        destroyOnClose
      >
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            label="拒绝原因（可选，会同步给申请人）"
            name="note"
            extra="留空 → 申请人收到的邮件不展示原因；填了就照原文展示"
          >
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
