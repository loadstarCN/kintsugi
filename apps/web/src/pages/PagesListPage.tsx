import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Grid,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ApplicationSummary, type DatasetSummary, type PagedResult } from '../api';
import { hasGrant, useAuth } from '../auth';

interface PageSummary {
  id: string;
  appCode: string;
  name: string;
  type: string;
  routePath: string;
  status: string;
  updatedAt: string;
}

export function PagesListPage() {
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:page:write');
  const [apps, setApps] = React.useState<ApplicationSummary[] | null>(null);
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [pages, setPages] = React.useState<PageSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [genOpen, setGenOpen] = React.useState(false);
  const navigate = useNavigate();

  const refresh = React.useCallback(
    async (code: string, p = page, ps = pageSize) => {
      setLoading(true);
      try {
        const r = await api.get<PagedResult<PageSummary>>(
          `/pages?appCode=${encodeURIComponent(code)}&page=${p}&pageSize=${ps}`,
        );
        setPages(r.data);
        setTotal(r.total);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  React.useEffect(() => {
    (async () => {
      const list = await api.get<PagedResult<ApplicationSummary>>('/applications?pageSize=500').then(r => r.data);
      setApps(list);
      const first = list[0]?.appCode ?? null;
      setAppCode(first);
      if (first) await refresh(first);
    })().catch((e: Error) => message.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (appCode) void refresh(appCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  if (!apps) return <Spin tip="加载应用…"><div style={{ padding: 32 }} /></Spin>;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space wrap style={{ width: '100%' }}>
          <span>应用：</span>
          <Select
            style={{ minWidth: 220, maxWidth: '100%' }}
            value={appCode ?? undefined}
            onChange={(v) => {
              setAppCode(v);
              setPages([]);
              void refresh(v);
            }}
            options={apps.map((a) => ({ value: a.appCode, label: a.name }))}
          />
          {canWrite && (
            <Button type="primary" disabled={!appCode} onClick={() => setGenOpen(true)}>
              AI 生成页面
            </Button>
          )}
        </Space>
      </Card>
      <Card title={`页面 (${total})`}>
        {!loading && pages.length === 0 ? (
          <Empty description="还没有页面。点右上角 AI 生成。" />
        ) : (
          <Table<PageSummary>
            rowKey="id"
            dataSource={pages}
            loading={loading}
            scroll={{ x: 'max-content' }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (t) => `共 ${t} 条`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            columns={[
              { title: '名称', dataIndex: 'name', key: 'name' },
              {
                title: '类型',
                dataIndex: 'type',
                key: 'type',
                render: (v) => <Tag>{v}</Tag>,
              },
              {
                title: '路由',
                dataIndex: 'routePath',
                key: 'routePath',
                render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                render: (v: string) => (
                  <Tag color={v === 'published' ? 'green' : 'default'}>{v}</Tag>
                ),
              },
              {
                title: '更新于',
                dataIndex: 'updatedAt',
                key: 'updatedAt',
                render: (v: string) => new Date(v).toLocaleString(),
              },
              {
                title: '操作',
                key: 'actions',
                render: (_: unknown, row) => (
                  <Space>
                    <Link to={`/pages/${row.id}`}>
                      <Button size="small" type="primary">
                        打开
                      </Button>
                    </Link>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      {genOpen && appCode && (
        <GenerateModal
          appCode={appCode}
          onClose={() => setGenOpen(false)}
          onDone={(id) => {
            setGenOpen(false);
            navigate(`/pages/${id}`);
          }}
        />
      )}
    </Space>
  );
}

function GenerateModal({
  appCode,
  onClose,
  onDone,
}: {
  appCode: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [datasets, setDatasets] = React.useState<DatasetSummary[] | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  React.useEffect(() => {
    api.get<PagedResult<DatasetSummary>>(`/datasets?appCode=${encodeURIComponent(appCode)}&pageSize=500`).then(r => r.data)
      .then(setDatasets)
      .catch((e: Error) => setErr(e.message));
  }, [appCode]);

  const submit = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ pageId: string; description: string }>(
        `/apps/${appCode}/pages/generate`,
        {
          prompt,
          datasetCodes: selected.length > 0 ? selected : undefined,
        },
      );
      message.success(`已生成：${r.description}`);
      onDone(r.pageId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="AI 生成页面"
      width={isMobile ? '95vw' : 720}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={busy}
          disabled={!prompt.trim()}
          onClick={() => void submit()}
        >
          生成
        </Button>,
      ]}
    >
      {err && <Alert type="error" message={err} style={{ marginBottom: 12 }} />}
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text>需求描述（自然语言）：</Typography.Text>
          <Input.TextArea
            rows={4}
            placeholder="例：做一个商品列表页，按 type 筛选，显示名称/价格/上架时间，点击行可编辑。"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div>
          <Typography.Text>关联数据集（不选 = 默认取前 10 个）：</Typography.Text>
          {!datasets ? (
            <Spin />
          ) : (
            <Checkbox.Group
              style={{ display: 'block', maxHeight: 200, overflow: 'auto', marginTop: 8 }}
              value={selected}
              onChange={(v) => setSelected(v as string[])}
              options={datasets.map((d) => ({
                value: d.datasetCode,
                label: `${d.tableName} · ${d.alias}`,
              }))}
            />
          )}
        </div>
      </Space>
    </Modal>
  );
}
