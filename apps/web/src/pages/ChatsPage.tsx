import { Alert, Button, Card, Input, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { api } from '../api';
import { useApps } from '../AppContext';

interface AskResponse {
  sql: string;
  explanation: string;
  data: Array<Record<string, unknown>>;
  rowCount: number;
}

export function ChatsPage() {
  const { apps } = useApps();
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [question, setQuestion] = React.useState('');
  const [result, setResult] = React.useState<AskResponse | null>(null);
  const [loading, setLoading] = React.useState(false);

  // 应用列表载入完成时，默认选第一个
  React.useEffect(() => {
    if (apps && appCode === null && apps.length > 0) {
      setAppCode(apps[0]!.appCode);
    }
  }, [apps, appCode]);

  const ask = async () => {
    if (!appCode || !question.trim()) return;
    setLoading(true);
    try {
      const r = await api.post<AskResponse>('/chats/ask', { appCode, question });
      setResult(r);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (apps === null) return <Spin tip="加载应用…"><div style={{padding:32}}/></Spin>;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="问数 KintsugiChats">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap style={{ width: '100%' }}>
            <span>应用：</span>
            <Select
              style={{ minWidth: 200, maxWidth: '100%' }}
              value={appCode ?? undefined}
              onChange={setAppCode}
              options={(apps ?? []).map((a) => ({ value: a.appCode, label: a.name }))}
            />
          </Space>
          <Input.TextArea
            rows={3}
            placeholder="自然语言问问题，例如：「近 30 天 goods 按 type 分布多少」"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Space>
            <Button type="primary" loading={loading} onClick={() => void ask()}>
              提问
            </Button>
            <Typography.Text type="secondary">走 LLM 把 DO 元数据 + 问题翻译成 SELECT，再到目标库执行</Typography.Text>
          </Space>
        </Space>
      </Card>

      {result && (
        <Card
          title={
            <Space>
              <Typography.Text strong>结果</Typography.Text>
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
          <Table
            rowKey={(_, i) => String(i)}
            size="small"
            scroll={{ x: 'max-content' }}
            dataSource={result.data}
            pagination={{ pageSize: 20 }}
            columns={
              result.data[0]
                ? Object.keys(result.data[0]).map((k) => ({
                    title: k,
                    dataIndex: k,
                    key: k,
                    ellipsis: true,
                    render: (v: unknown) =>
                      v == null
                        ? ''
                        : typeof v === 'object'
                          ? JSON.stringify(v)
                          : String(v),
                  }))
                : []
            }
          />
        </Card>
      )}
    </Space>
  );
}
