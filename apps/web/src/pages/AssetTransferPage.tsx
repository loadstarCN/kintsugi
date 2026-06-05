import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  List,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons';
import * as React from 'react';
import { type AssetImportResult } from '../api';
import { useApps } from '../AppContext';
import { message } from '../notify';
import { hasGrant, useAuth } from '../auth';

export function AssetTransferPage() {
  const { apps } = useApps();
  const { me } = useAuth();
  const canWrite = hasGrant(me, '*:asset:write');
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [overwrite, setOverwrite] = React.useState(false);
  const [importResult, setImportResult] = React.useState<AssetImportResult | null>(null);

  React.useEffect(() => {
    if (apps && appCode === null && apps.length > 0) {
      setAppCode(apps[0]!.appCode);
    }
  }, [apps, appCode]);

  const exportZip = async () => {
    if (!appCode) return;
    setExporting(true);
    try {
      // 鉴权走 httpOnly cookie；blob 流没法走 api.ts，但浏览器 fetch 自动带同源 cookie
      const res = await fetch(`/api/apps/${appCode}/transfer/export`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const filename =
        res.headers
          .get('content-disposition')
          ?.match(/filename="?([^";]+)"?/)?.[1] ?? `${appCode}-bundle.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      message.success(`已导出：${filename} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const importZip = async (file: File) => {
    if (!appCode) return false;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const url = `/api/apps/${appCode}/transfer/import?overwrite=${overwrite}`;
      // multipart/form-data 也用同源 cookie 自动鉴权
      const res = await fetch(url, {
        method: 'POST',
        body: fd,
      });
      const ct = res.headers.get('content-type') ?? '';
      const body = ct.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
      }
      const r = body as AssetImportResult;
      setImportResult(r);
      const total = Object.values(r.imported).reduce((a, b) => a + b, 0);
      message.success(`导入完成，共 ${total} 项`);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setImporting(false);
    }
    return false; // 阻止 antd 自带上传行为
  };

  if (!apps) return <Spin tip="加载…"><div style={{ padding: 32 }} /></Spin>;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space wrap style={{ width: '100%' }}>
          <span>应用：</span>
          <Select
            style={{ minWidth: 220, maxWidth: '100%' }}
            value={appCode ?? undefined}
            onChange={setAppCode}
            options={apps.map((a) => ({ value: a.appCode, label: `${a.name} (${a.appCode})` }))}
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="导出 · Export">
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Typography.Paragraph>
                把当前应用的全部资产打包成 zip：<br />
                <Tag>datasets</Tag>
                <Tag>pages + reactSubApps</Tag>
                <Tag>menus</Tag>
                <Tag>bff scripts</Tag>
                <Tag>custom sql</Tag>
                <Tag>roles</Tag>
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
                包内有 <code>bundle.json</code>（机器可读）+ <code>bff/*.js</code> /{' '}
                <code>sql/*.sql</code>（人审用）。
              </Typography.Paragraph>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={exporting}
                disabled={!appCode}
                onClick={() => void exportZip()}
              >
                下载 bundle.zip
              </Button>
            </Space>
          </Card>
        </Col>
        {canWrite && (
          <Col xs={24} md={12}>
            <Card title="导入 · Import">
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Alert
                  type="warning"
                  showIcon
                  message="注意"
                  description="导入仅迁移 dataset 的 DO + page + bff + sql + role；dataSourceId 不会跨环境自动映射，导入后请到目标 app 重新连库并 link。"
                />
                <Checkbox
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                >
                  同名资产存在时覆盖（否则跳过）
                </Checkbox>
                <Upload.Dragger
                  accept=".zip"
                  multiple={false}
                  showUploadList={false}
                  disabled={importing || !appCode}
                  beforeUpload={(file) => {
                    void importZip(file as File);
                    return false;
                  }}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">拖拽 zip 到此处或点击选择</p>
                  <p className="ant-upload-hint">仅接受由"导出"产出的 bundle.zip</p>
                </Upload.Dragger>
              </Space>
            </Card>
          </Col>
        )}
      </Row>

      {importResult && (
        <Card title="导入结果">
          <Row gutter={[16, 12]}>
            {Object.entries(importResult.imported).map(([k, v]) => (
              <Col key={k} xs={12} sm={8} md={6} lg={4}>
                <Statistic title={k} value={v} />
              </Col>
            ))}
          </Row>
          {importResult.warnings.length > 0 && (
            <>
              <Typography.Title level={5} style={{ marginTop: 16 }}>
                警告 ({importResult.warnings.length})
              </Typography.Title>
              <List
                size="small"
                dataSource={importResult.warnings}
                renderItem={(w) => (
                  <List.Item>
                    <Typography.Text type="warning">{w}</Typography.Text>
                  </List.Item>
                )}
                style={{ maxHeight: 240, overflow: 'auto' }}
              />
            </>
          )}
        </Card>
      )}
    </Space>
  );
}
