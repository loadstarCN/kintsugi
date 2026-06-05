import { Alert, Button, Descriptions, Space, Spin } from 'antd';
import * as React from 'react';

type HealthResult =
  | { state: 'loading' }
  | { state: 'ok'; data: { status: string; metadata: string } }
  | { state: 'error'; message: string };

export function HealthPage() {
  const [result, setResult] = React.useState<HealthResult>({ state: 'loading' });

  const check = React.useCallback(async () => {
    setResult({ state: 'loading' });
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { status: string; metadata: string };
      setResult({ state: 'ok', data });
    } catch (err) {
      setResult({ state: 'error', message: (err as Error).message });
    }
  }, []);

  React.useEffect(() => {
    void check();
  }, [check]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Button onClick={() => void check()}>重新检查</Button>
      {result.state === 'loading' && <Spin tip="检查中..."><div style={{padding:32}}/></Spin>}
      {result.state === 'ok' && (
        <Descriptions title="服务健康" bordered column={1} size="small">
          <Descriptions.Item label="status">{result.data.status}</Descriptions.Item>
          <Descriptions.Item label="metadata">
            <span style={{ wordBreak: 'break-all' }}>{result.data.metadata}</span>
          </Descriptions.Item>
        </Descriptions>
      )}
      {result.state === 'error' && (
        <Alert
          type="error"
          message="无法连接后端 /api/health"
          description={result.message + '。请确认 server 已启动（pnpm dev:server）。'}
        />
      )}
    </Space>
  );
}
