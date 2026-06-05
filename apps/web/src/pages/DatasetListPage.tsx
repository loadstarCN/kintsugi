import {
  Alert,
  Button,
  Card,
  Empty,
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
import { Link, useNavigate } from 'react-router-dom';
import { api, type DatasetSummary, type PagedResult} from '../api';
import { useApps } from '../AppContext';

export function DatasetListPage() {
  const { apps } = useApps();
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [datasets, setDatasets] = React.useState<DatasetSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [loading, setLoading] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const navigate = useNavigate();

  const refresh = React.useCallback(
    async (code: string, p = page, ps = pageSize, kw = keyword) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          appCode: code,
          page: String(p),
          pageSize: String(ps),
        });
        if (kw.trim()) params.set('keyword', kw.trim());
        const r = await api.get<PagedResult<DatasetSummary>>(`/datasets?${params}`);
        setDatasets(r.data);
        setTotal(r.total);
      } catch (err) {
        message.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, keyword],
  );

  React.useEffect(() => {
    if (apps && appCode === null && apps.length > 0) {
      const first = apps[0]!.appCode;
      setAppCode(first);
      void refresh(first, 1, pageSize, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  React.useEffect(() => {
    if (appCode) void refresh(appCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, keyword]);

  if (apps === null) return <Spin tip="加载应用…"><div style={{padding:32}}/></Spin>;
  if (apps.length === 0)
    return (
      <Alert
        type="warning"
        message="请先创建应用"
        description="至少要先 bootstrap 一个 tenant/app，再来创建数据集"
      />
    );

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
              setDatasets([]);
              void refresh(v);
            }}
            options={apps.map((a) => ({
              value: a.appCode,
              label: `${a.name} (${a.appCode})`,
            }))}
          />
          <Input.Search
            allowClear
            placeholder="按表名 / 中文名搜索"
            style={{ width: 240, maxWidth: '100%' }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {appCode && (
            <Button onClick={() => void refresh(appCode)} loading={loading}>
              刷新
            </Button>
          )}
          <Link to="/datasources">← 数据源管理</Link>
        </Space>
      </Card>

      <Card title={`数据集 (${total})`}>
        {!loading && datasets.length === 0 ? (
          <Empty description="尚无数据集。先去「数据源」触发扫描，然后在扫描结果页一键落库。" />
        ) : (
          <Table<DatasetSummary>
            rowKey="datasetCode"
            dataSource={datasets}
            size="middle"
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
                title: '表',
                dataIndex: 'tableName',
                key: 'tableName',
                render: (v: string, row) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text code>{v}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {row.datasetCode}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: '业务名',
                dataIndex: 'alias',
                key: 'alias',
                render: (v: string) => <Tag color="blue">{v}</Tag>,
              },
              {
                title: '版本',
                dataIndex: 'version',
                key: 'version',
                width: 80,
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
                    <Button
                      size="small"
                      onClick={() => navigate(`/datasets/${row.datasetCode}`)}
                    >
                      DO / 字段
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => navigate(`/datasets/${row.datasetCode}/data`)}
                    >
                      数据浏览
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
