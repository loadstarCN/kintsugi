import {
  ApiOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ConsoleSqlOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FunctionOutlined,
  LayoutOutlined,
  MessageOutlined,
  MinusCircleFilled,
  TableOutlined,
} from '@ant-design/icons';
import { Skeleton, Space, Tag, Typography } from 'antd';
import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type ApplicationSummary,
  type DataSourcePublic,
  type DatasetSummary,
  type PagedResult,
} from '../api';
import { useApps } from '../AppContext';

interface PageRow {
  id: string;
  name: string;
  status: string;
  routePath: string;
  updatedAt: string;
}

interface ScanJobRow {
  id: string;
  status: 'pending' | 'scanning' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tokensUsed: number | null;
}

interface HomeData {
  health: 'ok' | 'fail';
  app: ApplicationSummary | null;
  totals: {
    apps: number;
    datasets: number;
    pages: number;
    sql: number;
    datasources: number;
    bff: number;
  };
  latestDatasets: DatasetSummary[];
  latestPages: PageRow[];
  latestScans: ScanJobRow[];
  totalTokens: number;
}

// ---------- 设计令牌 ----------
const COLORS = {
  ink: '#0f172a',
  ink2: '#1e293b',
  paper: '#fafaf7',
  paperWarm: '#f5f1e8',
  rule: '#e5e7eb',
  ruleSoft: '#eeece4',
  muted: '#64748b',
  mutedSoft: '#94a3b8',
  gold: '#a07b3f', // 哑金，呼应"金缮"工艺
  goldSoft: '#c8a96a',
  blue: '#1677ff',
  ok: '#16a34a',
  warn: '#d97706',
  fail: '#b91c1c',
};

const SERIF =
  '"Iowan Old Style", "Apple Garamond", "EB Garamond", "Baskerville", Georgia, "Songti SC", "STSong", "宋体", serif';
const MONO =
  '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---------- 组件 ----------

export function HomePage() {
  const { apps: cachedApps } = useApps();
  const [data, setData] = React.useState<HomeData | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (cachedApps === null) return; // 等 AppContext 拉完再算 home 数据
    void load(setData, setError, cachedApps);
  }, [cachedApps]);

  if (error) {
    return (
      <div className="khome-shell" style={shellStyle}>
        <Hero data={null} />
        <p style={{ color: COLORS.fail, fontFamily: MONO, fontSize: 13 }}>
          数据加载失败：{error}
        </p>
      </div>
    );
  }

  return (
    <div className="khome-shell" style={shellStyle}>
      <Hero data={data} />
      <DividerKintsugi />
      <Section title="入口" subtitle="Modules" />
      <ModulesGrid />
      <DividerKintsugi />
      <Section title="近况" subtitle="Recent activity" />
      <div className="khome-recent-grid">
        <Panel title="最近扫描" caption="DBAgent · 来源数据源">
          <RecentScans rows={data?.latestScans ?? null} />
        </Panel>
        <Panel title="最近落库的数据集" caption="DO 编辑后会版本 +1">
          <RecentDatasets rows={data?.latestDatasets ?? null} />
        </Panel>
      </div>
      <DividerKintsugi />
      <Section title="系统" subtitle="Runtime status" />
      <SystemStatus data={data} />
      <Footer />
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  background: COLORS.paper,
  padding: '40px 48px 64px',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  color: COLORS.ink,
  position: 'relative',
  overflow: 'hidden',
};

// ---------- Hero ----------

