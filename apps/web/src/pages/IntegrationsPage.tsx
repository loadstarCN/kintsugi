import {
  AppleFilled,
  AndroidFilled,
  CodeOutlined,
  CopyOutlined,
  ApiOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Select, Space, Tabs, Tag, Typography } from 'antd';
import { message } from '../notify';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useApps } from '../AppContext';

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  rule: '#e5e7eb',
  gold: '#a07b3f',
  paperWarm: '#f5f1e8',
};
const MONO =
  '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';

const VALID_TABS = ['feishu', 'mobile', 'openapi'] as const;
type IntegrationsTabKey = (typeof VALID_TABS)[number];

export function IntegrationsPage() {
  const { apps: cachedApps } = useApps();
  const apps = cachedApps ?? [];
  const [appCode, setAppCode] = React.useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const activeTab: IntegrationsTabKey = (
    VALID_TABS.includes(tabFromUrl as IntegrationsTabKey)
      ? tabFromUrl
      : 'feishu'
  ) as IntegrationsTabKey;

  React.useEffect(() => {
    if (cachedApps && appCode === null && cachedApps.length > 0) {
      setAppCode(cachedApps[0]!.appCode);
    }
  }, [cachedApps, appCode]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space wrap align="center" style={{ width: '100%' }}>
          <Typography.Text strong>当前应用：</Typography.Text>
          <Select
            style={{ minWidth: 220, maxWidth: '100%' }}
            value={appCode ?? undefined}
            onChange={setAppCode}
            options={apps.map((a) => ({ value: a.appCode, label: `${a.name} (${a.appCode})` }))}
          />
          <Typography.Text type="secondary">
            集成会把消息/请求路由到选中的应用。
          </Typography.Text>
        </Space>
      </Card>

      <Tabs
        size="large"
        activeKey={activeTab}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams);
          next.set('tab', key);
          setSearchParams(next, { replace: true });
        }}
        items={[
          {
            key: 'feishu',
            label: '飞书 / Lark',
            children: appCode ? <FeishuPanel appCode={appCode} /> : <Alert type="warning" message="先选择应用" />,
          },
          {
            key: 'mobile',
            label: '移动端 SDK',
            children: appCode ? <MobilePanel appCode={appCode} /> : <Alert type="warning" message="先选择应用" />,
          },
          {
            key: 'openapi',
            label: 'OpenAPI / 第三方',
            children: appCode ? <OpenapiPanel appCode={appCode} /> : <Alert type="warning" message="先选择应用" />,
          },
        ]}
      />
    </Space>
  );
}

// =============== 飞书 ===============

