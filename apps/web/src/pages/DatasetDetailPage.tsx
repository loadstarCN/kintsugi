import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type DatasetDetail,
  type DoField,
  type DoFieldRole,
  type DoJson,
} from '../api';
import { hasGrant, useAuth } from '../auth';

/** 兼容旧数据：pg 数组曾经以 "{a,b}" 字面量形式存进 DO.relations。 */
function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  }
  return [];
}

const ROLE_OPTS: Array<{ value: DoFieldRole; label: string }> = [
  { value: 'unknown', label: 'unknown' },
  { value: 'primaryKey', label: 'primaryKey' },
  { value: 'createdAt', label: 'createdAt' },
  { value: 'updatedAt', label: 'updatedAt' },
  { value: 'softDelete', label: 'softDelete' },
  { value: 'tenantCode', label: 'tenantCode' },
  { value: 'userId', label: 'userId' },
  { value: 'version', label: 'version' },
  { value: 'foreignKey', label: 'foreignKey' },
];

export function DatasetDetailPage() {
  const { datasetCode } = useParams<{ datasetCode: string }>();
  const navigate = useNavigate();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:dataset:write');
  const [detail, setDetail] = React.useState<DatasetDetail | null>(null);
  const [doJson, setDoJson] = React.useState<DoJson | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!datasetCode) return;
    const d = await api.get<DatasetDetail>(`/datasets/${datasetCode}`);
    setDetail(d);
    setDoJson(structuredClone(d.doJson));
    setDirty(false);
  }, [datasetCode]);

  React.useEffect(() => {
    load().catch((e: Error) => message.error(e.message));
  }, [load]);

  if (!detail || !doJson) return <Spin tip="加载 DO…"><div style={{padding:32}}/></Spin>;

  const updateField = (i: number, patch: Partial<DoField>) => {
    const next = { ...doJson, fields: doJson.fields.map((f, j) => (i === j ? { ...f, ...patch } : f)) };
    // 同步 DO 顶层的 roleField 索引
    const shortcut: Record<DoFieldRole, keyof DoJson> = {
      softDelete: 'softDeleteField',
      version: 'versionField',
      tenantCode: 'tenantField',
      userId: 'userField',
      createdAt: 'createdAtField',
      updatedAt: 'updatedAtField',
      primaryKey: 'tableName', // no-op placeholder
      foreignKey: 'tableName',
      unknown: 'tableName',
    };
    if (patch.role) {
      const key = shortcut[patch.role];
      if (key && key !== 'tableName') {
        (next as unknown as Record<string, string>)[key] = next.fields[i]!.name;
      }
    }
    setDoJson(next);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      // 乐观锁：把当前 GET 时拿到的 version 一起带上，server 端 conditional update。
      // 别人改过了 → 后端抛 BLOCKED_BY_CONCURRENT_EDIT，这里转成可操作的提示。
      const r = await api.patch<{ version: number }>(`/datasets/${datasetCode}/do`, {
        doJson,
        expectedVersion: detail.version,
      });
      message.success(`已保存 (v${r.version})`);
      await load();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('BLOCKED_BY_CONCURRENT_EDIT') || msg.includes('modified by another session')) {
        message.error('其他会话已修改该数据集；请点"刷新"拿最新版本后再保存');
      } else {
        message.error(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <Link to="/datasets">数据集</Link> },
          { title: detail.tableName },
          { title: 'DO' },
        ]}
      />
      <Card
        title={
          <Space>
            <Typography.Text code>{detail.tableName}</Typography.Text>
            <Tag>{doJson.alias}</Tag>
            <Typography.Text type="secondary">v{detail.version}</Typography.Text>
          </Space>
        }
        extra={
          <Space wrap size={[8, 4]}>
            <Button onClick={() => navigate(`/datasets/${datasetCode}/data`)}>去浏览数据</Button>
            {canWrite && (
              <Button loading={saving} type="primary" disabled={!dirty} onClick={() => void save()}>
                保存 DO
              </Button>
            )}
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {!canWrite && (
            <Alert
              type="info"
              showIcon
              message="只读模式"
              description="当前账号缺少 *:dataset:write 权限，无法编辑业务名、字段角色等。请联系管理员授予 developer 或 tenant-admin 角色。"
            />
          )}
          <Space wrap>
            <span>业务名：</span>
            <Input
              style={{ width: 240, maxWidth: '100%' }}
              value={doJson.alias}
              disabled={!canWrite}
              onChange={(e) => {
                setDoJson({ ...doJson, alias: e.target.value });
                setDirty(true);
              }}
            />
            <span>主键：</span>
            <Typography.Text code>{doJson.primaryKey.join(', ') || '—'}</Typography.Text>
          </Space>
          <Alert
            type="info"
            showIcon
            message={`特殊字段：softDelete=${doJson.softDeleteField ?? '—'} · version=${doJson.versionField ?? '—'} · tenant=${doJson.tenantField ?? '—'} · user=${doJson.userField ?? '—'} · createdAt=${doJson.createdAtField ?? '—'} · updatedAt=${doJson.updatedAtField ?? '—'}`}
          />
          <Table<DoField>
            rowKey="name"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={doJson.fields}
            columns={[
              {
                title: '列',
                dataIndex: 'name',
                key: 'name',
                render: (v: string, f) => (
                  <Space>
                    <Typography.Text code>{v}</Typography.Text>
                    {f.isPrimary && <Tag color="gold">PK</Tag>}
                    {f.isAutoIncrement && <Tag>auto</Tag>}
                  </Space>
                ),
              },
              {
                title: '原生类型',
                dataIndex: 'nativeType',
                key: 'nativeType',
                render: (v: string, f) => (
                  <Space direction="vertical" size={0}>
                    <span>{v}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {f.logicalType}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '业务名',
                key: 'businessName',
                render: (_: unknown, f, i) => (
                  <Input
                    size="small"
                    value={f.businessName}
                    disabled={!canWrite}
                    onChange={(e) => updateField(i, { businessName: e.target.value })}
                  />
                ),
              },
              {
                title: '角色',
                key: 'role',
                render: (_: unknown, f, i) => (
                  <Select
                    size="small"
                    style={{ width: 130 }}
                    value={f.role ?? 'unknown'}
                    options={ROLE_OPTS}
                    disabled={!canWrite}
                    onChange={(v) => updateField(i, { role: v })}
                  />
                ),
              },
              {
                title: '可搜索',
                key: 'searchable',
                width: 70,
                render: (_: unknown, f, i) => (
                  <Checkbox
                    checked={f.searchable ?? false}
                    disabled={!canWrite}
                    onChange={(e) => updateField(i, { searchable: e.target.checked })}
                  />
                ),
              },
              {
                title: '废弃',
                key: 'deprecated',
                width: 60,
                render: (_: unknown, f, i) => (
                  <Checkbox
                    checked={f.deprecated ?? false}
                    disabled={!canWrite}
                    onChange={(e) => updateField(i, { deprecated: e.target.checked })}
                  />
                ),
              },
              {
                title: '注释',
                dataIndex: 'comment',
                key: 'comment',
                render: (v?: string) =>
                  v ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {v}
                    </Typography.Text>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        </Space>
      </Card>

      <Card title={`关系 (${doJson.relations.length})`} size="small">
        <Table
          rowKey={(r) => `${r.toTable}|${asArray(r.fromColumns).join(',')}|${asArray(r.toColumns).join(',')}|${r.source}`}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={doJson.relations}
          columns={[
            {
              title: '从',
              key: 'from',
              render: (_: unknown, r) => (
                <Typography.Text code>{asArray(r.fromColumns).join(',')}</Typography.Text>
              ),
            },
            { title: '→ 表', dataIndex: 'toTable', key: 'toTable' },
            {
              title: '→ 列',
              key: 'toCols',
              render: (_: unknown, r) => (
                <Typography.Text code>{asArray(r.toColumns).join(',')}</Typography.Text>
              ),
            },
            { title: '类型', dataIndex: 'cardinality', key: 'cardinality' },
            {
              title: '来源',
              dataIndex: 'source',
              key: 'source',
              render: (v: string) => <Tag>{v}</Tag>,
            },
            {
              title: '置信度',
              dataIndex: 'confidence',
              key: 'confidence',
              render: (v: number) => v.toFixed(2),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
