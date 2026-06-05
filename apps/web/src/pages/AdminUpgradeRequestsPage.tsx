import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons';
import * as React from 'react';
import dayjs from 'dayjs';
import { api } from '../api';
import { message } from '../notify';

/**
 * 平台管理员审批 / 拒绝升级 / 续费请求。商务同事确认收款后过来一键开通。
 *
 * 路由：/admin/upgrade-requests（@Permission('admin:read'/'admin:write')）。
 */

type UpgradeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface UpgradeReq {
  id: string;
  tenantCode: string;
  requestedPlanCode: string;
  requestedDurationMonths: number;
  contactName: string;
  contactEmail: string;
  phone: string | null;
  note: string | null;
  status: UpgradeStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  approvedExpiresAt: string | null;
  createdAt: string;
}

const STATUS_TAG: Record<UpgradeStatus, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审' },
  APPROVED: { color: 'green', label: '已开通' },
  REJECTED: { color: 'default', label: '已拒绝' },
};

interface ApproveForm {
  note?: string;
}
interface RejectForm {
  note?: string;
}

export function AdminUpgradeRequestsPage(): React.ReactElement {
  const [rows, setRows] = React.useState<UpgradeReq[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [statusFilter, setStatusFilter] = React.useState<UpgradeStatus | 'ALL'>('PENDING');
  const [loading, setLoading] = React.useState(false);
  const [approveTarget, setApproveTarget] = React.useState<UpgradeReq | null>(null);
  const [rejectTarget, setRejectTarget] = React.useState<UpgradeReq | null>(null);
  const [approveForm] = Form.useForm<ApproveForm>();
  const [rejectForm] = Form.useForm<RejectForm>();

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const r = await api.get<{
        data: UpgradeReq[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/admin/upgrade-requests?${params.toString()}`);
      setRows(r.data);
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

  const submitApprove = async (): Promise<void> => {
    if (!approveTarget) return;
    try {
      const v = await approveForm.validateFields();
      await api.post(`/admin/upgrade-requests/${approveTarget.id}/approve`, { note: v.note });
      message.success(`已开通 ${approveTarget.tenantCode} → ${approveTarget.requestedPlanCode}；通知邮件投递中`);
      setApproveTarget(null);
      void reload();
    } catch (err) {
      const e = err as { message?: string; errorFields?: unknown };
      if (e.errorFields) return;
      message.error(e.message ?? '开通失败');
    }
  };

  const submitReject = async (): Promise<void> => {
    if (!rejectTarget) return;
    try {
      const v = await rejectForm.validateFields();
      await api.post(`/admin/upgrade-requests/${rejectTarget.id}/reject`, { note: v.note });
      message.success(`已拒绝 ${rejectTarget.id}；通知邮件投递中`);
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
      title: '请求编号',
      dataIndex: 'id',
      width: 130,
      render: (id: string) => (
        <Tooltip title={id}>
          <Typography.Text code copyable={{ text: id, tooltips: ['复制', '已复制'] }}>
            {id.slice(0, 8)}…
          </Typography.Text>
        </Tooltip>
      ),
    },
    { title: '租户', dataIndex: 'tenantCode', width: 120 },
    { title: '套餐', dataIndex: 'requestedPlanCode', width: 130 },
    {
      title: '时长',
      dataIndex: 'requestedDurationMonths',
      width: 70,
      render: (m: number) => `${m} 月`,
    },
    { title: '联系人', dataIndex: 'contactName', width: 90 },
    {
      title: '联系邮箱',
      dataIndex: 'contactEmail',
      width: 200,
      render: (e: string) => <Typography.Text copyable={{ text: e }}>{e}</Typography.Text>,
    },
    { title: '电话', dataIndex: 'phone', width: 130, render: (p: string | null) => p ?? '—' },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (n: string | null) =>
        n ? (
          <Tooltip title={n} placement="topLeft" overlayStyle={{ maxWidth: 480 }}>
            <span>{n.length > 32 ? n.slice(0, 32) + '…' : n}</span>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: UpgradeStatus) => <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>,
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (d: string) => dayjs(d).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '审批后到期',
      dataIndex: 'approvedExpiresAt',
      width: 150,
      render: (d: string | null) => (d ? dayjs(d).format('YYYY-MM-DD') : '—'),
    },
    {
      title: '审核备注',
      dataIndex: 'reviewNote',
      ellipsis: true,
      render: (n: string | null) => n ?? '—',
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right' as const,
      render: (_: unknown, r: UpgradeReq) =>
        r.status === 'PENDING' ? (
          <Space size="small">
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => setApproveTarget(r)}>
              开通
            </Button>
            <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejectTarget(r)}>
              拒绝
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>已处理</Typography.Text>
        ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            升级 / 续费审批
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
                { value: 'APPROVED', label: '已开通' },
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
          message="开通会立即生效：edition / 套餐 / 到期时间 / 配额 / AI 余额都会同步更新"
          description="审批前请确认对应付款已收到（对公转账 / 微信 / 支付宝）。开通后申请人会收到含到期时间的确认邮件。"
        />

        <Table
          rowKey="id"
          dataSource={rows}
          columns={columns}
          loading={loading}
          scroll={{ x: 1700 }}
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
        title={
          approveTarget
            ? `开通：${approveTarget.tenantCode} → ${approveTarget.requestedPlanCode} (${approveTarget.requestedDurationMonths} 个月)`
            : ''
        }
        open={!!approveTarget}
        onCancel={() => setApproveTarget(null)}
        onOk={submitApprove}
        okText="确认开通"
        width={460}
        destroyOnClose
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item
            label="审核备注（可选，仅内部）"
            name="note"
            extra="不进申请人邮件，作为内部 reviewNote 留底"
          >
            <Input.TextArea rows={2} maxLength={500} placeholder="例如：付款方式 / 折扣 / 跟进备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={rejectTarget ? `拒绝：${rejectTarget.tenantCode} ${rejectTarget.id}` : ''}
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
            extra="留空 → 邮件不展示原因；填了原文展示"
          >
            <Input.TextArea rows={3} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
