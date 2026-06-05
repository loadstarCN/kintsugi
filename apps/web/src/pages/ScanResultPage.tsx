import {
  Alert,
  Breadcrumb,
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type DataSourcePublic } from '../api';

interface ScanJobFull {
  id: string;
  dataSourceId: string;
  status: 'pending' | 'scanning' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tokensUsed: number | null;
  errorMessage: string | null;
  rawSnapshot: RawSnapshot | null;
  inferredModel: InferredModel | null;
}

interface RawSnapshot {
  dialect: string;
  database: string;
  tables: Array<{
    schema: string;
    name: string;
    comment?: string;
    rowCount?: number;
    columns: Array<{
      name: string;
      nativeType: string;
      logicalType: string;
      nullable: boolean;
      isAutoIncrement?: boolean;
      primaryKeyOrder?: number;
      enumValues?: string[];
      comment?: string;
    }>;
    foreignKeys: Array<{
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
    }>;
  }>;
}

interface InferredModel {
  tables?: Array<{
    name: string;
    semanticName?: string;
    summary?: string;
    columns?: Array<{
      name: string;
      semanticName?: string;
      role?: string;
      notes?: string;
    }>;
  }>;
  relations?: Array<{
    fromTable: string;
    fromColumns: string[];
    toTable: string;
    toColumns: string[];
    kind?: string;
    confidence?: number;
    reason?: string;
  }>;
  ruleCandidates?: Array<{
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    heuristicScore: number;
    reason?: string;
  }>;
}

const STATUS_COLOR = {
  pending: 'default',
  scanning: 'processing',
  succeeded: 'success',
  failed: 'error',
} as const;