function FeishuPanel({ appCode }: { appCode: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-host';
  const webhookUrl = `${origin}/api/bridges/feishu/webhook?appCode=${encodeURIComponent(appCode)}`;
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<unknown>(null);

  const sendTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ reply?: string; error?: string }>(
        `/bridges/feishu/webhook?appCode=${encodeURIComponent(appCode)}`,
        {
          header: { event_type: 'im.message.receive_v1' },
          event: {
            message: {
              message_type: 'text',
              content: JSON.stringify({ text: '测试消息：goods 表有多少行？' }),
            },
          },
        },
      );
      setTestResult(r);
    } catch (err) {
      setTestResult({ error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <span>Webhook 接入信息</span>
            <Tag color="processing">已就绪</Tag>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <KeyValue
            label="Webhook URL"
            value={webhookUrl}
            copyable
            hint="飞书开放平台 → 应用 → 事件订阅 → 请求地址"
          />
          <KeyValue
            label="订阅事件"
            value="im.message.receive_v1"
            hint="同时支持 url_verification 自动应答"
          />
          <KeyValue
            label="路由策略"
            value={`默认转发至 app=${appCode}，调 Chats NL→SQL`}
            hint="想路由到不同 app，配置多个 webhook，URL 上 ?appCode= 区分"
          />
          <KeyValue
            label="签名验签"
            value="按需开启（设置 FEISHU_VERIFY_TOKEN env 后生效）"
            hint="生产环境请务必启用 X-Lark-Signature 校验"
          />
        </Space>
      </Card>

      <Card title="本地直接发一条测试消息（不走飞书）">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            模拟飞书事件 payload，调用本地 webhook 端点 → 走 Chats →
            目标库执行，便于验证链路通畅。
          </Typography.Paragraph>
          <Button type="primary" loading={testing} onClick={() => void sendTest()}>
            发送测试事件
          </Button>
          {testResult !== null && (
            <pre
              style={{
                margin: 0,
                background: COLORS.paperWarm,
                border: `1px solid ${COLORS.rule}`,
                borderRadius: 6,
                padding: 12,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                fontFamily: MONO,
              }}
            >
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
        </Space>
      </Card>

      <Card title="飞书后台配置步骤">
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: COLORS.ink }}>
          <li>
            前往{' '}
            <a href="https://open.feishu.cn/" target="_blank" rel="noopener noreferrer">
              开放平台
            </a>{' '}
            → 创建企业自建应用（App ID / App Secret 写入服务端 env：FEISHU_APP_ID /
            FEISHU_APP_SECRET）。
          </li>
          <li>「事件订阅」 → 把上方 Webhook URL 粘到「请求地址」并保存（飞书会发 url_verification，本端会自动 echo challenge）。</li>
          <li>订阅事件：勾选 <Typography.Text code>im.message.receive_v1</Typography.Text>（接收消息）。</li>
          <li>「权限管理」 → 申请「获取与发送单聊、群组消息」「获取用户信息」。</li>
          <li>发布版本 → 安装到企业 → 把机器人拉进群，群里 @机器人 提问，结果会以卡片回复。</li>
        </ol>
      </Card>
    </Space>
  );
}

// =============== 移动端 ===============

interface AndroidAarInfo {
  available: boolean;
  version: string;
  sizeBytes: number | null;
  filename: string;
  artifactId: string;
  groupId: string;
  minSdk: number;
  compileSdk: number;
}

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function MobilePanel({ appCode }: { appCode: string }) {
  const [aar, setAar] = React.useState<AndroidAarInfo | null>(null);

  React.useEffect(() => {
    void api
      .get<AndroidAarInfo>('/sdk/android/info')
      .then(setAar)
      .catch(() => setAar({
        available: false,
        version: '0.0.1',
        sizeBytes: null,
        filename: 'kintsugi-release.aar',
        artifactId: 'kintsugi',
        groupId: 'com.kintsugi',
        minSdk: 24,
        compileSdk: 36,
      }));
  }, []);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        showIcon
        type="info"
        message="移动端 SDK 是给客户业务 App 用的"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            它**不是** Kintsugi 控制台的 iOS/Android 版本，而是给{' '}
            <strong>贵司终端用户的 App（仓库 / 销售助手 / CRM 等）</strong>
            提供的官方客户端库——让原本需要自己写 OkHttp + JSON + 签名重试的代码减到 3 行。
            认证通过 AccessKey + HMAC-SHA256，密钥不进 App bundle，由后端代签或服务端权限白名单。
          </Typography.Paragraph>
        }
      />

      <Card
        title={
          <Space>
            <DownloadOutlined />
            <span>预编译产物（直接下载，无需本地构建）</span>
          </Space>
        }
      >
        <div className="kintegr-grid-2">
          <ArtifactRow
            platform="ios"
            label="iOS · XCFramework"
            artifactId="KintsugiKit"
            groupId="com.kintsugi"
            version="0.0.1"
            sizeText="—"
            extra="iOS 13+  ·  Swift 5.9"
            available={false}
            href=""
            downloadName=""
            unavailableHint="iOS 二进制（XCFramework）暂未发布。当前请通过 SwiftPM 本地路径直接引用 packages/mobile-sdk/ios 源码。"
          />
          <ArtifactRow
            platform="android"
            label="Android · AAR"
            artifactId={aar?.artifactId ?? 'kintsugi'}
            groupId={aar?.groupId ?? 'com.kintsugi'}
            version={aar?.version ?? '0.0.1'}
            sizeText={formatBytes(aar?.sizeBytes ?? null)}
            extra={`minSdk ${aar?.minSdk ?? 24}  ·  compileSdk ${aar?.compileSdk ?? 36}`}
            available={!!aar?.available}
            href="/api/sdk/android/kintsugi.aar"
            downloadName={`kintsugi-${aar?.version ?? '0.0.1'}.aar`}
            unavailableHint="服务器上未找到 AAR。请在 packages/mobile-sdk/android 下执行 ./gradlew :kintsugi:assembleRelease 或将 AAR 放到 packages/mobile-sdk/dist/android/ 下。"
          />
        </div>
      </Card>

      <div className="kintegr-grid-2">
        <PlatformCard
          icon={<AppleFilled style={{ fontSize: 24 }} />}
          name="iOS · KintsugiKit"
          path="packages/mobile-sdk/ios"
          install={`# Xcode → File → Add Package Dependencies
# Local: ../packages/mobile-sdk/ios`}
          code={`import KintsugiKit

let client = KintsugiClient(
    baseURL: URL(string: "https://kintsugi.your-company.com")!,
    appCode: "${appCode}",
    auth: .token("eyJ...")
)
let result: FilterResult<Goods> = try await client.filter(
    datasetCode: "ds_xxx...",
    body: FilterRequest(pageSize: 20)
)
result.data.forEach { print($0.name) }`}
        />
        <PlatformCard
          icon={<AndroidFilled style={{ fontSize: 24, color: '#3DDC84' }} />}
          name="Android · com.kintsugi"
          path="packages/mobile-sdk/android"
          install={`// settings.gradle.kts
include(":kintsugi")
project(":kintsugi").projectDir =
    file("../packages/mobile-sdk/android/kintsugi")`}
          code={`import com.kintsugi.KintsugiClient
import com.kintsugi.KintsugiAuth
import com.kintsugi.FilterRequest

@Serializable data class Goods(val id: String, val name: String, val list_price: Double?)

val client = KintsugiClient(
    baseUrl = "https://kintsugi.your-company.com",
    appCode = "${appCode}",
    auth = KintsugiAuth.Token("eyJ..."),
)
val r = client.filter<Goods>("ds_xxx...", FilterRequest(pageSize = 20))
r.data.forEach { println(it.name) }`}
        />
      </div>

      <Card title="可用 API（两端形状对齐 @kintsugi/sdk）">
        <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.9, color: COLORS.ink }}>
          <li>
            <Typography.Text code>filter / getOne / create / update / delete / batchCreate / aggregate / getSelectOptions</Typography.Text>
          </li>
          <li>
            <Typography.Text code>askChats(question)</Typography.Text> ——
            自然语言问数
          </li>
          <li>认证：Bearer token（用户登录态）或 AccessKey + HMAC-SHA256（服务端签名）</li>
        </ul>
      </Card>
    </Space>
  );
}

