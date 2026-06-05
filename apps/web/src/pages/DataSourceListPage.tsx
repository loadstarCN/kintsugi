import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
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
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  type CreateDataSourceInput,
  type DataSourcePublic,
  type DialectId, type PagedResult,
  type UpdateDataSourceInput,
} from '../api';
import { useApps } from '../AppContext';
import { hasGrant, useAuth } from '../auth';

const DIALECTS: ReadonlyArray<{ value: DialectId; label: string; defaultPort: number }> = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
  { value: 'mariadb', label: 'MariaDB', defaultPort: 3306 },
  { value: 'tidb', label: 'TiDB', defaultPort: 4000 },
  { value: 'mssql', label: 'SQL Server', defaultPort: 1433 },
  { value: 'oracle', label: 'Oracle', defaultPort: 1521 },
  { value: 'sqlite', label: 'SQLite', defaultPort: 0 },
];

const SCAN_STATUS_COLOR: Record<DataSourcePublic['lastScanStatus'], string> = {
  pending: 'default',
  scanning: 'processing',
  succeeded: 'success',
  failed: 'error',
};

export function DataSourceListPage() {
  const { apps, error: appsError } = useApps();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:datasource:write');
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [datasources, setDatasources] = React.useState<DataSourcePublic[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [bootstrapError, setBootstrapError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DataSourcePublic | null>(null);
  const navigate = useNavigate();

  const refresh = React.useCallback(async (code: string, p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const r = await api.get<PagedResult<DataSourcePublic>>(
        `/datasources?appCode=${encodeURIComponent(code)}&page=${p}&pageSize=${ps}`,
      );
      setDatasources(r.data);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  React.useEffect(() => {
    if (appsError) {
      setBootstrapError(appsError.message);
      return;
    }
    if (apps && appCode === null && apps.length > 0) {
      const first = apps[0]!.appCode;
      setAppCode(first);
      void refresh(first).catch((err) => setBootstrapError((err as Error).message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, appsError]);

  React.useEffect(() => {
    if (appCode) void refresh(appCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const handleTest = async (ds: DataSourcePublic) => {
    const hide = message.loading(`测试 ${ds.displayName} 连接中…`, 0);
    try {
      const r = await api.post<{ ok: boolean; version?: string; error?: string }>(
        `/datasources/${ds.id}/test`,
      );
      hide();
      if (r.ok) {
        message.success(`连接正常${r.version ? ` · ${r.version.split(' ').slice(0, 2).join(' ')}` : ''}`);
      } else {
        message.error(`连接失败：${r.error ?? '未知错误'}`);
      }
    } catch (err) {
      hide();
      message.error((err as Error).message);
    }
  };

  const handleScan = async (ds: DataSourcePublic) => {
    try {
      const r = await api.post<{ jobId: string }>(
        `/dbagent/datasources/${ds.id}/scan`,
        { sampleRowsPerTable: 3 },
      );
      message.success(`扫描已启动，jobId=${r.jobId}`);
      navigate(`/datasources/${ds.id}/scans/${r.jobId}`);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const handleDelete = async (ds: DataSourcePublic) => {
    try {
      await api.delete(`/datasources/${ds.id}`);
      message.success('已删除');
      if (appCode) await refresh(appCode);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const columns = React.useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'displayName',
        key: 'displayName',
        render: (v: string, row: DataSourcePublic) => (
          <Space direction="vertical" size={0}>
            <span>{v}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.id}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: '方言',
        dataIndex: 'dialect',
        key: 'dialect',
        render: (v: DialectId) => <Tag>{v}</Tag>,
      },
      {
        title: '连接',
        key: 'conn',
        render: (_: unknown, row: DataSourcePublic) => (
          <Typography.Text code>
            {row.username}@{row.host}:{row.port}/{row.database}
            {row.schema ? `?schema=${row.schema}` : ''}
          </Typography.Text>
        ),
      },
      {
        title: '最近扫描',
        key: 'lastScan',
        render: (_: unknown, row: DataSourcePublic) => (
          <Space direction="vertical" size={0}>
            <Tag color={SCAN_STATUS_COLOR[row.lastScanStatus]}>{row.lastScanStatus}</Tag>
            {row.lastScanAt && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(row.lastScanAt).toLocaleString()}
              </Typography.Text>
            )}
          </Space>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: canWrite ? 400 : 220,
        render: (_: unknown, row: DataSourcePublic) => (
          <Space wrap>
            {canWrite && (
              <Button size="small" onClick={() => void handleTest(row)}>
                测试连接
              </Button>
            )}
            {canWrite && (
              <Button size="small" onClick={() => setEditing(row)}>
                编辑
              </Button>
            )}
            {canWrite && (
              <Button size="small" type="primary" onClick={() => void handleScan(row)}>
                触发扫描
              </Button>
            )}
            <Link to={`/datasources/${row.id}/scans`}>
              <Button size="small">历史扫描</Button>
            </Link>
            <Link to={`/datasources/${row.id}/er`}>
              <Button size="small">ER 图</Button>
            </Link>
            {canWrite && (
              <Popconfirm
                title="删除此数据源？"
                description="相关扫描记录和 dataset 会级联删除。"
                onConfirm={() => void handleDelete(row)}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
              >
                <Button size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    // handleDelete / handleScan 是稳定 useCallback；不放进依赖避免每次组件重渲都重建 columns。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appCode, canWrite],
  );

  if (bootstrapError) {
    return (
      <Alert
        type="error"
        message="加载应用列表失败"
        description={
          <>
            {bootstrapError}
            <br />
            请确认后端已启动，并至少存在一个 tenant + application。可以跑：
            <Typography.Text code>pnpm --filter @kintsugi/server bootstrap:demo</Typography.Text>
          </>
        }
      />
    );
  }

  if (apps === null) {
    return <Spin tip="加载应用列表…"><div style={{padding:32}}/></Spin>;
  }

  if (apps.length === 0) {
    return (
      <Empty
        description={
          <>
            尚未创建任何应用。请先执行&nbsp;
            <Typography.Text code>pnpm --filter @kintsugi/server bootstrap:demo</Typography.Text>
            &nbsp;创建 demo app。
          </>
        }
      />
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space wrap style={{ width: '100%' }}>
          <span>应用：</span>
          <Select
            style={{ minWidth: 240, maxWidth: '100%' }}
            value={appCode ?? undefined}
            onChange={(v) => {
              setAppCode(v);
              setPage(1);
              setDatasources([]);
              void refresh(v, 1, pageSize);
            }}
            options={apps.map((a) => ({
              value: a.appCode,
              label: `${a.name} (${a.appCode})`,
            }))}
          />
          {canWrite && (
            <Button type="primary" onClick={() => setCreateOpen(true)} disabled={!appCode}>
              + 新建数据源
            </Button>
          )}
          {appCode && (
            <Button onClick={() => void refresh(appCode)} loading={loading}>
              刷新
            </Button>
          )}
        </Space>
      </Card>

      <Card title={`数据源 (${total})`}>
        {!loading && datasources.length === 0 ? (
          <Empty description="此应用下还没有数据源，点右上角 + 新建" />
        ) : (
          <Table<DataSourcePublic>
            rowKey="id"
            columns={columns}
            dataSource={datasources}
            loading={loading}
            size="middle"
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
          />
        )}
      </Card>

      {appCode && (
        <DataSourceFormModal
          open={createOpen}
          mode="create"
          appCode={appCode}
          initial={null}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void refresh(appCode);
          }}
        />
      )}
      {appCode && editing && (
        <DataSourceFormModal
          open={!!editing}
          mode="edit"
          appCode={appCode}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh(appCode);
          }}
        />
      )}
    </Space>
  );
}

interface FormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  appCode: string;
  initial: DataSourcePublic | null;
  onClose: () => void;
  onSaved: () => void;
}

function DataSourceFormModal({ open, mode, appCode, initial, onClose, onSaved }: FormModalProps) {
  const [form] = Form.useForm<CreateDataSourceInput>();
  const [submitting, setSubmitting] = React.useState(false);
  const [selectedDialect, setSelectedDialect] = React.useState<DialectId>('postgres');
  const isEdit = mode === 'edit';
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md; // < 768px

  React.useEffect(() => {
    if (open) {
      form.resetFields();
      if (isEdit && initial) {
        form.setFieldsValue({
          appCode,
          dialect: initial.dialect as DialectId,
          displayName: initial.displayName,
          host: initial.host,
          port: initial.port,
          database: initial.database,
          schema: initial.schema ?? '',
          username: initial.username,
          password: '',
          sslMode: (initial.sslMode as CreateDataSourceInput['sslMode']) ?? 'disable',
        });
        setSelectedDialect(initial.dialect as DialectId);
      } else {
        form.setFieldsValue({
          appCode,
          dialect: 'postgres',
          port: 5432,
          sslMode: 'disable',
        });
        setSelectedDialect('postgres');
      }
    }
  }, [open, isEdit, initial, appCode, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (isEdit && initial) {
        // 只送实际改了的字段，password 留空 = 不改
        const patch: UpdateDataSourceInput = {};
        if (values.displayName !== initial.displayName) patch.displayName = values.displayName;
        if (values.host !== initial.host) patch.host = values.host;
        if (values.port !== initial.port) patch.port = values.port;
        if (values.database !== initial.database) patch.database = values.database;
        if ((values.schema ?? '') !== (initial.schema ?? '')) patch.schema = values.schema ?? '';
        if (values.username !== initial.username) patch.username = values.username;
        if (values.password) patch.password = values.password;
        if (values.sslMode && values.sslMode !== initial.sslMode) patch.sslMode = values.sslMode;
        if (Object.keys(patch).length === 0) {
          message.info('没有可保存的修改');
          setSubmitting(false);
          return;
        }
        await api.patch<DataSourcePublic>(`/datasources/${initial.id}`, patch);
        message.success('已保存');
      } else {
        await api.post<DataSourcePublic>('/datasources', { ...values, appCode });
        message.success('已创建');
      }
      onSaved();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={isEdit ? '编辑数据源' : '新建数据源'}
      okText={isEdit ? '保存' : '创建'}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      width={isMobile ? '95vw' : 640}
      className="kintsugi-ds-create-modal"
    >
      <Form<CreateDataSourceInput>
        layout="vertical"
        form={form}
        initialValues={{ dialect: 'postgres', port: 5432, sslMode: 'disable' }}
      >
        <Form.Item
          label="数据源名称"
          name="displayName"
          rules={[{ required: true, max: 100 }]}
        >
          <Input placeholder="比如 生产订单库" />
        </Form.Item>
        <div className="kds-row">
          <Form.Item
            label="方言"
            name="dialect"
            style={{ flex: 2 }}
            rules={[{ required: true }]}
          >
            <Select
              disabled={isEdit}
              options={DIALECTS.map((d) => ({ value: d.value, label: d.label }))}
              onChange={(v: DialectId) => {
                setSelectedDialect(v);
                const d = DIALECTS.find((x) => x.value === v);
                if (d) form.setFieldValue('port', d.defaultPort);
                // schema 字段只对 PG 有意义；切到非 PG 主动清空，否则
                // 表单残值会被发到后端（disabled 不阻止 form.values 携带）
                if (v !== 'postgres') {
                  form.setFieldValue('schema', '');
                }
              }}
            />
          </Form.Item>
          <Form.Item
            label="Host"
            name="host"
            style={{ flex: 5 }}
            rules={[{ required: true, max: 253 }]}
          >
            <Input placeholder="127.0.0.1 或 db.example.com" />
          </Form.Item>
          <Form.Item
            label="Port"
            name="port"
            style={{ flex: 2 }}
            rules={[{ required: true, type: 'integer', min: 1, max: 65535 }]}
          >
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className="kds-row">
          <Form.Item
            label="Database"
            name="database"
            style={{ flex: 3 }}
            rules={[{ required: true, min: 1 }]}
          >
            <Input placeholder="业务库名" />
          </Form.Item>
          <Form.Item label="Schema（可选）" name="schema" style={{ flex: 3 }}>
            <Input
              placeholder={selectedDialect === 'postgres' ? 'public' : '(仅 PG 使用)'}
              disabled={selectedDialect !== 'postgres'}
            />
          </Form.Item>
        </div>
        <div className="kds-row">
          <Form.Item
            label="Username"
            name="username"
            style={{ flex: 1 }}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Password"
            name="password"
            style={{ flex: 1 }}
            rules={isEdit ? [] : [{ required: true }]}
            extra={isEdit ? '留空 = 不改密码' : undefined}
          >
            <Input.Password placeholder={isEdit ? '留空保持不变' : ''} />
          </Form.Item>
          <Form.Item label="SSL" name="sslMode" style={{ flex: 1 }}>
            <Select
              options={[
                { value: 'disable', label: 'disable' },
                { value: 'require', label: 'require' },
                { value: 'verify-ca', label: 'verify-ca' },
                { value: 'verify-full', label: 'verify-full' },
              ]}
            />
          </Form.Item>
        </div>
        <Alert
          type="info"
          showIcon
          message="密码以 AES-GCM 加密存入元数据库，仅在扫描/测试连接时解密。"
        />
      </Form>
    </Modal>
  );
}
