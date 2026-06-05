import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type DatasetDetail,
  type DoField,
  type FilterOp,
  type FilterRequest,
  type FilterResponse,
} from '../api';

const OP_OPTS: Array<{ value: FilterOp; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'ne', label: '≠' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'like', label: 'like' },
  { value: 'isNull', label: 'is null' },
  { value: 'isNotNull', label: 'is not null' },
];

interface FilterFragment {
  field: string;
  op: FilterOp;
  value?: string;
}

export function DatasetDataPage() {
  const { datasetCode } = useParams<{ datasetCode: string }>();
  const [detail, setDetail] = React.useState<DatasetDetail | null>(null);
  const [data, setData] = React.useState<FilterResponse | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [filters, setFilters] = React.useState<FilterFragment[]>([]);
  const [appliedFilters, setAppliedFilters] = React.useState<FilterFragment[]>([]);
  const [editRow, setEditRow] = React.useState<Record<string, unknown> | null>(null);
  const [editMode, setEditMode] = React.useState<'create' | 'update'>('create');
  const [detailRow, setDetailRow] = React.useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    if (!datasetCode) return;
    const d = await api.get<DatasetDetail>(`/datasets/${datasetCode}`);
    setDetail(d);
  }, [datasetCode]);

  React.useEffect(() => {
    loadDetail().catch((e: Error) => message.error(e.message));
  }, [loadDetail]);

  const fetch = React.useCallback(async () => {
    if (!detail) return;
    setLoading(true);
    try {
      const where = appliedFilters
        .filter((f) => f.op === 'isNull' || f.op === 'isNotNull' || (f.value !== '' && f.value != null))
        .map((f) => ({
          field: f.field,
          op: f.op,
          ...(f.op === 'isNull' || f.op === 'isNotNull' ? {} : { value: f.value }),
        }));
      const body: FilterRequest = {
        page,
        pageSize,
        ...(where.length ? { where } : {}),
      };
      const r = await api.post<FilterResponse>(
        `/apps/${detail.appCode}/ds/${detail.datasetCode}/filter`,
        body,
      );
      setData(r);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [detail, page, pageSize, appliedFilters]);

  React.useEffect(() => {
    void fetch();
  }, [fetch]);

  const onApplyFilters = () => {
    setPage(1);
    setAppliedFilters([...filters]);
  };

  const resetFilters = () => {
    setFilters([]);
    setAppliedFilters([]);
    setPage(1);
  };

  const submitEdit = async (values: Record<string, unknown>) => {
    if (!detail) return;
    try {
      if (editMode === 'create') {
        await api.post(`/apps/${detail.appCode}/ds/${detail.datasetCode}`, values);
        message.success('已创建');
      } else {
        const pk = detail.doJson.primaryKey[0]!;
        const id = String(editRow?.[pk] ?? '');
        await api.patch(`/apps/${detail.appCode}/ds/${detail.datasetCode}/${id}`, values);
        message.success('已更新');
      }
      setEditRow(null);
      await fetch();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  const onDelete = async (row: Record<string, unknown>) => {
    if (!detail) return;
    const pk = detail.doJson.primaryKey[0]!;
    const id = String(row[pk] ?? '');
    try {
      const r = await api.delete<{ softDeleted: boolean }>(
        `/apps/${detail.appCode}/ds/${detail.datasetCode}/${id}`,
      );
      message.success(r.softDeleted ? '已软删除' : '已删除');
      await fetch();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  /** 点行 → 拉单条最新完整记录 → 打开详情 Drawer。 */
  const openDetail = async (row: Record<string, unknown>) => {
    if (!detail) return;
    const pk = detail.doJson.primaryKey[0];
    if (!pk) {
      // 无主键：直接用列表里那行
      setDetailRow(row);
      return;
    }
    const id = String(row[pk] ?? '');
    setDetailRow(row); // 先用列表里这一行占位，避免抖动
    setDetailLoading(true);
    try {
      const fresh = await api.get<Record<string, unknown>>(
        `/apps/${detail.appCode}/ds/${detail.datasetCode}/${encodeURIComponent(id)}`,
      );
      setDetailRow(fresh);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  if (!detail) return <Spin tip="加载数据集…"><div style={{padding:32}}/></Spin>;
  const searchableFields = detail.doJson.fields.filter(
    (f) => f.searchable && !f.deprecated,
  );
  const visibleColumns = detail.doJson.fields.filter((f) => !f.deprecated);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <Link to="/datasets">数据集</Link> },
          { title: detail.tableName },
          { title: '数据' },
        ]}
      />
      <Card
        title={
          <Space>
            <Typography.Text code>{detail.tableName}</Typography.Text>
            <Tag>{detail.doJson.alias}</Tag>
            <Typography.Text type="secondary">
              走 Instant API · {detail.dataSourceId.slice(0, 10)}…
            </Typography.Text>
          </Space>
        }
        extra={
          <Space wrap size={[8, 4]}>
            <Link to={`/datasets/${detail.datasetCode}`}>
              <Button>DO 编辑</Button>
            </Link>
            <Button
              type="primary"
              onClick={() => {
                setEditMode('create');
                setEditRow({});
              }}
            >
              新建行
            </Button>
          </Space>
        }
      >
        {searchableFields.length > 0 && (
          <Space wrap style={{ marginBottom: 16, width: '100%' }}>
            <Select
              placeholder="加筛选"
              style={{ width: 220, maxWidth: '100%' }}
              value={undefined}
              options={searchableFields.map((f) => ({
                value: f.name,
                label: `${f.businessName} (${f.name})`,
              }))}
              onChange={(v) => {
                if (typeof v === 'string' && v) {
                  setFilters([...filters, { field: v, op: 'eq', value: '' }]);
                }
              }}
            />
            {filters.map((f, i) => (
              <Space.Compact key={i} style={{ flexWrap: 'wrap' }}>
                <Tag>{f.field}</Tag>
                <Select
                  size="small"
                  value={f.op}
                  options={OP_OPTS}
                  style={{ width: 100 }}
                  onChange={(op) =>
                    setFilters(filters.map((x, j) => (j === i ? { ...x, op } : x)))
                  }
                />
                {f.op !== 'isNull' && f.op !== 'isNotNull' && (
                  <Input
                    size="small"
                    style={{ width: 140 }}
                    value={f.value ?? ''}
                    onChange={(e) =>
                      setFilters(filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                  />
                )}
                <Button
                  size="small"
                  danger
                  onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </Space.Compact>
            ))}
            {filters.length > 0 && (
              <Space>
                <Button size="small" type="primary" onClick={onApplyFilters}>
                  应用
                </Button>
                <Button size="small" onClick={resetFilters}>
                  清空
                </Button>
              </Space>
            )}
          </Space>
        )}

        {!data ? (
          <Spin tip="拉数据…"><div style={{padding:32}}/></Spin>
        ) : (
          <Table
            rowKey={(row) => {
              const pk = detail.doJson.primaryKey[0];
              return pk ? String(row[pk]) : JSON.stringify(row);
            }}
            size="small"
            scroll={{ x: 'max-content' }}
            loading={loading}
            dataSource={data.data}
            onRow={(row) => ({
              onClick: (e) => {
                // 点到操作列里的按钮 / 链接时不触发详情
                const target = e.target as HTMLElement;
                if (target.closest('button, a, .ant-popconfirm, .ant-popover')) return;
                void openDetail(row);
              },
              style: { cursor: 'pointer' },
            })}
            pagination={{
              current: page,
              pageSize,
              total: data.total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (t) => `共 ${t} 行`,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            columns={[
              ...visibleColumns.map((f) => ({
                title: (
                  <Space direction="vertical" size={0}>
                    <span>{f.businessName}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {f.name}
                    </Typography.Text>
                  </Space>
                ),
                dataIndex: f.name,
                key: f.name,
                ellipsis: true,
                render: (v: unknown) => formatValue(v, f),
              })),
              {
                title: '操作',
                key: 'actions',
                fixed: 'right' as const,
                width: 140,
                render: (_: unknown, row: Record<string, unknown>) => (
                  <Space size="small">
                    <Button
                      size="small"
                      onClick={() => {
                        setEditMode('update');
                        setEditRow(row);
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除此行？"
                      onConfirm={() => void onDelete(row)}
                      okText="删除"
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}

        {data && data.data.length === 0 && <Alert type="info" message="无匹配行" />}
      </Card>

      {editRow !== null && detail && (
        <EditDrawer
          mode={editMode}
          do={detail.doJson.fields}
          initial={editRow}
          onClose={() => setEditRow(null)}
          onSubmit={submitEdit}
        />
      )}

      {detailRow !== null && detail && (
        <DetailDrawer
          loading={detailLoading}
          do={detail.doJson.fields}
          primaryKey={detail.doJson.primaryKey}
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onEdit={() => {
            setEditMode('update');
            setEditRow(detailRow);
            setDetailRow(null);
          }}
          onDelete={async () => {
            await onDelete(detailRow);
            setDetailRow(null);
          }}
        />
      )}
    </Space>
  );
}

function formatValue(v: unknown, f: DoField): React.ReactNode {
  if (v == null) return <Typography.Text type="secondary">null</Typography.Text>;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (f.logicalType === 'datetime' || f.logicalType === 'timestamptz' || f.logicalType === 'date') {
    try {
      return new Date(String(v)).toLocaleString();
    } catch {
      /* ignore */
    }
  }
  if (typeof v === 'object') return <code style={{ fontSize: 12 }}>{JSON.stringify(v)}</code>;
  const s = String(v);
  return s.length > 60 ? <span title={s}>{s.slice(0, 60) + '…'}</span> : s;
}

// ----------------- Detail Drawer（只读全字段）-----------------

interface DetailDrawerProps {
  loading: boolean;
  do: DoField[];
  primaryKey: string[];
  row: Record<string, unknown>;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

function DetailDrawer({
  loading,
  do: fields,
  primaryKey,
  row,
  onClose,
  onEdit,
  onDelete,
}: DetailDrawerProps) {
  const pkVal = primaryKey[0] ? String(row[primaryKey[0]] ?? '—') : '—';
  // 非废弃字段在前；废弃字段灰色放到末尾
  const [visible, deprecated] = React.useMemo(() => {
    const v: DoField[] = [];
    const d: DoField[] = [];
    for (const f of fields) (f.deprecated ? d : v).push(f);
    return [v, d];
  }, [fields]);

  return (
    <Drawer
      open
      width={560}
      title={
        <Space direction="vertical" size={0}>
          <span>记录详情</span>
          <Typography.Text code style={{ fontSize: 12 }}>
            {primaryKey[0] ?? 'row'} = {pkVal}
          </Typography.Text>
        </Space>
      }
      onClose={onClose}
      extra={
        <Space wrap size={[8, 4]}>
          <Popconfirm
            title="删除此行？"
            onConfirm={() => void onDelete()}
            okText="删除"
            okButtonProps={{ danger: true }}
          >
            <Button danger>删除</Button>
          </Popconfirm>
          <Button type="primary" onClick={onEdit}>
            编辑
          </Button>
        </Space>
      }
    >
      {loading && (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin tip="拉取最新…"><div style={{ padding: 8 }} /></Spin>
        </div>
      )}
      <div style={{ fontSize: 13 }}>
        {visible.map((f) => (
          <DetailRow key={f.name} field={f} value={row[f.name]} />
        ))}
        {deprecated.length > 0 && (
          <>
            <div
              style={{
                marginTop: 20,
                marginBottom: 6,
                fontFamily:
                  '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              }}
            >
              已废弃字段
            </div>
            {deprecated.map((f) => (
              <DetailRow key={f.name} field={f} value={row[f.name]} deprecated />
            ))}
          </>
        )}
      </div>
    </Drawer>
  );
}

function DetailRow({
  field,
  value,
  deprecated,
}: {
  field: DoField;
  value: unknown;
  deprecated?: boolean;
}) {
  return (
    <div
      className="kdsd-detail-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr',
        gap: 16,
        alignItems: 'start',
        padding: '10px 0',
        borderBottom: '1px solid #eeece4',
        opacity: deprecated ? 0.55 : 1,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12,
            color: '#0f172a',
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {field.businessName}
        </div>
        <div
          style={{
            fontFamily:
              '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
            fontSize: 10,
            letterSpacing: '0.04em',
            color: '#94a3b8',
            marginTop: 3,
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <span>{field.name}</span>
          <span style={{ color: '#cbd5e1' }}>·</span>
          <span>{field.logicalType}</span>
          {field.isPrimary && <span style={{ color: '#a07b3f' }}>· PK</span>}
          {field.role && field.role !== 'unknown' && (
            <span style={{ color: '#a07b3f' }}>· {field.role}</span>
          )}
        </div>
      </div>
      <div style={{ minWidth: 0, wordBreak: 'break-word' }}>
        <DetailValue value={value} field={field} />
      </div>
    </div>
  );
}

function DetailValue({ value, field }: { value: unknown; field: DoField }) {
  if (value === null || value === undefined) {
    return (
      <Typography.Text
        type="secondary"
        style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12 }}
      >
        null
      </Typography.Text>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <Tag color={value ? 'green' : 'default'}>{value ? 'true' : 'false'}</Tag>
    );
  }
  if (
    field.logicalType === 'datetime' ||
    field.logicalType === 'timestamptz' ||
    field.logicalType === 'date'
  ) {
    const d = new Date(String(value));
    if (!isNaN(d.getTime())) {
      return (
        <Space direction="vertical" size={0}>
          <span>{d.toLocaleString()}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {String(value)}
          </Typography.Text>
        </Space>
      );
    }
  }
  if (field.logicalType === 'json' || typeof value === 'object') {
    return (
      <pre
        style={{
          margin: 0,
          padding: 8,
          background: '#f5f1e8',
          border: '1px solid #eeece4',
          borderRadius: 4,
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  if (typeof value === 'number') {
    return (
      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13 }}>
        {Number.isInteger(value) ? value.toLocaleString() : value}
      </span>
    );
  }
  const s = String(value);
  // 长文本：带边框块
  if (s.length > 100) {
    return (
      <div
        style={{
          padding: '8px 10px',
          background: '#fafaf7',
          border: '1px solid #eeece4',
          borderRadius: 4,
          fontSize: 13,
          lineHeight: 1.55,
          maxHeight: 200,
          overflow: 'auto',
        }}
      >
        {s}
      </div>
    );
  }
  return <span style={{ fontSize: 13, color: '#0f172a' }}>{s}</span>;
}

interface EditDrawerProps {
  mode: 'create' | 'update';
  do: DoField[];
  initial: Record<string, unknown>;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}

function EditDrawer({ mode, do: fields, initial, onClose, onSubmit }: EditDrawerProps) {
  const [form] = Form.useForm();
  React.useEffect(() => {
    form.setFieldsValue(initial);
  }, [form, initial]);

  return (
    <Drawer
      open
      width={520}
      title={mode === 'create' ? '新建行' : '编辑行'}
      onClose={onClose}
      extra={
        <Space wrap size={[8, 4]}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={async () => {
              const values = await form.validateFields();
              await onSubmit(values);
            }}
          >
            提交
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" form={form}>
        {fields
          .filter((f) => !f.deprecated)
          .filter((f) => !(mode === 'create' && f.isAutoIncrement))
          .filter((f) => !['createdAt', 'updatedAt'].includes(f.role ?? ''))
          .map((f) => (
            <Form.Item
              key={f.name}
              name={f.name}
              label={
                <Space size={4}>
                  <span>{f.businessName}</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {f.name}
                  </Typography.Text>
                  {!f.nullable && <Tag color="red">必填</Tag>}
                </Space>
              }
              rules={f.nullable ? [] : [{ required: true, message: '必填' }]}
            >
              {renderFieldInput(f)}
            </Form.Item>
          ))}
      </Form>
    </Drawer>
  );
}

function renderFieldInput(f: DoField): React.ReactElement {
  if (f.enumValues?.length) {
    return <Select options={f.enumValues.map((v) => ({ value: v, label: String(v) }))} />;
  }
  if (f.logicalType === 'boolean') return <Switch />;
  if (['integer', 'bigint', 'decimal', 'float'].includes(f.logicalType)) {
    return <InputNumber style={{ width: '100%' }} />;
  }
  if (f.logicalType === 'json') return <Input.TextArea rows={4} />;
  return <Input />;
}