function PlatformCard({
  icon,
  name,
  path,
  install,
  code,
}: {
  icon: React.ReactNode;
  name: string;
  path: string;
  install: string;
  code: string;
}) {
  return (
    <Card
      variant="outlined"
      title={
        <Space>
          {icon}
          <span>{name}</span>
        </Space>
      }
      extra={
        <Typography.Text code style={{ fontSize: 11 }}>
          {path}
        </Typography.Text>
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        安装
      </Typography.Paragraph>
      <CodeBlock code={install} />
      <Typography.Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 12 }}
      >
        使用示例
      </Typography.Paragraph>
      <CodeBlock code={code} />
    </Card>
  );
}

// =============== OpenAPI ===============

function OpenapiPanel({ appCode }: { appCode: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const docsUrl = `${origin}/api/apps/${appCode}/docs`;
  const jsonUrl = `${origin}/api/apps/${appCode}/openapi.json`;
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        title={
          <Space>
            <ApiOutlined />
            <span>OpenAPI 3.0.3 契约自动暴露</span>
          </Space>
        }
        extra={
          <Space wrap size={[8, 4]}>
            <Button href={docsUrl} target="_blank" rel="noopener noreferrer">
              Swagger UI
            </Button>
            <Button href={jsonUrl} target="_blank" rel="noopener noreferrer">
              下载 JSON
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 12 }}>
          每个 Dataset 自动暴露 6 个端点（filter / getOne / create / update / delete / aggregate），
          schema 由 DO JSON 推导。第三方系统可基于此自动生成 client。
        </Typography.Paragraph>
        <KeyValue label="Swagger UI" value={docsUrl} copyable />
        <KeyValue label="OpenAPI JSON" value={jsonUrl} copyable />
      </Card>

      <Card
        title={
          <Space>
            <CodeOutlined />
            <span>客户端代码生成</span>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          除了官方 TypeScript / iOS / Android SDK，任意语言均可通过 OpenAPI Generator 生成。
        </Typography.Paragraph>
        <CodeBlock
          code={`# 拉契约
curl -O ${jsonUrl}

# Go
openapi-generator-cli generate -i openapi.json -g go -o ./go-client

# Python
openapi-generator-cli generate -i openapi.json -g python -o ./python-client

# Rust
openapi-generator-cli generate -i openapi.json -g rust -o ./rust-client

# .NET
openapi-generator-cli generate -i openapi.json -g csharp-netcore -o ./csharp-client`}
        />
      </Card>
    </Space>
  );
}

