import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { CopyOutlined, HistoryOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import * as React from 'react';
import dayjs from 'dayjs';
import { api, type ApplicationSummary, type PagedResult } from '../api';
import { message } from '../notify';
import { hasGrant, useAuth } from '../auth';

interface WebhookSub {
  id: string;
  appCode: string;
  url: string;
  events: string[];
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreatedSecret {
  id: string;
  secret: string;
}

interface WebhookDelivery {
  id: string;
  event: string;
  status: 'pending' | 'success' | 'dead_lettered';
  attempts: number;
  nextAttemptAt: string | null;
  lastHttpStatus: number | null;
  lastErrorMsg: string | null;
  lastDurationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

const KNOWN_EVENTS = [
  { value: 'dataset.created', label: 'dataset.created' },
  { value: 'dataset.updated', label: 'dataset.updated' },
  { value: 'dataset.deleted', label: 'dataset.deleted' },
];

export function WebhooksPage() {
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:webhook:write');
  const [apps, setApps] = React.useState<ApplicationSummary[]>([]);
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [subs, setSubs] = React.useState<WebhookSub[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createdSecret, setCreatedSecret] = React.useState<CreatedSecret | null>(null);
  const [form] = Form.useForm<{ url: string; events: string[]; description?: string }>();
  const [historySub, setHistorySub] = React.useState<WebhookSub | null>(null);
  const [history, setHistory] = React.useState<WebhookDelivery[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);

  const openHistory = async (sub: WebhookSub): Promise<void> => {
    setHistorySub(sub);
    setHistoryLoading(true);
    try {
      const r = await api.get<{
        data: WebhookDelivery[];
        total: number;
      }>(`/webhooks/${sub.id}/deliveries?pageSize=100`);
      setHistory(r.data);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  React.useEffect(() => {
    void api
      .get<PagedResult<ApplicationSummary>>('/applications?pageSize=500')
      .then((r) => {
        setApps(r.data);
        if (r.data.length > 0 && !appCode) setAppCode(r.data[0]!.appCode);
      })
      .catch((e: Error) => message.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = React.useCallback(async () => {
    if (!appCode) return;
    setLoading(true);
    try {
      const data = await api.get<WebhookSub[]>(`/webhooks?appCode=${encodeURIComponent(appCode)}`);
      setSubs(data);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [appCode]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const submitCreate = async (): Promise<void> => {
    if (!appCode) return;
    const values = await form.validateFields();
    try {
      const r = await api.post<CreatedSecret>('/webhooks', {
        appCode,
        url: values.url.trim(),
        events: values.events,
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
      });
      setCreateOpen(false);
      form.resetFields();
      setCreatedSecret(r);
      void reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const toggleEnabled = async (sub: WebhookSub, enabled: boolean): Promise<void> => {
    try {
      await api.patch<{ ok: true }>(`/webhooks/${sub.id}/enabled`, { enabled });
      void reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const remove = async (sub: WebhookSub): Promise<void> => {
    try {
      await api.delete<{ ok: true }>(`/webhooks/${sub.id}`);
      message.success(`已删除 ${sub.url}`);
      void reload();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns = [
    {
      title: 'URL',
      dataIndex: 'url',
      ellipsis: true,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '事件',
      dataIndex: 'events',
      width: 320,
      render: (events: string[]) => (
        <Space size={4} wrap>
          {events.map((e) => (
            <Tag key={e} color="blue">
              {e}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (v: string | null) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean, row: WebhookSub) => (
        <Switch
          checked={v}
          disabled={!canWrite}
          onChange={(checked) => void toggleEnabled(row, checked)}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '',
      key: 'actions',
      width: 160,
      render: (_: unknown, row: WebhookSub) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => void openHistory(row)}
          >
            历史
          </Button>
          {canWrite && (
            <Popconfirm title={`删除 ${row.url} ?`} onConfirm={() => void remove(row)}>
              <Button type="text" danger size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Webhooks
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        当前 application 内 dataset.* 等事件发生时，向订阅的外部 URL 推送 HMAC 签名的 JSON 包。
        失败 8s 超时即丢；如果你要 at-least-once 投递，看{' '}
        <Typography.Link href="https://github.com/LoadstarCN/kintsugi/blob/main/deploy/observability/pgbouncer.md">
          架构文档
        </Typography.Link>{' '}
        关于 retry queue 的部分。
      </Typography.Paragraph>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="选择应用"
          style={{ width: 280 }}
          value={appCode}
          onChange={setAppCode}
          options={apps.map((a) => ({ value: a.appCode, label: `${a.name} (${a.appCode})` }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
          刷新
        </Button>
        {canWrite && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!appCode}
            onClick={() => setCreateOpen(true)}
          >
            新建订阅
          </Button>
        )}
      </Space>

      <Table<WebhookSub>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={subs}
        columns={columns}
        pagination={false}
      />

      <Modal
        title="新建 Webhook 订阅"
        open={createOpen}
        onOk={() => void submitCreate()}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="URL"
            name="url"
            rules={[
              { required: true, message: '请填写 URL' },
              { pattern: /^https?:\/\//, message: '必须是 http(s)://' },
            ]}
          >
            <Input placeholder="https://your-server/api/kintsugi-webhook" />
          </Form.Item>
          <Form.Item
            label="事件"
            name="events"
            rules={[{ required: true, message: '至少选一个事件' }]}
            initialValue={['dataset.created', 'dataset.updated']}
          >
            <Select mode="multiple" options={KNOWN_EVENTS} />
          </Form.Item>
          <Form.Item label="描述（可选）" name="description">
            <Input placeholder="例：CRM 同步集成" />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="创建后会一次性返回 secret，用于 HMAC-SHA256 验签；丢失只能重建。"
          />
        </Form>
      </Modal>

      <Modal
        title="订阅已创建 — 立即保存 secret"
        open={createdSecret != null}
        onOk={() => setCreatedSecret(null)}
        onCancel={() => setCreatedSecret(null)}
        okText="我已保存"
        cancelButtonProps={{ style: { display: 'none' } }}
        closable={false}
      >
        {createdSecret && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type="warning"
              showIcon
              message="此 secret 不再展示。请立即保存到你的下游服务的环境变量。"
            />
            <Input.TextArea
              value={createdSecret.secret}
              autoSize
              readOnly
              styles={{ textarea: { fontFamily: 'monospace' } }}
            />
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                void navigator.clipboard.writeText(createdSecret.secret);
                message.success('已复制');
              }}
            >
              复制
            </Button>
            <Tooltip title="HMAC-SHA256 over body, X-Kintsugi-Signature: sha256=...">
              <Typography.Text type="secondary">
                验签：HMAC-SHA256 over request body；header X-Kintsugi-Signature
              </Typography.Text>
            </Tooltip>
          </Space>
        )}
      </Modal>

      <Drawer
        title={`投递历史 — ${historySub?.url ?? ''}`}
        width={720}
        open={historySub != null}
        onClose={() => {
          setHistorySub(null);
          setHistory([]);
        }}
      >
        <Table<WebhookDelivery>
          rowKey="id"
          size="small"
          loading={historyLoading}
          dataSource={history}
          pagination={{ pageSize: 20 }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 150,
              render: (v: string) => dayjs(v).format('MM-DD HH:mm:ss'),
            },
            { title: '事件', dataIndex: 'event', width: 130 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 110,
              render: (s: WebhookDelivery['status']) => {
                const color = s === 'success' ? 'green' : s === 'dead_lettered' ? 'red' : 'gold';
                return <Tag color={color}>{s}</Tag>;
              },
            },
            { title: '尝试', dataIndex: 'attempts', width: 60 },
            {
              title: 'HTTP',
              dataIndex: 'lastHttpStatus',
              width: 70,
              render: (v: number | null) =>
                v == null ? '—' : <Typography.Text code>{v}</Typography.Text>,
            },
            {
              title: '下次',
              dataIndex: 'nextAttemptAt',
              width: 130,
              render: (v: string | null) =>
                v ? (
                  <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm:ss')}>
                    {dayjs(v).format('MM-DD HH:mm')}
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
            {
              title: '错误',
              dataIndex: 'lastErrorMsg',
              ellipsis: true,
              render: (v: string | null) =>
                v ? (
                  <Tooltip title={v}>
                    <Typography.Text type="danger">{v}</Typography.Text>
                  </Tooltip>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}