function Hero({ data }: { data: HomeData | null }) {
  return (
    <section style={{ position: 'relative', paddingBottom: 32 }}>
      <KintsugiLine />
      <div
        className="khome-hero-eyebrow"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.18em',
          color: COLORS.mutedSoft,
          textTransform: 'uppercase',
          marginBottom: 20,
        }}
      >
        Kintsugi · 锦缮控制台
      </div>
      <h1
        className="khome-hero-title"
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          lineHeight: 1.05,
          letterSpacing: '-0.01em',
          margin: 0,
          color: COLORS.ink,
        }}
      >
        给一个数据库连接，<br />
        <span style={{ fontStyle: 'italic', color: COLORS.gold }}>
          自动生成可被 AI 调用的企业系统。
        </span>
      </h1>
      <p
        className="khome-hero-sub"
        style={{
          marginTop: 18,
          fontSize: 15,
          lineHeight: 1.7,
          color: COLORS.muted,
          maxWidth: 720,
        }}
      >
        DBAgent 逆向理解结构 · 业务模型与 Instant API 一键生成 · BFF / Custom
        SQL 扩展 ·
        通过 SDK / CLI / MCP 暴露给 Agent。所有产物为可审计的真实代码。
      </p>

      <div
        className="khome-stat-grid"
        style={{
          marginTop: 36,
          display: 'grid',
          borderTop: `1px solid ${COLORS.rule}`,
          borderBottom: `1px solid ${COLORS.rule}`,
        }}
      >
        <Stat label="Applications" value={data?.totals.apps} />
        <Stat label="Datasets" value={data?.totals.datasets} divider />
        <Stat label="Pages" value={data?.totals.pages} divider />
        <Stat label="Custom SQL" value={data?.totals.sql} divider />
      </div>

      {/* 右下角衬线水印 */}
      <div
        aria-hidden
        className="khome-mark-cn"
        style={{
          position: 'absolute',
          right: -20,
          top: -16,
          fontFamily: SERIF,
          fontSize: 220,
          fontWeight: 400,
          letterSpacing: '-0.04em',
          color: COLORS.ink,
          opacity: 0.04,
          userSelect: 'none',
          pointerEvents: 'none',
          lineHeight: 1,
        }}
      >
        錦
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  divider,
}: {
  label: string;
  value: number | undefined;
  divider?: boolean;
}) {
  return (
    <div
      className="khome-stat"
      style={{
        padding: '20px 24px',
        borderLeft: divider ? `1px solid ${COLORS.rule}` : 'none',
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: COLORS.mutedSoft,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        className="khome-stat-num"
        style={{
          fontFamily: SERIF,
          fontSize: 36,
          fontWeight: 400,
          color: COLORS.ink,
          lineHeight: 1,
        }}
      >
        {value === undefined ? <span style={{ color: COLORS.rule }}>—</span> : value.toLocaleString()}
      </div>
    </div>
  );
}

// ---------- 分割线（金线意象）----------

function KintsugiLine() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: `linear-gradient(90deg, transparent 0%, ${COLORS.gold} 12%, ${COLORS.goldSoft} 50%, ${COLORS.gold} 88%, transparent 100%)`,
        marginBottom: 32,
        opacity: 0.6,
      }}
    />
  );
}