// =============== 共用 ===============

function KeyValue({
  label,
  value,
  hint,
  copyable,
}: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
}) {
  return (
    <div
      className="kintegr-kv"
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 16,
        alignItems: 'start',
        padding: '10px 0',
        borderBottom: `1px solid ${COLORS.rule}`,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: COLORS.muted,
          paddingTop: 4,
        }}
      >
        {label}
      </div>
      <div>
        <Space size={8} wrap>
          <Typography.Text code style={{ fontSize: 13, wordBreak: 'break-all' }}>
            {value}
          </Typography.Text>
          {copyable && (
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                void navigator.clipboard
                  .writeText(value)
                  .then(() => message.success('已复制'))
                  .catch(() => message.error('复制失败'));
              }}
            >
              复制
            </Button>
          )}
        </Space>
        {hint && (
          <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactRow({
  platform,
  label,
  artifactId,
  groupId,
  version,
  sizeText,
  extra,
  available,
  href,
  downloadName,
  unavailableHint,
}: {
  platform: 'android' | 'ios';
  label: string;
  artifactId: string;
  groupId: string;
  version: string;
  sizeText: string;
  extra: string;
  available: boolean;
  href: string;
  downloadName: string;
  unavailableHint: string;
}): React.ReactElement {
  const icon =
    platform === 'android' ? (
      <AndroidFilled style={{ fontSize: 22, color: COLORS.ink }} />
    ) : (
      <AppleFilled style={{ fontSize: 22, color: COLORS.ink }} />
    );
  return (
    <div
      style={{
        border: `1px solid ${COLORS.rule}`,
        borderRadius: 8,
        padding: 16,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Space align="center" size={10}>
        {icon}
        <Typography.Text strong style={{ fontSize: 15 }}>
          {label}
        </Typography.Text>
        <Tag
          style={{
            borderRadius: 999,
            background: available ? COLORS.paperWarm : 'transparent',
            borderColor: COLORS.rule,
            color: available ? COLORS.gold : COLORS.muted,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.08em',
          }}
        >
          {available ? `v${version}` : '未发布'}
        </Tag>
      </Space>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          rowGap: 6,
          columnGap: 12,
          fontSize: 12,
        }}
      >
        <span style={{ color: COLORS.muted, fontFamily: MONO }}>group</span>
        <Typography.Text code style={{ fontSize: 12 }}>
          {groupId}
        </Typography.Text>
        <span style={{ color: COLORS.muted, fontFamily: MONO }}>artifact</span>
        <Typography.Text code style={{ fontSize: 12 }}>
          {artifactId}
        </Typography.Text>
        <span style={{ color: COLORS.muted, fontFamily: MONO }}>size</span>
        <span style={{ color: COLORS.ink, fontFamily: MONO }}>{sizeText}</span>
        <span style={{ color: COLORS.muted, fontFamily: MONO }}>target</span>
        <span style={{ color: COLORS.ink, fontFamily: MONO }}>{extra}</span>
      </div>
      {available ? (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          href={href}
          download={downloadName}
          style={{ alignSelf: 'flex-start' }}
        >
          下载 {platform === 'android' ? 'AAR' : 'XCFramework'}
        </Button>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: COLORS.muted,
            lineHeight: 1.6,
            paddingTop: 4,
            borderTop: `1px dashed ${COLORS.rule}`,
          }}
        >
          {unavailableHint}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre
      style={{
        background: COLORS.paperWarm,
        border: `1px solid ${COLORS.rule}`,
        borderRadius: 6,
        padding: 14,
        fontSize: 12,
        lineHeight: 1.6,
        margin: 0,
        whiteSpace: 'pre-wrap',
        fontFamily: MONO,
        color: COLORS.ink,
      }}
    >
      {code}
    </pre>
  );
}
