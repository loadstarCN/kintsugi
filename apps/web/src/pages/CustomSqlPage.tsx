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
  type CustomSqlSummary,
  type DataSourcePublic,
  type RiskLevel,
  type SqlExecuteResult,
  type SqlValidateResult, type PagedResult,} from '../api';
import { useApps } from '../AppContext';
import { hasGrant, useAuth } from '../auth';

const RISK_COLOR: Record<RiskLevel, string> = {
  low: 'green',
  medium: 'gold',
  high: 'orange',
  critical: 'red',
};

export function CustomSqlPage() {
  const { apps } = useApps();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:sql:write');
  const canExec = hasGrant(me, '*:sql:exec');
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [dataSources, setDataSources] = React.useState<DataSourcePublic[]>([]);
  const [list, setList] = React.useState<CustomSqlSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<CustomSqlSummary | 'new' | null>(null);
  const [execTarget, setExecTarget] = React.useState<CustomSqlSummary | null>(null);

  const refresh = React.useCallback(
    async (code: string, p = page, ps = pageSize) => {
      setLoading(true);
      try {
        const [rows, ds] = await Promise.all([
          api.get<PagedResult<CustomSqlSummary>>(
            `/sql?appCode=${encodeURIComponent(code)}&page=${p}&pageSize=${ps}`,
          ),
          api.get<PagedResult<DataSourcePublic>>(
            `/datasources?appCode=${encodeURIComponent(code)}&pageSize=500`,
          ).then((r) => r.data),
        ]);
        setList(rows.data);
        setTotal(rows.total);
        setDataSources(ds);
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
              + 新建 SQL
            </Button>
          )}
          {appCode && <Button onClick={() => void refresh(appCode)}>刷新</Button>}
        </Space>
      </Card>

      <Card title={`Custom SQL (${total})`}>
        {!loading && list.length === 0 ? (
          <Empty description="还没有 Custom SQL。点上面 + 新建。" />
        ) : (
          <Table<CustomSqlSummary>
            rowKey="sqlCode"
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
                title: 'sqlName',
                dataIndex: 'sqlName',
                key: 'sqlName',
                render: (v: string, r) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{v}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {r.sqlCode}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '内容',
                dataIndex: 'content',
                key: 'content',
                ellipsis: true,
                render: (v: string) => <Typography.Text code>{v.slice(0, 80)}{v.length > 80 ? '…' : ''}</Typography.Text>,
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
                    {canExec && (
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
                        title="删除这条 SQL？"
                        onConfirm={async () => {
                          try {
                            await api.delete(`/sql/${r.sqlCode}`);
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
            expandable={{
              expandedRowRender: (r) => (
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    background: '#fafafa',
                    border: '1px solid #f0f0f0',
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                  }}
                >
                  {r.content}
                </pre>
              ),
            }}
          />
        )}
      </Card>

      {editTarget && appCode && (
        <EditDrawer
          appCode={appCode}
          dataSources={dataSources}
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async () => {
            setEditTarget(null);
            if (appCode) await refresh(appCode);
          }}
        />
      )}

      {execTarget && (
        <ExecuteModal
          target={execTarget}
          onClose={() => setExecTarget(null)}
        />
      )}
    </Space>
  );
}

interface EditDrawerProps {
  appCode: string;
  dataSources: DataSourcePublic[];
  target: CustomSqlSummary | 'new';
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function EditDrawer({ appCode, dataSources, target, onClose, onSaved }: EditDrawerProps) {
  const isNew = target === 'new';
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);
  const [validateResult, setValidateResult] = React.useState<SqlValidateResult | null>(null);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  React.useEffect(() => {
    if (isNew) {
      form.setFieldsValue({
        sqlName: '',
        content: '',
        dataSourceId: dataSources[0]?.id,
      });
    } else {
      form.setFieldsValue({
        sqlName: target.sqlName,
        content: target.content,
        dataSourceId: target.dataSourceId,
      });
    }
    setValidateResult(null);
  }, [target, form, dataSources, isNew]);

  const validate = async () => {
    const content = form.getFieldValue('content') as string | undefined;
    if (!content?.trim()) return;
    try {
      const r = await api.post<SqlValidateResult>('/sql/validate', { content });
      setValidateResult(r);
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (isNew) {
        await api.post('/sql', {
          appCode,
          dataSourceId: values.dataSourceId,
          sqlName: values.sqlName,
          content: values.content,
        });
        message.success('已创建');
      } else {
        await api.patch(`/sql/${target.sqlCode}`, {
          sqlName: values.sqlName,
          content: values.content,
        });
        message.success('已保存');
      }
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
      title={isNew ? '新建 Custom SQL' : `编辑 ${target.sqlName}`}
      width={isMobile ? '100vw' : 680}
      onClose={onClose}
      extra={
        <Space wrap size={[8, 4]}>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => void validate()}>校验风险</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" form={form}>
        <Form.Item label="名称" name="sqlName" rules={[{ required: true }]}>
          <Input placeholder="例如 count-goods-by-type" />
        </Form.Item>
        <Form.Item
          label="目标数据源"
          name="dataSourceId"
          rules={[{ required: true }]}
        >
          <Select
            disabled={!isNew}
            options={dataSources.map((d) => ({
              value: d.id,
              label: `${d.displayName} · ${d.dialect}@${d.host}/${d.database}`,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="SQL（用 #{name} 占位参数）"
          name="content"
          rules={[{ required: true, min: 4 }]}
        >
          <Input.TextArea
            rows={10}
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
            placeholder={'select count(*) as cnt from goods where type = #{type}'}
          />
        </Form.Item>
        {validateResult && (
          <Alert
            type={
              validateResult.riskLevel === 'low'
                ? 'success'
                : validateResult.riskLevel === 'medium'
                  ? 'warning'
                  : 'error'
            }
            message={
              <Space>
                <span>风险：</span>
                <Tag color={RISK_COLOR[validateResult.riskLevel]}>{validateResult.riskLevel}</Tag>
                <span>占位符：</span>
                {validateResult.placeholders.length === 0
                  ? '无'
                  : validateResult.placeholders.map((p) => <Tag key={p}>#{`{${p}}`}</Tag>)}
              </Space>
            }
          />
        )}
      </Form>
    </Drawer>
  );
}

interface ExecuteModalProps {
  target: CustomSqlSummary;
  onClose: () => void;
}

function ExecuteModal({ target, onClose }: ExecuteModalProps) {
  const [validate, setValidate] = React.useState<SqlValidateResult | null>(null);
  const [params, setParams] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<SqlExecuteResult | null>(null);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  React.useEffect(() => {
    void api.post<SqlValidateResult>('/sql/validate', { content: target.content }).then(setValidate);
  }, [target.content]);

  const run = async () => {
    setRunning(true);
    try {
      // 不传 actor —— 后端从 JWT 推导（登录用户 = human），body 携带 actor 会被
      // forbidNonWhitelisted 拒掉，且会让前端用户能伪装成任何 actor 绕过审计闸。
      const r = await api.post<SqlExecuteResult>(`/sql/${target.sqlCode}/execute`, {
        params,
        sqlSafe: true,
      });
      setResult(r);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open
      title={`执行：${target.sqlName}`}
      onCancel={onClose}
      width={isMobile ? '95vw' : 760}
      okText="运行"
      cancelText="关闭"
      confirmLoading={running}
      onOk={() => void run()}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <pre
          style={{
            margin: 0,
            padding: 8,
            background: '#fafafa',
            border: '1px solid #f0f0f0',
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            fontSize: 12,
          }}
        >
          {target.content}
        </pre>

        {validate && (
          <Space wrap>
            <Tag color={RISK_COLOR[validate.riskLevel]}>风险：{validate.riskLevel}</Tag>
            {validate.placeholders.length === 0 ? (
              <Tag>无参数</Tag>
            ) : (
              validate.placeholders.map((p) => (
                <Space key={p}>
                  <Tag>#{`{${p}}`}</Tag>
                  <Input
                    size="small"
                    style={{ width: 160 }}
                    value={params[p] ?? ''}
                    placeholder={p}
                    onChange={(e) => setParams({ ...params, [p]: e.target.value })}
                  />
                </Space>
              ))
            )}
          </Space>
        )}

        {result && (
          <Card size="small" title={<Tag color={result.error ? 'red' : 'green'}>{result.rowCount} 行</Tag>}>
            {result.error ? (
              <Alert type="error" message={result.error} />
            ) : (
              <pre
                style={{
                  margin: 0,
                  maxHeight: 360,
                  overflow: 'auto',
                  fontSize: 12,
                  background: '#fafafa',
                  padding: 8,
                  borderRadius: 4,
                }}
              >
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </Card>
        )}
      </Space>
    </Modal>
  );
}