function DividerKintsugi() {
  return (
    <div
      aria-hidden
      className="khome-divider"
      style={{
        margin: '40px 0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${COLORS.rule} 0%, ${COLORS.goldSoft} 50%, ${COLORS.rule} 100%)`,
          opacity: 0.7,
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 1,
          background: COLORS.gold,
          opacity: 0.55,
        }}
      />
      <span
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${COLORS.rule} 0%, ${COLORS.goldSoft} 50%, ${COLORS.rule} 100%)`,
          opacity: 0.7,
        }}
      />
    </div>
  );
}

// ---------- Section 标题 ----------

function Section({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header
      className="khome-section-head"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 16,
        flexWrap: 'wrap',
      }}
    >
      <h2
        className="khome-section-title"
        style={{
          fontFamily: SERIF,
          fontWeight: 400,
          fontSize: 22,
          margin: 0,
          color: COLORS.ink,
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </h2>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: COLORS.mutedSoft,
        }}
      >
        {subtitle}
      </span>
    </header>
  );
}

// ---------- 模块入口 ----------

interface ModuleEntry {
  to: string;
  title: string;
  caption: string;
  desc: string;
  icon: React.ReactNode;
}

const MODULES: ModuleEntry[] = [
  {
    to: '/datasources',
    title: '数据源',
    caption: 'Data Sources',
    desc: '接入业务数据库，触发 DBAgent 扫描；支持 PostgreSQL / MySQL / TiDB。',
    icon: <DatabaseOutlined />,
  },
  {
    to: '/datasets',
    title: '数据集',
    caption: 'Datasets',
    desc: 'DO 编辑器 + 数据浏览器；扫描产物可一键落库为 Dataset。',
    icon: <TableOutlined />,
  },
  {
    to: '/chats',
    title: '问数',
    caption: 'NL → SQL',
    desc: '自然语言翻译为只读 SELECT，立刻在目标库执行并取回结果。',
    icon: <MessageOutlined />,
  },
  {
    to: '/reports',
    title: 'AI 报表',
    caption: 'AI Reports',
    desc: 'LLM 选定 aggregate + 图表类型，返回 echarts 配置一并交付。',
    icon: <BarChartOutlined />,
  },
  {
    to: '/sql',
    title: 'Custom SQL',
    caption: 'Saved Queries',
    desc: '保存可复用 SQL 模板；#{param} 占位 + riskLevel 分级执行。',
    icon: <ConsoleSqlOutlined />,
  },
  {
    to: '/bff',
    title: 'BFF',
    caption: 'Backend Functions',
    desc: 'JS 沙箱里写业务逻辑；可调 client.models / sql / tx。',
    icon: <FunctionOutlined />,
  },
  {
    to: '/pages',
    title: '页面',
    caption: 'Generated Pages',
    desc: '自然语言生成 React 子应用，iframe 沙箱即时预览。',
    icon: <LayoutOutlined />,
  },
  {
    to: '/transfer',
    title: '资产导入导出',
    caption: 'Asset Bundle',
    desc: 'app 全量打包 zip，跨环境 dev → daily → prod 迁移。',
    icon: <DeploymentUnitOutlined />,
  },
  {
    to: '/health',
    title: '健康检查',
    caption: 'Health',
    desc: '元数据库连接 + LLM provider 心跳检查。',
    icon: <ApiOutlined />,
  },
];

function ModulesGrid() {
  return (
    <div
      className="khome-modules"
      style={{
        display: 'grid',
        gap: 16,
      }}
    >
      {MODULES.map((m) => (
        <ModuleCard key={m.to} m={m} />
      ))}
    </div>
  );
}

function ModuleCard({ m }: { m: ModuleEntry }) {
  const [hover, setHover] = React.useState(false);
  return (
    <Link
      to={m.to}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block',
        background: '#fff',
        border: `1px solid ${hover ? COLORS.gold : COLORS.rule}`,
        borderRadius: 8,
        padding: '20px 22px',
        transition: 'border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease',
        boxShadow: hover
          ? '0 8px 24px rgba(160,123,63,0.10), 0 1px 2px rgba(15,23,42,0.04)'
          : '0 1px 2px rgba(15,23,42,0.04)',
        transform: hover ? 'translateY(-2px)' : 'none',
        textDecoration: 'none',
        color: COLORS.ink,
        position: 'relative',
        minHeight: 132,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            background: COLORS.paperWarm,
            border: `1px solid ${COLORS.ruleSoft}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 17,
            color: COLORS.gold,
          }}
        >
          {m.icon}
        </div>
        <ArrowRightOutlined
          style={{
            color: hover ? COLORS.gold : COLORS.mutedSoft,
            fontSize: 14,
            transition: 'transform 160ms ease, color 160ms ease',
            transform: hover ? 'translateX(2px)' : 'none',
          }}
        />
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: COLORS.mutedSoft,
          marginBottom: 4,
        }}
      >
        {m.caption}
      </div>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 19,
          fontWeight: 400,
          color: COLORS.ink,
          marginBottom: 8,
        }}
      >
        {m.title}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: COLORS.muted,
        }}
      >
        {m.desc}
      </div>
    </Link>
  );
}

// ---------- Panel 容器 ----------

function Panel({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: '#fff',
        border: `1px solid ${COLORS.rule}`,
        borderRadius: 8,
        padding: '20px 22px',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: `1px solid ${COLORS.ruleSoft}`,
        }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 16,
            color: COLORS.ink,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: COLORS.mutedSoft,
          }}
        >
          {caption}
        </span>
      </header>
      {children}
    </section>
  );
}

// ---------- 最近扫描 ----------

const SCAN_DOT_COLOR: Record<ScanJobRow['status'], string> = {
  pending: COLORS.mutedSoft,
  scanning: COLORS.warn,
  succeeded: COLORS.ok,
  failed: COLORS.fail,
};

function RecentScans({ rows }: { rows: ScanJobRow[] | null }) {
  if (rows === null) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (rows.length === 0)
    return <EmptyHint text="尚无扫描记录。从「数据源」触发一次。" />;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((r) => (
        <li
          key={r.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '12px 1fr auto',
            gap: 14,
            padding: '10px 0',
            borderBottom: `1px solid ${COLORS.ruleSoft}`,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: SCAN_DOT_COLOR[r.status],
              boxShadow: `0 0 0 3px ${SCAN_DOT_COLOR[r.status]}1a`,
              marginLeft: 2,
            }}
          />
          <div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                color: COLORS.ink2,
                lineHeight: 1.4,
              }}
            >
              {r.id}
            </div>
            <div style={{ fontSize: 11, color: COLORS.mutedSoft, marginTop: 2 }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              {new Date(r.startedAt).toLocaleString()}
              {r.tokensUsed !== null && (
                <span style={{ marginLeft: 12 }}>
                  · {r.tokensUsed.toLocaleString()} tokens
                </span>
              )}
            </div>
          </div>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: SCAN_DOT_COLOR[r.status],
            }}
          >
            {r.status}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------- 最近 dataset ----------