export function ScanResultPage() {
  const { dsId, jobId } = useParams<{ dsId: string; jobId: string }>();
  const [ds, setDs] = React.useState<DataSourcePublic | null>(null);
  const [job, setJob] = React.useState<ScanJobFull | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const poll = React.useCallback(async () => {
    if (!jobId) return;
    try {
      const j = await api.get<ScanJobFull>(`/dbagent/jobs/${jobId}`);
      setJob(j);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [jobId]);

  React.useEffect(() => {
    if (!dsId) return;
    api
      .get<DataSourcePublic>(`/datasources/${dsId}`)
      .then(setDs)
      .catch((err: Error) => setError(err.message));
  }, [dsId]);

  React.useEffect(() => {
    void poll();
  }, [poll]);

  // 轮询直到 job 结束
  React.useEffect(() => {
    if (!job) return;
    if (job.status === 'pending' || job.status === 'scanning') {
      const t = setTimeout(() => {
        void poll();
      }, 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [job, poll]);

  if (error) {
    return <Alert type="error" message="加载失败" description={error} />;
  }

  if (!job) {
    return <Spin tip="加载扫描任务…"><div style={{padding:32}}/></Spin>;
  }

  const snapshot = job.rawSnapshot;
  const inferred = job.inferredModel;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <Link to="/datasources">数据源</Link> },
          {
            title: ds?.displayName ?? dsId,
          },
          {
            title: <Link to={`/datasources/${dsId}/scans`}>历史扫描</Link>,
          },
          { title: jobId },
        ]}
      />

      <Card title="扫描任务概览">
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={12} md={6}>
            <Statistic
              title="状态"
              valueRender={() => <Tag color={STATUS_COLOR[job.status]}>{job.status}</Tag>}
              value={job.status}
            />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Statistic title="表数" value={snapshot?.tables.length ?? 0} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Statistic
              title="声明外键"
              value={snapshot?.tables.reduce((n, t) => n + t.foreignKeys.length, 0) ?? 0}
            />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Statistic title="LLM Tokens" value={job.tokensUsed ?? 0} />
          </Col>
        </Row>
        <Descriptions size="small" column={{ xs: 1, sm: 2 }} style={{ marginTop: 16 }}>
          <Descriptions.Item label="开始">
            {new Date(job.startedAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="结束">
            {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : '（进行中）'}
          </Descriptions.Item>
          <Descriptions.Item label="方言">{snapshot?.dialect ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="数据库">{snapshot?.database ?? '—'}</Descriptions.Item>
        </Descriptions>
        {job.errorMessage && (
          <Alert
            style={{ marginTop: 12 }}
            type="error"
            message="扫描报错"
            description={<pre style={{ whiteSpace: 'pre-wrap' }}>{job.errorMessage}</pre>}
          />
        )}
      </Card>

      <Tabs
        items={[
          {
            key: 'tables',
            label: `表 (${snapshot?.tables.length ?? 0})`,
            children: <TablesView snapshot={snapshot} inferred={inferred} />,
          },
          {
            key: 'relations',
            label: `推断关系 (${(inferred?.relations?.length ?? inferred?.ruleCandidates?.length) ?? 0})`,
            children: <RelationsView inferred={inferred} />,
          },
          {
            key: 'raw',
            label: '原始 JSON',
            children: (
              <Card>
                <Typography.Paragraph>
                  <Typography.Text strong>rawSnapshot</Typography.Text>
                </Typography.Paragraph>
                <pre style={{ maxHeight: 360, overflow: 'auto', background: '#fafafa', padding: 12 }}>
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
                <Typography.Paragraph style={{ marginTop: 24 }}>
                  <Typography.Text strong>inferredModel</Typography.Text>
                </Typography.Paragraph>
                <pre style={{ maxHeight: 360, overflow: 'auto', background: '#fafafa', padding: 12 }}>
                  {JSON.stringify(inferred, null, 2)}
                </pre>
              </Card>
            ),
          },
        ]}
      />
    </Space>
  );
}

function TablesView({
  snapshot,
  inferred,
}: {
  snapshot: RawSnapshot | null;
  inferred: InferredModel | null;
}) {
  if (!snapshot) return <Empty description="暂无快照" />;
  const semMap = new Map(inferred?.tables?.map((t) => [t.name, t]) ?? []);
  return (
    <Table
      rowKey={(r) => `${r.schema}.${r.name}`}
      size="small"
      pagination={{ pageSize: 20 }}
      scroll={{ x: 'max-content' }}
      dataSource={snapshot.tables}
      columns={[
        {
          title: '表',
          dataIndex: 'name',
          key: 'name',
          render: (name: string, row) => (
            <Space direction="vertical" size={0}>
              <Typography.Text code>{name}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {semMap.get(name)?.semanticName ?? row.comment ?? ''}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: '列数',
          dataIndex: 'columns',
          key: 'cols',
          render: (cols: RawSnapshot['tables'][number]['columns']) => cols.length,
          width: 80,
        },
        {
          title: '行数',
          dataIndex: 'rowCount',
          key: 'rowCount',
          render: (v?: number) => (v === undefined ? '—' : v.toLocaleString()),
          width: 120,
        },
        {
          title: '外键数',
          dataIndex: 'foreignKeys',
          key: 'fks',
          render: (fks: RawSnapshot['tables'][number]['foreignKeys']) => fks.length,
          width: 100,
        },
        {
          title: 'LLM 摘要',
          key: 'summary',
          render: (_, row) => semMap.get(row.name)?.summary ?? '—',
        },
      ]}
      expandable={{
        expandedRowRender: (row) => <ColumnTable row={row} inferred={inferred} />,
      }}
    />
  );
}

function ColumnTable({
  row,
  inferred,
}: {
  row: RawSnapshot['tables'][number];
  inferred: InferredModel | null;
}) {
  const semTable = inferred?.tables?.find((t) => t.name === row.name);
  const colSem = new Map(semTable?.columns?.map((c) => [c.name, c]) ?? []);
  return (
    <Table
      rowKey="name"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={row.columns}
      columns={[
        {
          title: '字段',
          dataIndex: 'name',
          key: 'name',
          render: (v: string, c) => (
            <Space>
              <Typography.Text code>{v}</Typography.Text>
              {c.primaryKeyOrder !== undefined && <Tag color="gold">PK</Tag>}
              {c.isAutoIncrement && <Tag>auto</Tag>}
              {!c.nullable && <Tag>NOT NULL</Tag>}
            </Space>
          ),
        },
        {
          title: '类型',
          dataIndex: 'nativeType',
          key: 'nativeType',
          render: (v: string, c) => (
            <Space direction="vertical" size={0}>
              <span>{v}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {c.logicalType}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: 'LLM 语义',
          key: 'sem',
          render: (_, c) => {
            const s = colSem.get(c.name);
            if (!s) return '—';
            return (
              <Space direction="vertical" size={0}>
                {s.semanticName && <span>{s.semanticName}</span>}
                {s.role && <Tag>{s.role}</Tag>}
                {s.notes && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {s.notes}
                  </Typography.Text>
                )}
              </Space>
            );
          },
        },
        {
          title: '注释 / 枚举',
          key: 'misc',
          render: (_, c) => (
            <Space direction="vertical" size={0}>
              {c.comment && <span>{c.comment}</span>}
              {c.enumValues?.length ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  enum: {c.enumValues.join(', ')}
                </Typography.Text>
              ) : null}
            </Space>
          ),
        },
      ]}
    />
  );
}

function RelationsView({ inferred }: { inferred: InferredModel | null }) {
  const rels = inferred?.relations ?? [];
  const rules = inferred?.ruleCandidates ?? [];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title={`LLM 复核的关系 (${rels.length})`} size="small">
        {rels.length === 0 ? (
          <Empty description="LLM 未返回关系（或尚未完成）" />
        ) : (
          <Table
            rowKey={(r, i) => `${r.fromTable}-${r.toTable}-${i}`}
            size="small"
            pagination={{ pageSize: 20 }}
            scroll={{ x: 'max-content' }}
            dataSource={rels}
            columns={[
              {
                title: '从',
                key: 'from',
                render: (_, r) => (
                  <Typography.Text code>
                    {r.fromTable}.{r.fromColumns.join(',')}
                  </Typography.Text>
                ),
              },
              {
                title: '到',
                key: 'to',
                render: (_, r) => (
                  <Typography.Text code>
                    {r.toTable}.{r.toColumns.join(',')}
                  </Typography.Text>
                ),
              },
              { title: '类型', dataIndex: 'kind', key: 'kind', render: (v) => v ?? '—' },
              {
                title: '置信度',
                dataIndex: 'confidence',
                key: 'confidence',
                render: (v: number | undefined) => (v !== undefined ? v.toFixed(2) : '—'),
                width: 100,
              },
              { title: '理由', dataIndex: 'reason', key: 'reason' },
            ]}
          />
        )}
      </Card>

      <Card title={`规则候选 (${rules.length})`} size="small">
        {rules.length === 0 ? (
          <Empty description="未产生启发式候选" />
        ) : (
          <Table
            rowKey={(r, i) => `${r.fromTable}-${r.fromColumn}-${r.toTable}-${r.toColumn}-${i}`}
            size="small"
            pagination={{ pageSize: 20 }}
            scroll={{ x: 'max-content' }}
            dataSource={rules}
            columns={[
              {
                title: '从',
                key: 'from',
                render: (_, r) => (
                  <Typography.Text code>
                    {r.fromTable}.{r.fromColumn}
                  </Typography.Text>
                ),
              },
              {
                title: '到',
                key: 'to',
                render: (_, r) => (
                  <Typography.Text code>
                    {r.toTable}.{r.toColumn}
                  </Typography.Text>
                ),
              },
              {
                title: '分数',
                dataIndex: 'heuristicScore',
                key: 'heuristicScore',
                render: (v: number) => v.toFixed(2),
                width: 80,
              },
              { title: '理由', dataIndex: 'reason', key: 'reason' },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
