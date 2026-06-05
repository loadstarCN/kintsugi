import { Alert, Button, Card, Input, Select, Space, Spin, Tag, Typography } from 'antd';
import { message } from '../notify';
import * as React from 'react';
import ReactECharts from 'echarts-for-react';
import { api } from '../api';
import { useApps } from '../AppContext';

interface ReportResponse {
  sql: string;
  explanation: string;
  chart: {
    type: 'bar' | 'line' | 'pie' | 'funnel' | 'scatter' | 'table';
    xField: string;
    yField: string;
    seriesField?: string;
  };
  data: Array<Record<string, unknown>>;
  rowCount: number;
}

export function ReportsPage() {
  const { apps } = useApps();
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState('');
  const [result, setResult] = React.useState<ReportResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (apps && appCode === null && apps.length > 0) {
      setAppCode(apps[0]!.appCode);
    }
  }, [apps, appCode]);

  const ask = async () => {
    if (!appCode || !question.trim()) return;
    setLoading(true);
    try {
      const r = await api.post<ReportResponse>(`/apps/${appCode}/reports/ask`, { question });
      setResult(r);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!apps) return <Spin tip="加载应用…"><div style={{ padding: 32 }} /></Spin>;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="AI 报表 KintsugiReport">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap style={{ width: '100%' }}>
            <span>应用：</span>
            <Select
              style={{ minWidth: 200, maxWidth: '100%' }}
              value={appCode ?? undefined}
              onChange={setAppCode}
              options={apps.map((a) => ({ value: a.appCode, label: a.name }))}
            />
          </Space>
          <Input.TextArea
            rows={3}
            placeholder="例：近 30 天的销售额按 type 分布，画柱状图"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="primary" loading={loading} onClick={() => void ask()}>
            生成报表
          </Button>
        </Space>
      </Card>

      {result && (
        <Card
          title={
            <Space>
              <Typography.Text strong>结果</Typography.Text>
              <Tag>{result.chart.type}</Tag>
              <Tag>{result.rowCount} 行</Tag>
            </Space>
          }
        >
          <Alert
            type="info"
            message="LLM 生成的 SQL"
            description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{result.sql}</pre>}
            style={{ marginBottom: 12 }}
          />
          {result.explanation && (
            <Typography.Paragraph type="secondary">{result.explanation}</Typography.Paragraph>
          )}
          <div style={{ height: 400 }}>
            {result.chart.type === 'table' ? (
              <TableView data={result.data} />
            ) : (
              <ReactECharts
                option={buildEchartsOption(result)}
                style={{ height: '100%' }}
                opts={{ renderer: 'canvas' }}
              />
            )}
          </div>
        </Card>
      )}
    </Space>
  );
}

function buildEchartsOption(r: ReportResponse): Record<string, unknown> {
  const { chart, data } = r;
  const xs = data.map((d) => d[chart.xField] ?? '');
  const ys = data.map((d) => Number(d[chart.yField]) || 0);

  if (chart.type === 'pie') {
    return {
      tooltip: { trigger: 'item' },
      legend: { top: '5%', left: 'center' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          data: data.map((d) => ({ name: String(d[chart.xField] ?? ''), value: Number(d[chart.yField]) || 0 })),
        },
      ],
    };
  }
  if (chart.type === 'scatter') {
    return {
      tooltip: { trigger: 'axis' },
      xAxis: {},
      yAxis: {},
      series: [{ type: 'scatter', data: data.map((d) => [d[chart.xField], d[chart.yField]]) }],
    };
  }
  if (chart.type === 'funnel') {
    return {
      tooltip: { trigger: 'item' },
      series: [
        {
          type: 'funnel',
          data: data.map((d) => ({ name: String(d[chart.xField] ?? ''), value: Number(d[chart.yField]) || 0 })),
        },
      ],
    };
  }
  // bar / line
  return {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: xs },
    yAxis: { type: 'value' },
    series: [{ type: chart.type, data: ys }],
  };
}

function TableView({ data }: { data: Array<Record<string, unknown>> }) {
  if (data.length === 0) return <Alert type="info" message="无数据" />;
  const cols = Object.keys(data[0]!);
  return (
    <div style={{ maxHeight: '100%', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={{ padding: 6, border: '1px solid #eee', background: '#fafafa', textAlign: 'left' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} style={{ padding: 6, border: '1px solid #eee' }}>
                  {row[c] == null ? '' : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