function RecentDatasets({ rows }: { rows: DatasetSummary[] | null }) {
  if (rows === null) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (rows.length === 0)
    return <EmptyHint text="尚无数据集。从扫描结果一键落库。" />;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((r) => (
        <li
          key={r.datasetCode}
          style={{
            padding: '10px 0',
            borderBottom: `1px solid ${COLORS.ruleSoft}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 13,
                  color: COLORS.ink,
                  fontWeight: 500,
                }}
              >
                {r.tableName}
              </span>
              <span
                style={{
                  fontSize: 13,
                  color: COLORS.muted,
                }}
              >
                {r.alias}
              </span>
            </div>
            <div style={{ fontSize: 11, color: COLORS.mutedSoft }}>
              v{r.version} · 更新于 {new Date(r.updatedAt).toLocaleString()}
            </div>
          </div>
          <Link
            to={`/datasets/${r.datasetCode}/data`}
            style={{
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: COLORS.gold,
              textDecoration: 'none',
              borderBottom: `1px solid ${COLORS.goldSoft}`,
              paddingBottom: 1,
              flexShrink: 0,
            }}
          >
            打开 →
          </Link>
        </li>
      ))}
    </ol>
  );
}

// ---------- 系统状态 ----------

function SystemStatus({ data }: { data: HomeData | null }) {
  const llmProvider =
    (typeof window !== 'undefined' && (window as Window & { __LLM__?: string }).__LLM__) ||
    'deepseek · deepseek-v4-flash';

  return (
    <div className="khome-status">
      <StatusCard
        label="Metadata DB"
        value={
          data === null ? null : data.health === 'ok' ? '已连接' : '未连接'
        }
        ok={data?.health === 'ok'}
        hint="托管 PostgreSQL · Prisma client"
      />
      <StatusCard
        label="LLM Provider"
        value={llmProvider}
        ok={true}
        hint="DBAgent · Chats · Reports · Text-to-Page 共用"
      />
      <StatusCard
        label="Total Tokens"
        value={
          data === null ? null : `${data.totalTokens.toLocaleString()}`
        }
        ok={true}
        hint="所有成功扫描的 tokens 之和"
        mono
      />
    </div>
  );
}

function StatusCard({
  label,
  value,
  ok,
  hint,
  mono,
}: {
  label: string;
  value: string | null;
  ok: boolean;
  hint: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${COLORS.rule}`,
        borderRadius: 8,
        padding: '18px 20px',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: COLORS.mutedSoft,
          }}
        >
          {label}
        </span>
        {value !== null &&
          (ok ? (
            <CheckCircleFilled style={{ color: COLORS.ok, fontSize: 12 }} />
          ) : (
            <CloseCircleFilled style={{ color: COLORS.fail, fontSize: 12 }} />
          ))}
        {value === null && (
          <MinusCircleFilled style={{ color: COLORS.rule, fontSize: 12 }} />
        )}
      </div>
      <div
        style={{
          fontFamily: mono ? MONO : SERIF,
          fontSize: mono ? 22 : 18,
          color: COLORS.ink,
          lineHeight: 1.2,
          minHeight: 26,
        }}
      >
        {value === null ? <Skeleton.Input active size="small" /> : value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: COLORS.mutedSoft,
          marginTop: 8,
        }}
      >
        {hint}
      </div>
    </div>
  );
}

// ---------- Footer ----------

