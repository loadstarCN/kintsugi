import {
  Button,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import * as React from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { api, buildPageQuery, type ApplicationSummary, type PagedResult } from '../api';
import { message } from '../notify';

interface AuditEntry {
  id: string;
  tenantCode: string;
  appCode: string | null;
  userId: string | null;
  accessKey: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  traceparent: string | null;
  createdAt: string;
  afterJson: unknown;
}

interface FilterState {
  appCode?: string;
  userId?: string;
  accessKey?: string;
  action?: string;
  range?: [Dayjs | null, Dayjs | null];
}

/**
 * 给一行打"风险标签"用于行高亮 + 一个小角标。
 * 优先级：failed > critical > sensitive > none。
 */
type RowFlag = 'critical' | 'sensitive' | 'failed' | null;

function classifyRow(e: AuditEntry): RowFlag {
  const a = e.action;
  if (a.endsWith('FAILED')) return 'failed';
  // DELETE 任意资源；access-key rotate / revoke；DDL 类危险路径
  if (
    a.startsWith('DELETE ') ||
    /\/access-keys\/[^/]+\/rotate$/.test(a) ||
    /(DROP|TRUNCATE|GRANT|REVOKE)/i.test(a)
  ) {
    return 'critical';
  }
  // 创建 access-key、注册新 user、发布 page、强制 logout 全 session 等
  if (
    /^POST .*\/access-keys$/.test(a) ||
    /^POST .*\/auth\/register$/.test(a) ||
    /^POST .*\/pages\/[^/]+\/publish$/.test(a)
  ) {
    return 'sensitive';
  }
  return null;
}

const ROW_STYLES: Record<Exclude<RowFlag, null>, React.CSSProperties> = {
  critical: { background: 'rgba(220, 38, 38, 0.08)' },
  sensitive: { background: 'rgba(217, 119, 6, 0.08)' },
  failed: { background: 'rgba(202, 138, 4, 0.10)' },
};

const FLAG_LABEL: Record<Exclude<RowFlag, null>, { color: string; text: string }> = {
  critical: { color: 'red', text: '危险' },
  sensitive: { color: 'orange', text: '敏感' },
  failed: { color: 'gold', text: '失败' },
};

export function AuditLogsPage() {
  const [apps, setApps] = React.useState<ApplicationSummary[]>([]);
  const [filters, setFilters] = React.useState<FilterState>({});
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [data, setData] = React.useState<AuditEntry[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    void api
      .get<PagedResult<ApplicationSummary>>('/applications?pageSize=500')
      .then((r) => setApps(r.data))
      .catch((e: Error) => message.error(e.message));
  }, []);

  const queryString = React.useMemo(() => {
    const [from, to] = filters.range ?? [];
    return buildPageQuery(
      {
        ...(filters.appCode ? { appCode: filters.appCode } : {}),
        ...(filters.userId ? { userId: filters.userId.trim() } : {}),
        ...(filters.accessKey ? { accessKey: filters.accessKey.trim() } : {}),
        ...(filters.action ? { action: filters.action.trim() } : {}),
        ...(from ? { from: from.toISOString() } : {}),
        ...(to ? { to: to.toISOString() } : {}),
      },
      { page, pageSize },
    );
  }, [filters, page, pageSize]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<PagedResult<AuditEntry>>(`/audit-logs${queryString}`);
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const downloadCsv = async (): Promise<void> => {
    setExporting(true);
    try {
      // 复用同一组 filter（不带 page / pageSize）
      const [from, to] = filters.range ?? [];
      const params = new URLSearchParams();
      if (filters.appCode) params.set('appCode', filters.appCode);
      if (filters.userId?.trim()) params.set('userId', filters.userId.trim());
      if (filters.accessKey?.trim()) params.set('accessKey', filters.accessKey.trim());
      if (filters.action?.trim()) params.set('action', filters.action.trim());
      if (from) params.set('from', from.toISOString());
      if (to) params.set('to', to.toISOString());
      const qs = params.toString();
      const res = await fetch(`/api/audit-logs/export${qs ? `?${qs}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename =
        res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ??
        `audit-logs-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${filename} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      title: '',
      key: '_flag',
      width: 60,
      render: (_: unknown, row: AuditEntry) => {
        const flag = classifyRow(row);
        if (!flag) return null;
        const m = FLAG_LABEL[flag];
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '动作',
      dataIndex: 'action',
      ellipsis: true,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '应用',
      dataIndex: 'appCode',
      width: 150,
      render: (v: string | null) =>
        v ? (
          <Tag color="blue">{v}</Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '用户',
      dataIndex: 'userId',
      width: 200,
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text code>{v.slice(0, 12)}…</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'AccessKey',
      dataIndex: 'accessKey',
      width: 200,
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Tag
              color="orange"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setFilters((f) => ({ ...f, accessKey: v }));
                setPage(1);
              }}
            >
              {v}
            </Tag>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Trace',
      dataIndex: 'traceparent',
      width: 90,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Typography.Text type="secondary">trace</Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Payload',
      dataIndex: 'afterJson',
      render: (v: unknown) =>
        v == null ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Tooltip title={<pre style={{ margin: 0, maxWidth: 600, overflow: 'auto' }}>{JSON.stringify(v, null, 2)}</pre>}>
            <Typography.Text type="secondary">view</Typography.Text>
          </Tooltip>
        ),
    },
  ];

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        审计日志
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        所有写请求和敏感读请求（SQL / BFF / Chats）都会留痕。HMAC 路径 access key 落
        <Tag color="orange" style={{ marginInline: 4 }}>AccessKey</Tag>
        列；点击 tag 即按该 key 过滤。
      </Typography.Paragraph>

      <Form
        layout="inline"
        style={{ marginBottom: 16, rowGap: 8, columnGap: 8, flexWrap: 'wrap' }}
      >
        <Form.Item label="应用">
          <Select
            allowClear
            placeholder="全部"
            style={{ width: 200 }}
            value={filters.appCode}
            onChange={(v) => {
              setFilters((f) => ({ ...f, appCode: v ?? undefined }));
              setPage(1);
            }}
            options={apps.map((a) => ({ value: a.appCode, label: `${a.name} (${a.appCode})` }))}
          />
        </Form.Item>
        <Form.Item label="UserId">
          <Input
            allowClear
            style={{ width: 200 }}
            value={filters.userId ?? ''}
            placeholder="cuid…"
            onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))}
            onPressEnter={() => setPage(1)}
          />
        </Form.Item>
        <Form.Item label="AccessKey">
          <Input
            allowClear
            style={{ width: 220 }}
            value={filters.accessKey ?? ''}
            placeholder="ak_…"
            onChange={(e) => setFilters((f) => ({ ...f, accessKey: e.target.value }))}
            onPressEnter={() => setPage(1)}
          />
        </Form.Item>
        <Form.Item label="动作">
          <Input
            allowClear
            style={{ width: 240 }}
            value={filters.action ?? ''}
            placeholder="POST /api/apps/...  (模糊匹配)"
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            onPressEnter={() => setPage(1)}
          />
        </Form.Item>
        <Form.Item label="时间">
          <DatePicker.RangePicker
            showTime={{ format: 'HH:mm' }}
            value={filters.range as never}
            onChange={(v) =>
              setFilters((f) => ({ ...f, range: (v as [Dayjs | null, Dayjs | null] | null) ?? undefined }))
            }
          />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()} loading={loading}>
              查询
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => void downloadCsv()}
              loading={exporting}
            >
              导出 CSV
            </Button>
            <Button
              type="text"
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
            >
              清空
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table<AuditEntry>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={data}
        columns={columns}
        onRow={(row) => {
          const flag = classifyRow(row);
          return flag ? { style: ROW_STYLES[flag] } : {};
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />
    </div>
  );
}
