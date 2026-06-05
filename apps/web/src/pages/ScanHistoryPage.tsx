import { Alert, Breadcrumb, Button, Card, Space, Table, Tag, Typography } from 'antd';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type DataSourcePublic, type PagedResult, type ScanJobSummary } from '../api';

const STATUS_COLOR: Record<ScanJobSummary['status'], string> = {
  pending: 'default',
  scanning: 'processing',
  succeeded: 'success',
  failed: 'error',
};

export function ScanHistoryPage() {
  const { dsId } = useParams<{ dsId: string }>();
  const [ds, setDs] = React.useState<DataSourcePublic | null>(null);
  const [jobs, setJobs] = React.useState<ScanJobSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(
    async (p = page, ps = pageSize) => {
      if (!dsId) return;
      setLoading(true);
      try {
        const [dsInfo, paged] = await Promise.all([
          api.get<DataSourcePublic>(`/datasources/${dsId}`),
          api.get<PagedResult<ScanJobSummary>>(
            `/dbagent/datasources/${dsId}/jobs?page=${p}&pageSize=${ps}`,
          ),
        ]);
        setDs(dsInfo);
        setJobs(paged.data);
        setTotal(paged.total);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [dsId, page, pageSize],
  );

  React.useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dsId, page, pageSize]);

  if (error) {
    return <Alert type="error" message="加载失败" description={error} />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Breadcrumb
        items={[
          { title: <Link to="/datasources">数据源</Link> },
          { title: ds?.displayName ?? dsId },
          { title: '历史扫描' },
        ]}
      />
      <Card
        title={`${ds?.displayName ?? ''} · 扫描历史`}
        extra={
          <Button onClick={() => void refresh()}>刷新</Button>
        }
      >
        <Table<ScanJobSummary>
          rowKey="id"
          dataSource={jobs}
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
              title: 'JobID',
              dataIndex: 'id',
              key: 'id',
              render: (id: string) => (
                <Link to={`/datasources/${dsId}/scans/${id}`}>
                  <Typography.Text code>{id}</Typography.Text>
                </Link>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (v: ScanJobSummary['status']) => <Tag color={STATUS_COLOR[v]}>{v}</Tag>,
            },
            {
              title: '开始',
              dataIndex: 'startedAt',
              key: 'startedAt',
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: '结束',
              dataIndex: 'finishedAt',
              key: 'finishedAt',
              render: (v: string | null) => (v ? new Date(v).toLocaleString() : '—'),
            },
            {
              title: 'Tokens',
              dataIndex: 'tokensUsed',
              key: 'tokensUsed',
              render: (v: number | null) => v ?? '—',
            },
            {
              title: '错误',
              dataIndex: 'errorMessage',
              key: 'errorMessage',
              render: (v: string | null) =>
                v ? (
                  <Typography.Text type="danger" ellipsis style={{ maxWidth: 360 }}>
                    {v}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