function Footer() {
  return (
    <footer
      className="khome-footer"
      style={{
        marginTop: 56,
        paddingTop: 20,
        borderTop: `1px solid ${COLORS.ruleSoft}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.1em',
        color: COLORS.mutedSoft,
        textTransform: 'uppercase',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <span>Kintsugi · 锦缮 v0.1</span>
      <Space size={20} split={<span style={{ color: COLORS.rule }}>/</span>}>
        <Link
          to="/health"
          style={{ color: COLORS.mutedSoft, textDecoration: 'none' }}
        >
          Health
        </Link>
        <a
          href="/api/apps/app-demo0001/docs"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: COLORS.mutedSoft, textDecoration: 'none' }}
        >
          OpenAPI
        </a>
        <span>Made with serif & SQL</span>
      </Space>
    </footer>
  );
}

// ---------- 工具 ----------

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '24px 8px',
        textAlign: 'center',
        fontSize: 12,
        color: COLORS.mutedSoft,
        fontFamily: MONO,
        letterSpacing: '0.06em',
      }}
    >
      {text}
    </div>
  );
}

// ---------- 数据加载 ----------

/** 每个分项独立容错：单个 endpoint 500（如 RDS 瞬断）不让首页整面崩。 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
     
    console.warn('[home] endpoint failed:', (err as Error).message);
    return fallback;
  }
}

const emptyPaged = <T,>(): PagedResult<T> => ({ data: [], total: 0, page: 1, pageSize: 0 });

async function load(
  setData: (d: HomeData) => void,
  _setError: (s: string) => void,
  apps: ApplicationSummary[],
): Promise<void> {
  // 1. health 容错（apps 来自 AppContext，已经缓存）
  const health: 'ok' | 'fail' = await safe(
    () => fetch('/api/health').then((r) => (r.ok ? 'ok' : 'fail') as 'ok' | 'fail'),
    'fail',
  );

  const app = apps[0] ?? null;
  if (!app) {
    setData({
      health,
      app: null,
      totals: { apps: apps.length, datasets: 0, pages: 0, sql: 0, datasources: 0, bff: 0 },
      latestDatasets: [],
      latestPages: [],
      latestScans: [],
      totalTokens: 0,
    });
    return;
  }

  const enc = encodeURIComponent(app.appCode);

  // 2. 各模块计数（每项独立容错）
  const [datasetsPaged, pagesPaged, sqlPaged, datasourcesPaged, bffPaged] =
    await Promise.all([
      safe(
        () =>
          api.get<PagedResult<DatasetSummary>>(
            `/datasets?appCode=${enc}&page=1&pageSize=5`,
          ),
        emptyPaged<DatasetSummary>(),
      ),
      safe(
        () =>
          api.get<PagedResult<PageRow>>(
            `/pages?appCode=${enc}&page=1&pageSize=5`,
          ),
        emptyPaged<PageRow>(),
      ),
      safe(
        () =>
          api.get<PagedResult<{ sqlCode: string }>>(
            `/sql?appCode=${enc}&page=1&pageSize=1`,
          ),
        emptyPaged<{ sqlCode: string }>(),
      ),
      safe(
        () =>
          api.get<PagedResult<DataSourcePublic>>(
            `/datasources?appCode=${enc}&page=1&pageSize=20`,
          ),
        emptyPaged<DataSourcePublic>(),
      ),
      safe(
        () =>
          api.get<PagedResult<{ id: string }>>(
            `/bff?appCode=${enc}&page=1&pageSize=1`,
          ),
        emptyPaged<{ id: string }>(),
      ),
    ]);

  // 3. 该 app 的最近扫描（每个 ds 独立容错）
  const dsIds = datasourcesPaged.data.map((d) => d.id);
  const scansLists = await Promise.all(
    dsIds.slice(0, 5).map((id) =>
      safe(
        () =>
          api
            .get<PagedResult<ScanJobRow>>(
              `/dbagent/datasources/${id}/jobs?page=1&pageSize=5`,
            )
            .then((r) => r.data),
        [] as ScanJobRow[],
      ),
    ),
  );
  const flatScans = scansLists
    .flat()
    .sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    .slice(0, 5);

  const totalTokens = scansLists
    .flat()
    .reduce((sum, j) => sum + (j.tokensUsed ?? 0), 0);

  setData({
    health,
    app,
    totals: {
      apps: apps.length,
      datasets: datasetsPaged.total,
      pages: pagesPaged.total,
      sql: sqlPaged.total,
      datasources: datasourcesPaged.total,
      bff: bffPaged.total,
    },
    latestDatasets: datasetsPaged.data,
    latestPages: pagesPaged.data,
    latestScans: flatScans,
    totalTokens,
  });
}

// 防止"Tag"/"Typography"被 tree-shake 警告（保留 import 兼容旧版本可能引用）
void Tag;
void Typography;
