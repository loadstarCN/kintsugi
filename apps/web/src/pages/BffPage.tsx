import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import {
  api,
  type BffScriptSummary,
  type BffScriptType,
  type DatasetSummary, type PagedResult,} from '../api';
import { useApps } from '../AppContext';
import { hasGrant, useAuth } from '../auth';

const TYPE_COLOR: Record<BffScriptType, string> = {
  BEFORE_HOOK: 'gold',
  AFTER_HOOK: 'blue',
  ENDPOINT: 'green',
  PUBLIC_FUNCTION: 'purple',
};

const SAMPLE_CODE = `module.exports = async function handler(ctx) {
  // ctx.input 是调用方 payload
  // ctx.client.models['<datasetCode>'].filter / getOne / create / update / delete
  // ctx.client.sql.execute('<sqlCode>', { ...params })
  // ctx.client.tx(async () => { ...原子操作... })
  // ctx.userInfo: { userId, tenantCode, username } | null
  return { ok: true, echo: ctx.input };
};
`;

export function BffPage() {
  const { apps } = useApps();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:bff:write');
  const canExec = hasGrant(me, '*:bff:exec');
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [list, setList] = React.useState<BffScriptSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<BffScriptSummary | 'new' | null>(null);
  const [execTarget, setExecTarget] = React.useState<BffScriptSummary | null>(null);

  const refresh = React.useCallback(
    async (code: string, p = page, ps = pageSize) => {
      setLoading(true);
      try {
        const [rows, ds] = await Promise.all([
          api.get<PagedResult<BffScriptSummary>>(
            `/bff?appCode=${encodeURIComponent(code)}&page=${p}&pageSize=${ps}`,
          ),
          api.get<PagedResult<DatasetSummary>>(
            `/datasets?appCode=${encodeURIComponent(code)}&pageSize=500`,
          ).then((r) => r.data),
        ]);
        setList(rows.data);
        setTotal(rows.total);
        setDatasets(ds);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  React.useEffect(() => {
    if (apps && appCode === null && apps.length > 0) {
      const first = apps[0]!.appCode;
      setAppCode(first);
      void refresh(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  React.useEffect(() => {
    if (appCode) void refresh(appCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  if (!apps) return <Spin tip="加载…"><div style={{ padding: 32 }} /></Spin>;

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
              setList([]);
              void refresh(v);
            }}
            options={apps.map((a) => ({ value: a.appCode, label: a.name }))}
          />
          {canWrite && (
            <Button type="primary" disabled={!appCode} onClick={() => setEditTarget('new')}>
              + 新建脚本
            </Button>
          )}
          {appCode && <Button onClick={() => void refresh(appCode)}>刷新</Button>}
        </Space>
      </Card>

      <Card title={`Backend Function (${total})`}>
        {!loading && list.length === 0 ? (
          <Empty description="还没有 BFF 脚本。" />
        ) : (
          <Table<BffScriptSummary>
            rowKey="id"
            dataSource={list}
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
              {
                title: 'scriptName',
                dataIndex: 'scriptName',
                key: 'scriptName',
                render: (v: string, r) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{v}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      v{r.version}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '类型',
                dataIndex: 'type',
                key: 'type',
                render: (v: BffScriptType) => <Tag color={TYPE_COLOR[v]}>{v}</Tag>,
              },
              {
                title: '绑定 dataset',
                dataIndex: 'boundDataset',
                key: 'boundDataset',
                render: (v: string | null) => (v ? <Typography.Text code>{v.slice(0, 12)}…</Typography.Text> : '—'),
              },
              {
                title: '提交人',
                dataIndex: 'lastSubmitter',
                key: 'lastSubmitter',
                render: (v: string | null) => v ?? '—',
              },
              {
                title: '更新于',
                dataIndex: 'lastSubmittedAt',
                key: 'lastSubmittedAt',
                render: (v: string) => new Date(v).toLocaleString(),
              },
              {
                title: '操作',
                key: 'actions',
                width: 240,
                render: (_: unknown, r) => (
                  <Space wrap>
                    {r.type === 'ENDPOINT' && canExec && (
                      <Button size="small" type="primary" onClick={() => setExecTarget(r)}>
                        执行
                      </Button>
                    )}
                    {canWrite && (
                      <Button size="small" onClick={() => setEditTarget(r)}>
                        编辑
                      </Button>
                    )}
                    {canWrite && (
                      <Popconfirm
                        title="删除该 BFF 脚本？"
                        onConfirm={async () => {
                          try {
                            await api.delete(`/bff/${r.id}`);
                            message.success('已删除');
                            if (appCode) await refresh(appCode);
                          } catch (err) {
                            message.error((err as Error).message);
                          }
                        }}
                      >
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      {editTarget && appCode && (
        <EditDrawer
          appCode={appCode}
          datasets={datasets}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            if (appCode) await refresh(appCode);
          }}
        />
      )}

      {execTarget && appCode && (
        <ExecuteModal appCode={appCode} target={execTarget} onClose={() => setExecTarget(null)} />
      )}
    </Space>
  );
}

interface EditDrawerProps {
  appCode: string;
  datasets: DatasetSummary[];
  target: BffScriptSummary | 'new';
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function EditDrawer({ appCode, datasets, target, onClose, onSaved }: EditDrawerProps) {
  const isNew = target === 'new';
  const [form] = Form.useForm();
  const [code, setCode] = React.useState(SAMPLE_CODE);
  const [saving, setSaving] = React.useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  React.useEffect(() => {
    (async () => {
      if (isNew) {
        form.setFieldsValue({ scriptName: '', type: 'ENDPOINT', boundDataset: undefined });
        setCode(SAMPLE_CODE);
        return;
      }
      form.setFieldsValue({
        scriptName: target.scriptName,
        type: target.type,
        boundDataset: target.boundDataset ?? undefined,
      });
      try {
        const r = await api.get<{ code: string }>(`/bff/${target.id}/code`);
        setCode(r.code);
      } catch (err) {
        message.error((err as Error).message);
      }
    })().catch(() => undefined);
  }, [target, form, isNew]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await api.post('/bff', {
        appCode,
        scriptName: values.scriptName,
        type: values.type,
        ...(values.boundDataset ? { boundDataset: values.boundDataset } : {}),
        code,
      });
      message.success(isNew ? '已创建' : '已保存');
      await onSaved();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={isNew ? '新建 BFF 脚本' : `编辑 ${target.scriptName}`}
      width={isMobile ? '100vw' : 760}
      onClose={onClose}
      extra={
        <Space wrap size={[8, 4]}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" form={form}>
        <Form.Item label="名称" name="scriptName" rules={[{ required: true }]}>
          <Input placeholder="例如 calc-discount" disabled={!isNew} />
        </Form.Item>
        <Form.Item label="类型" name="type" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'ENDPOINT', label: 'ENDPOINT — 独立端点 /api/bff/exec/:app/:name' },
              { value: 'BEFORE_HOOK', label: 'BEFORE_HOOK — 写前钩子（需绑 dataset）' },
              { value: 'AFTER_HOOK', label: 'AFTER_HOOK — 读/写后钩子（需绑 dataset）' },
              { value: 'PUBLIC_FUNCTION', label: 'PUBLIC_FUNCTION — 公共函数（被其他脚本 require）' },
            ]}
          />
        </Form.Item>
        <Form.Item label="绑定 Dataset（hooks 必填）" name="boundDataset">
          <Select
            allowClear
            options={datasets.map((d) => ({
              value: d.datasetCode,
              label: `${d.tableName} · ${d.alias}`,
            }))}
          />
        </Form.Item>
        <Form.Item label="脚本源码（CommonJS · module.exports = async (ctx) => ...）" required>
          <Input.TextArea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={20}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

interface ExecuteModalProps {
  appCode: string;
  target: BffScriptSummary;
  onClose: () => void;
}

function ExecuteModal({ appCode, target, onClose }: ExecuteModalProps) {
  const [payload, setPayload] = React.useState('{}');
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(null);
  const [error, setError] = React.useState<string | null>(null);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const parsed = payload.trim() ? JSON.parse(payload) : {};
      const r = await api.post<unknown>(`/bff/exec/${appCode}/${target.scriptName}`, {
        payload: parsed,
      });
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open
      title={`执行：${target.scriptName} (${target.type})`}
      width={isMobile ? '95vw' : 720}
      onCancel={onClose}
      okText="运行"
      cancelText="关闭"
      confirmLoading={running}
      onOk={() => void run()}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>Payload (JSON)：</Typography.Text>
        <Input.TextArea
          rows={5}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          spellCheck={false}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        {error && <Alert type="error" message={error} />}
        {result !== null && (
          <Card size="small" title="返回">
            <pre
              style={{
                margin: 0,
                maxHeight: 320,
                overflow: 'auto',
                fontSize: 12,
                background: '#fafafa',
                padding: 8,
                borderRadius: 4,
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          </Card>
        )}
      </Space>
    </Modal>
  );
}
