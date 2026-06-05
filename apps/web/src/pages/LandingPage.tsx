import * as React from 'react';
import { Link } from 'react-router-dom';

const C = {
  ink: '#0f172a',
  ink2: '#1e293b',
  paper: '#fafaf7',
  paperWarm: '#f5f1e8',
  paperDeep: '#efeadc',
  rule: '#dcd6c8',
  ruleSoft: '#eeece4',
  muted: '#7a7466',
  mutedDeep: '#5b564a',
  gold: '#a07b3f',
  goldSoft: '#c8a96a',
  goldGlow: '#d8b87a',
  cream: '#fbf6e8',
};

const F = {
  serif:
    '"Iowan Old Style", "Apple Garamond", "EB Garamond", "Songti SC", "STSong", "Source Han Serif SC", serif',
  mono:
    '"JetBrains Mono", "SF Mono", "IBM Plex Mono", Menlo, Consolas, monospace',
  ui:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
};

export function LandingPage(): React.ReactElement {
  React.useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = C.paper;
    return () => {
      document.body.style.background = prev;
    };
  }, []);

  return (
    <div style={{ background: C.paper, color: C.ink, fontFamily: F.ui, minHeight: '100vh' }}>
      <NoiseGrain />
      <TopBar />
      <Hero />
      <DialectStrip />
      <PullQuote />
      <Manifesto />
      <Comparison />
      <Capabilities />
      <DOAnatomy />
      <CodeSamples />
      <Workflow />
      <Architecture />
      <Personas />
      <Stack />
      <FAQ />
      <Closing />
      <Foot />
    </div>
  );
}

function NoiseGrain(): React.ReactElement {
  // 极淡的 SVG 噪声，铺满整页营造纸面质感
  const noise = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.045'/></svg>`,
  );
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        backgroundImage: `url("data:image/svg+xml;utf8,${noise}")`,
        mixBlendMode: 'multiply',
      }}
    />
  );
}

// ============================================================
// TOP BAR
// ============================================================
function TopBar(): React.ReactElement {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 5,
        background: 'rgba(250,250,247,.85)',
        backdropFilter: 'saturate(140%) blur(6px)',
        borderBottom: `1px solid ${C.ruleSoft}`,
      }}
    >
      <div
        className="k-topbar-inner"
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <Wordmark />
        <div style={{ flex: 1 }} />
        <nav className="k-topbar-nav" style={{ display: 'flex', gap: 28 }}>
          {[
            ['#manifesto', '理念'],
            ['#capabilities', '能力'],
            ['#workflow', '工作流'],
            ['#stack', '技术栈'],
          ].map(([to, label]) => (
            <a
              key={to}
              href={to}
              className="k-mark-link"
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <Link
          to="/login"
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: C.ink,
            padding: '9px 20px',
            border: `1px solid ${C.ink}`,
            background: 'transparent',
            textDecoration: 'none',
          }}
          className="k-cta-ghost"
        >
          进入控制台 →
        </Link>
      </div>
    </div>
  );
}

function Wordmark(): React.ReactElement {
  return (
    <Link to="/" style={{ display: 'flex', alignItems: 'baseline', gap: 12, textDecoration: 'none' }}>
      <span
        style={{
          fontFamily: F.serif,
          fontStyle: 'italic',
          fontSize: 26,
          color: C.ink,
          letterSpacing: '-.01em',
        }}
      >
        Kintsugi
      </span>
      <span
        style={{
          fontFamily: F.serif,
          fontSize: 22,
          color: C.gold,
          letterSpacing: '.12em',
        }}
      >
        錦缮
      </span>
      <span
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: '0.22em',
          color: C.muted,
          textTransform: 'uppercase',
          paddingBottom: 2,
        }}
      >
        v0.1
      </span>
    </Link>
  );
}

// ============================================================
// HERO
// ============================================================
function Hero(): React.ReactElement {
  return (
    <section
      className="k-hero-section"
      style={{
        position: 'relative',
        maxWidth: 1240,
        margin: '0 auto',
        padding: '72px 32px 96px',
        overflow: 'hidden',
      }}
    >
      {/* 巨大的「錦」水印，作为视觉锚点 */}
      <div
        className="k-watermark"
        style={{
          position: 'absolute',
          right: -40,
          top: 12,
          fontFamily: F.serif,
          fontSize: 540,
          lineHeight: 0.9,
          color: C.paperWarm,
          zIndex: 0,
          letterSpacing: '-.05em',
        }}
        aria-hidden
      >
        錦
      </div>

      {/* 金缮裂缝（一条贯穿整个 hero 的金线） */}
      <svg
        className="k-seam"
        width="100%"
        height="2"
        viewBox="0 0 1200 2"
        preserveAspectRatio="none"
        aria-hidden
        style={{ position: 'absolute', left: 0, right: 0, top: 220, zIndex: 1 }}
      >
        <defs>
          <linearGradient id="seam" x1="0" x2="1">
            <stop offset="0" stopColor={C.gold} stopOpacity="0" />
            <stop offset="0.15" stopColor={C.gold} stopOpacity="1" />
            <stop offset="0.6" stopColor={C.goldGlow} stopOpacity="1" />
            <stop offset="1" stopColor={C.gold} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2="1200" y1="1" y2="1" stroke="url(#seam)" strokeWidth="1.2" />
      </svg>

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div className="k-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)', gap: 56, alignItems: 'flex-start' }}>
          <div>
            <div
              className="k-rise k-rise-1"
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                color: C.gold,
                marginBottom: 22,
              }}
            >
              ⟡ Database-to-Application Platform — AI Native
            </div>

            <h1
              className="k-rise k-rise-2 k-hero-h1"
              style={{
                fontFamily: F.serif,
                fontSize: 'clamp(48px, 7.4vw, 108px)',
                lineHeight: 0.95,
                letterSpacing: '-0.025em',
                color: C.ink,
                margin: 0,
                fontWeight: 400,
              }}
            >
              连库
              <span style={{ fontStyle: 'italic', color: C.gold }}> 即 </span>
              生成。
            </h1>

            <p
              className="k-rise k-rise-3"
              style={{
                fontFamily: F.serif,
                fontSize: 20,
                lineHeight: 1.6,
                color: C.mutedDeep,
                maxWidth: 620,
                margin: '32px 0 0',
              }}
            >
              指一个数据库的 host，
              <strong style={{ color: C.ink }}> Kintsugi（锦缮）</strong>
              就能扫出表、用 LLM 还原业务语义、产出 Dataset Object，自动暴露
              OpenAPI、Instant SDK、AI 问数、Text-to-Page 与 BFF 沙箱——
              <em style={{ fontStyle: 'italic', color: C.gold }}>把破碎的库，缝成一张 API 金线网。</em>
            </p>
          </div>
          <HeroSpecimen />
        </div>

        <div
          className="k-rise k-rise-4 k-cta-row"
          style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 44, flexWrap: 'wrap' }}
        >
          <Link
            to="/login"
            className="k-cta-primary"
            style={{
              background: C.ink,
              color: C.paper,
              fontFamily: F.mono,
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '16px 32px',
              textDecoration: 'none',
              border: `1px solid ${C.ink}`,
            }}
          >
            进入控制台 →
          </Link>
          <a
            href="#capabilities"
            className="k-cta-ghost"
            style={{
              color: C.ink,
              fontFamily: F.mono,
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '16px 32px',
              textDecoration: 'none',
              border: `1px solid ${C.ink}`,
              background: 'transparent',
            }}
          >
            浏览能力矩阵
          </a>
          <a
            href="/api/sdk/android/kintsugi.aar"
            className="k-mark-link"
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              padding: '16px 0',
            }}
          >
            ↓ Android AAR · v0.0.1
          </a>
        </div>

        <HeroStats />
      </div>
    </section>
  );
}

function HeroSpecimen(): React.ReactElement {
  // 一个仿真的 SDK 调用 + 响应面板，给落地页注入"它真的在跑"的可信感
  return (
    <div
      className="k-rise k-rise-3"
      style={{
        position: 'relative',
        background: '#fff',
        border: `1px solid ${C.rule}`,
        borderRadius: 0,
        boxShadow: '0 24px 48px -32px rgba(15,23,42,.18), 0 6px 14px -10px rgba(160,123,63,.18)',
        marginTop: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${C.ruleSoft}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: C.paperWarm,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.gold, opacity: 0.9 }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.goldSoft }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: C.paperDeep }} />
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: F.mono,
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          POST /api/.../filter
        </span>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '18px 22px',
          fontFamily: F.mono,
          fontSize: 12,
          lineHeight: 1.7,
          color: C.ink2,
          overflowX: 'auto',
          background: '#fff',
        }}
      >
        <span style={{ color: C.gold }}>$ </span>
        <span style={{ color: C.ink }}>kintsugi</span>{' '}
        <span style={{ color: C.gold }}>filter</span>{' '}
        <span style={{ color: C.muted }}>--ds=goods --where</span>{' '}
        <span style={{ color: C.ink2 }}>{`'list_price > 200'`}</span>
        {'\n'}
        <span style={{ color: C.muted }}>{'⏎  parameterized SQL · ABAC injected · 38ms'}</span>
        {'\n\n'}
        <span style={{ color: C.muted }}>{'{'}</span>
        {'\n  '}
        <span style={{ color: C.gold }}>"data"</span>: [
        {'\n    { '}
        <span style={{ color: C.gold }}>"id"</span>: <span style={{ color: C.ink }}>"a3..f1"</span>,
        {'\n      '}
        <span style={{ color: C.gold }}>"name"</span>:{' '}
        <span style={{ color: C.ink }}>{`"原木手作茶盏"`}</span>,
        {'\n      '}
        <span style={{ color: C.gold }}>"list_price"</span>:{' '}
        <span style={{ color: C.ink }}>268.00</span>,
        {'\n      '}
        <span style={{ color: C.gold }}>"category"</span>:{' '}
        <span style={{ color: C.ink }}>{`"陶器"`}</span>{' '}
        {'},'}
        {'\n    ... '}
        <span style={{ color: C.muted }}>(19 more)</span>
        {'\n  ],\n  '}
        <span style={{ color: C.gold }}>"total"</span>:{' '}
        <span style={{ color: C.ink }}>1247</span>,{'\n  '}
        <span style={{ color: C.gold }}>"page"</span>: <span style={{ color: C.ink }}>1</span>,
        {'  '}
        <span style={{ color: C.gold }}>"pageSize"</span>:{' '}
        <span style={{ color: C.ink }}>20</span>
        {'\n}'}
      </pre>
      <div
        style={{
          padding: '12px 18px',
          borderTop: `1px solid ${C.ruleSoft}`,
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: C.muted,
          display: 'flex',
          justifyContent: 'space-between',
          background: C.paperWarm,
        }}
      >
        <span>● 6 endpoints / dataset · auto</span>
        <span style={{ color: C.gold }}>{'»'} OpenAPI 3.0.3</span>
      </div>
    </div>
  );
}

function HeroStats(): React.ReactElement {
  const stats: Array<[string, string, string]> = [
    ['06', '默认端点 / 数据集', 'filter · getOne · create · update · delete · aggregate'],
    ['00', '接口编码 / 应用', 'OpenAPI 3.0.3 · TypeScript / iOS / Android SDK 自动生成'],
    ['1×', '人天 → MVP 上线', '从扫库到一个能用的中后台，一个工程师，一个下午'],
    ['44', '已实测落库 · 表', 'PostgreSQL · MySQL · TiDB · MSSQL · Oracle · SQLite'],
  ];
  return (
    <div
      className="k-rise k-rise-5 k-hero-stats"
      style={{
        marginTop: 88,
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0,
        borderTop: `1px solid ${C.rule}`,
        borderBottom: `1px solid ${C.rule}`,
      }}
    >
      {stats.map(([num, label, hint], i) => (
        <div
          key={label}
          style={{
            padding: '28px 28px 26px',
            borderLeft: i === 0 ? 'none' : `1px solid ${C.ruleSoft}`,
          }}
        >
          <div
            style={{
              fontFamily: F.serif,
              fontStyle: 'italic',
              fontSize: 56,
              lineHeight: 1,
              color: C.gold,
              letterSpacing: '-0.03em',
            }}
          >
            {num}
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: C.ink,
            }}
          >
            {label}
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: F.serif,
              fontSize: 13,
              color: C.muted,
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MANIFESTO — three pillars
// ============================================================
function Manifesto(): React.ReactElement {
  const pillars: Array<[string, string, string, string]> = [
    [
      '01',
      '元数据先行',
      'Schema-as-Source',
      '不是「先写代码再补元数据」，而是反过来——把数据库结构 + 业务语义抽成 DO（Dataset Object）作为唯一事实源。\n所有 API、SDK、页面、报表都从 DO 派生；改字段，全链路即刻生效。',
    ],
    [
      '02',
      'AI 增强',
      'Semantically Enriched',
      'LLM 不是替你写 CRUD，而是替你描述业务：识别字段角色（id / created_at / soft_delete / status enum…）、补业务名、推外键、校对枚举。\n你审核它的判断，它放大你的判断。',
    ],
    [
      '03',
      '数据合约',
      'Contract-Driven',
      'OpenAPI 3.0.3 自动暴露每个数据集的 6 个端点。第三方语言用 openapi-generator 几十秒装出 client。前端 / 移动端 / BFF / MCP 服务，全走同一份合约。',
    ],
  ];
  return (
    <section
      id="manifesto"
      style={{
        position: 'relative',
        maxWidth: 1240,
        margin: '0 auto',
        padding: '120px 32px 80px',
      }}
    >
      <SectionHeader number="I" caption="Manifesto" title="三条不动摇的原则" />
      <div
        className="k-cols-3"
        style={{
          marginTop: 56,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 48,
        }}
      >
        {pillars.map(([num, zh, en, body]) => (
          <article key={num} style={{ paddingTop: 4 }}>
            <div
              style={{
                fontFamily: F.serif,
                fontStyle: 'italic',
                fontSize: 56,
                color: C.gold,
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              {num}
            </div>
            <h3
              style={{
                fontFamily: F.serif,
                fontSize: 30,
                color: C.ink,
                margin: '24px 0 6px',
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              {zh}
            </h3>
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: C.muted,
              }}
            >
              {en}
            </div>
            <p
              style={{
                marginTop: 20,
                fontFamily: F.serif,
                fontSize: 15.5,
                lineHeight: 1.75,
                color: C.ink2,
                whiteSpace: 'pre-line',
              }}
            >
              {body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  number,
  caption,
  title,
}: {
  number: string;
  caption: string;
  title: string;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, position: 'relative' }}>
      <div
        className="k-section-numeral"
        style={{
          fontFamily: F.serif,
          fontStyle: 'italic',
          fontSize: 110,
          color: C.goldSoft,
          letterSpacing: '-0.05em',
          lineHeight: 0.85,
          flexShrink: 0,
          opacity: 0.85,
        }}
        aria-hidden
      >
        {number}
      </div>
      <div style={{ flex: 1, paddingBottom: 14 }}>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: C.gold,
            marginBottom: 12,
          }}
        >
          ⟡ {caption}
        </div>
        <h2
          style={{
            margin: 0,
            fontFamily: F.serif,
            fontSize: 48,
            color: C.ink,
            fontWeight: 400,
            letterSpacing: '-0.02em',
          }}
        >
          {title}
        </h2>
        <div
          style={{
            marginTop: 18,
            height: 1,
            background: `linear-gradient(to right, ${C.gold}, transparent)`,
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
// CAPABILITIES
// ============================================================
function Capabilities(): React.ReactElement {
  const caps: Array<{
    code: string;
    name: string;
    sub: string;
    body: string;
  }> = [
    {
      code: 'INST',
      name: 'Instant API',
      sub: '六个默认端点',
      body: '每个数据集自动获得 filter / getOne / create / update / delete / aggregate，参数化 SQL，按 ABAC/RLS 自动注入租户与可见行。',
    },
    {
      code: 'D-O ',
      name: 'Dataset Object',
      sub: '业务语义建模',
      body: '把字段抽成 logicalType + role + dataRule + relations 的 DO JSON。改 DO，OpenAPI / Page / SDK 同步漂移。',
    },
    {
      code: 'CHAT',
      name: 'Chats · 问数',
      sub: '自然语言 → SQL',
      body: '内置 NL→SQL，DeepSeek 把「最近 30 天每个分类销量」翻译成可执行参数化 SQL，结果回填到 OpenAPI 同款响应壳。',
    },
    {
      code: 'RPRT',
      name: 'AI 报表',
      sub: 'NL → ECharts config',
      body: 'LLM 根据 DO 与提问，输出 ECharts 配置并直接渲染。报表组件可保存、订阅、嵌入第三方系统。',
    },
    {
      code: 'PAGE',
      name: 'Text-to-Page',
      sub: '一句话 → React 子应用',
      body: '描述「商品列表 + 编辑抽屉」，LLM 产出单文件 React JSX，跑在 iframe 沙箱里，样式与控制台一致，数据走 InstantAPI。',
    },
    {
      code: 'C-SQ',
      name: 'Custom SQL',
      sub: '受控 SQL 端点',
      body: '把一条 SQL 模板挂成命名端点：sqlSafe 校验、参数白名单、access-key + HMAC 签名、审计与限流。',
    },
    {
      code: 'BFF ',
      name: 'BFF Sandbox',
      sub: 'node:vm 受信函数',
      body: '在 vm 里跑业务编排：context.client.models / sql / tx，无 fs/net 副作用；改源码，秒级热更。',
    },
    {
      code: 'OAPI',
      name: 'OpenAPI 3.0.3',
      sub: '客户端代码生成',
      body: '应用维度自动生成 OpenAPI 契约 + Swagger UI，第三方任意语言 30 秒装出 client。',
    },
    {
      code: 'SDK ',
      name: 'Mobile · iOS / Android',
      sub: 'AccessKey + HMAC',
      body: '官方 KintsugiKit (iOS / Android) 提供 filter / getOne / create / update / delete / askChats，签名不进 bundle。',
    },
  ];
  return (
    <section
      id="capabilities"
      style={{ background: C.paperWarm, borderTop: `1px solid ${C.ruleSoft}`, borderBottom: `1px solid ${C.ruleSoft}` }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
        <SectionHeader number="III" caption="Capabilities" title="九张能力卡" />
        <div
          className="k-cols-3"
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0,
            border: `1px solid ${C.rule}`,
            background: '#fff',
          }}
        >
          {caps.map((c, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            return (
              <div
                key={c.code}
                className="k-cap-card"
                style={{
                  padding: '36px 28px 60px',
                  borderRight: col < 2 ? `1px solid ${C.ruleSoft}` : 'none',
                  borderBottom: row < 2 ? `1px solid ${C.ruleSoft}` : 'none',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    letterSpacing: '0.3em',
                    color: C.gold,
                    marginBottom: 18,
                    whiteSpace: 'pre',
                  }}
                >
                  {c.code} · {String(i + 1).padStart(2, '0')} / 09
                </div>
                <h4
                  style={{
                    margin: 0,
                    fontFamily: F.serif,
                    fontSize: 28,
                    color: C.ink,
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {c.name}
                </h4>
                <div
                  style={{
                    fontFamily: F.serif,
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: C.muted,
                    marginTop: 4,
                  }}
                >
                  {c.sub}
                </div>
                <p
                  style={{
                    marginTop: 18,
                    fontFamily: F.serif,
                    fontSize: 14.5,
                    lineHeight: 1.7,
                    color: C.ink2,
                  }}
                >
                  {c.body}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// WORKFLOW
// ============================================================
function Workflow(): React.ReactElement {
  const steps: Array<[string, string, string, string]> = [
    [
      '一',
      '指一个库',
      'connect',
      '填 host / port / db / user / password。\n密码以 AES-GCM 加密入库，仅扫描时解密。',
    ],
    [
      '二',
      '扫元数据',
      'scan',
      'db-scanner 抽出表 / 列 / 主外键 / 注释；\n采样数据（脱敏）作为下一步的输入。',
    ],
    [
      '三',
      'LLM 增强',
      'enrich',
      'DeepSeek 分批读 schema，识别字段角色、\n推外键、补业务名、归并枚举值。',
    ],
    [
      '四',
      'DO 落库',
      'persist',
      '人审 → 一键 commit；DO JSON 写入元数据库\n并版本化，回放任何改动。',
    ],
    [
      '五',
      '消费',
      'consume',
      'OpenAPI / Instant SDK / Chats / 报表 /\nText-to-Page / BFF / MCP 自动可用。',
    ],
  ];
  return (
    <section
      id="workflow"
      style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}
    >
      <SectionHeader number="VI" caption="Workflow" title="一条线，从库到生成式应用" />
      <div style={{ marginTop: 64, position: 'relative' }}>
        {/* 贯穿的金缝 */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 26,
            top: 60,
            bottom: 30,
            width: 1,
            background: `linear-gradient(to bottom, transparent, ${C.gold} 18%, ${C.gold} 82%, transparent)`,
          }}
        />
        {steps.map(([cn, zh, en, body], i) => (
          <div
            key={zh}
            className="k-workflow-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '60px 200px 1fr',
              gap: 32,
              alignItems: 'flex-start',
              padding: '36px 0',
              borderBottom: i < steps.length - 1 ? `1px solid ${C.ruleSoft}` : 'none',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: C.paper,
                border: `1.5px solid ${C.gold}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: F.serif,
                fontSize: 22,
                color: C.gold,
                position: 'relative',
                zIndex: 1,
              }}
            >
              {cn}
            </div>
            <div>
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 28,
                  color: C.ink,
                  letterSpacing: '-0.01em',
                }}
              >
                {zh}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: F.mono,
                  fontSize: 11,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: C.muted,
                }}
              >
                {en}
              </div>
            </div>
            <div
              style={{
                fontFamily: F.serif,
                fontSize: 16,
                lineHeight: 1.75,
                color: C.ink2,
                whiteSpace: 'pre-line',
                paddingTop: 8,
              }}
            >
              {body}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================
// STACK
// ============================================================
function Stack(): React.ReactElement {
  const groups: Array<[string, string[]]> = [
    [
      'Server',
      [
        'NestJS · TypeScript',
        'Prisma · PostgreSQL',
        'OpenAPI 3.0.3 自生成',
        'node:vm BFF Sandbox',
        'JWT + bcrypt · AccessKey + HMAC-SHA256',
      ],
    ],
    [
      'Web',
      [
        'Vite · React 18',
        'Ant Design 5 · ConfigProvider 主题',
        'reactflow · ECharts',
        'iframe + Babel-standalone（子应用沙箱）',
        '编辑器风格 / 锦缮（墨/纸/金）',
      ],
    ],
    [
      'AI / Bridges',
      [
        'DeepSeek · LLM 抽象层',
        'Chats / Reports / Text-to-Page / DBAgent',
        '飞书 Lark · Webhook',
        'MCP Server (stdio JSON-RPC)',
        'Mobile · iOS KintsugiKit / Android com.kintsugi',
      ],
    ],
    [
      'Database',
      [
        'PostgreSQL · 16+',
        'MySQL · MariaDB · TiDB',
        'Microsoft SQL Server',
        'Oracle · 19c+',
        'SQLite (本地预览)',
      ],
    ],
  ];
  return (
    <section
      id="stack"
      style={{ background: C.paperWarm, borderTop: `1px solid ${C.ruleSoft}`, borderBottom: `1px solid ${C.ruleSoft}` }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
        <SectionHeader number="IX" caption="Stack" title="工程栈，无神秘组件" />
        <div
          className="k-stack-grid"
          style={{
            marginTop: 64,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
            background: '#fff',
            border: `1px solid ${C.rule}`,
          }}
        >
          {groups.map(([title, items], col) => (
            <div
              key={title}
              style={{
                padding: '28px 24px 32px',
                borderRight: col < 3 ? `1px solid ${C.ruleSoft}` : 'none',
              }}
            >
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: '0.3em',
                  textTransform: 'uppercase',
                  color: C.gold,
                  marginBottom: 16,
                }}
              >
                ⌗ {title}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {items.map((it) => (
                  <li
                    key={it}
                    className="k-stack-row"
                    style={{
                      fontFamily: F.mono,
                      fontSize: 12,
                      lineHeight: 1.7,
                      color: C.ink2,
                      padding: '8px 0',
                      borderBottom: `1px dashed ${C.ruleSoft}`,
                      letterSpacing: '0.01em',
                    }}
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// CLOSING CTA
// ============================================================
function Closing(): React.ReactElement {
  return (
    <section
      style={{
        position: 'relative',
        maxWidth: 1240,
        margin: '0 auto',
        padding: '140px 32px 120px',
        textAlign: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        className="k-watermark"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: F.serif,
          fontSize: 360,
          color: C.paperDeep,
          letterSpacing: '-.06em',
          opacity: 0.7,
          zIndex: 0,
        }}
      >
        缮
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: C.gold,
          }}
        >
          ⟡ Begin
        </div>
        <h2
          style={{
            margin: '20px auto 0',
            maxWidth: 880,
            fontFamily: F.serif,
            fontSize: 'clamp(40px, 6vw, 76px)',
            lineHeight: 1.1,
            color: C.ink,
            fontWeight: 400,
            letterSpacing: '-0.02em',
          }}
        >
          把你那个「
          <span style={{ fontStyle: 'italic', color: C.gold }}>历经三任工程师</span>
          、文档早就过期」的库
          <br />
          交给 Kintsugi。
        </h2>
        <p
          style={{
            margin: '28px auto 0',
            maxWidth: 640,
            fontFamily: F.serif,
            fontSize: 17,
            lineHeight: 1.7,
            color: C.muted,
          }}
        >
          一杯咖啡的工夫，它会把表名、外键、枚举、隐含的 soft-delete 都还原成可读的 DO，
          再给你 OpenAPI、SDK、问数、报表、和能直接跑的 React 页面。
        </p>
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            gap: 18,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link
            to="/login"
            className="k-cta-primary"
            style={{
              background: C.ink,
              color: C.paper,
              fontFamily: F.mono,
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '18px 36px',
              textDecoration: 'none',
              border: `1px solid ${C.ink}`,
            }}
          >
            进入控制台 →
          </Link>
          <a
            href="/integrations?tab=openapi"
            className="k-cta-ghost"
            style={{
              color: C.ink,
              fontFamily: F.mono,
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '18px 36px',
              textDecoration: 'none',
              border: `1px solid ${C.ink}`,
              background: 'transparent',
            }}
          >
            查看 OpenAPI
          </a>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// FOOTER
// ============================================================
function Foot(): React.ReactElement {
  return (
    <footer
      style={{
        borderTop: `1px solid ${C.ruleSoft}`,
        background: C.paper,
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '32px 32px 48px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: F.serif,
              fontSize: 22,
              color: C.ink,
              letterSpacing: '-0.01em',
            }}
          >
            <span style={{ fontStyle: 'italic' }}>Kintsugi</span>{' '}
            <span style={{ color: C.gold }}>錦缮</span>
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: C.muted,
            }}
          >
            金缮：Kin·tsu·gi
            <span style={{ color: C.gold }}> · </span>
            以金漆补碎瓷
          </div>
        </div>
        <div style={{ display: 'flex', gap: 28 }}>
          {[
            ['/login', '控制台'],
            ['/integrations?tab=openapi', 'OpenAPI'],
            ['/integrations?tab=mobile', '移动 SDK'],
            ['/api/health', 'Health'],
          ].map(([href, label]) => (
            <a
              key={String(href)}
              href={href}
              className="k-mark-link"
              style={{
                fontFamily: F.mono,
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              {label}
            </a>
          ))}
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          v0.1 · 2026
        </div>
      </div>
    </footer>
  );
}

// ============================================================
// DIALECT STRIP — 横向跑马灯式品牌带
// ============================================================
function DialectStrip(): React.ReactElement {
  const items = [
    'PostgreSQL',
    'MySQL',
    'MariaDB',
    'TiDB',
    'Microsoft SQL Server',
    'Oracle',
    'SQLite',
    'AWS RDS',
    'Aliyun RDS',
    'Supabase',
  ];
  return (
    <section
      aria-label="supported dialects"
      style={{
        borderTop: `1px solid ${C.ruleSoft}`,
        borderBottom: `1px solid ${C.ruleSoft}`,
        background: C.paperWarm,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '14px 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <span
          style={{
            fontFamily: F.mono,
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: C.gold,
            flexShrink: 0,
          }}
        >
          ⌗ 已实测方言
        </span>
        <div
          style={{
            flex: 1,
            display: 'flex',
            gap: 36,
            overflow: 'hidden',
            position: 'relative',
            maskImage:
              'linear-gradient(to right, transparent 0, #000 6%, #000 94%, transparent 100%)',
          }}
        >
          {[...items, ...items].map((it, i) => (
            <span
              key={`${it}-${i}`}
              style={{
                fontFamily: F.serif,
                fontStyle: 'italic',
                fontSize: 18,
                color: C.ink2,
                whiteSpace: 'nowrap',
                letterSpacing: '0.01em',
              }}
            >
              {it}
              <span style={{ color: C.gold, margin: '0 12px' }}>·</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// COMPARISON — 传统做法 vs Kintsugi
// ============================================================
function Comparison(): React.ReactElement {
  const before: Array<[string, string]> = [
    ['T+0', '画 ER 图，估字段，开 Confluence 写技术方案'],
    ['T+1', '建 N 个 controller，写 N×6 个 CRUD 端点'],
    ['T+3', '同事补 OpenAPI yaml，前端开始联调'],
    ['T+5', '产品说要按角色看不同行，加 ABAC，回炉每个 controller'],
    ['T+8', 'iOS / Android 同事各自写 OkHttp / URLSession 重试'],
    ['T+12', '上线，文档已经过期'],
  ];
  const after: Array<[string, string]> = [
    ['T+0:00', '点「新建数据源」→ 填 host'],
    ['T+0:05', '扫描完成，44 张表元数据落库'],
    ['T+0:25', 'LLM 推完字段角色 / 外键 / 枚举'],
    ['T+0:32', '人审 → commit DO，OpenAPI / SDK 立即可用'],
    ['T+0:45', 'Text-to-Page 一句话生成中后台页面'],
    ['T+1:00', '飞书机器人开始问数答业务'],
  ];
  return (
    <section style={{ background: C.paperWarm, borderTop: `1px solid ${C.ruleSoft}`, borderBottom: `1px solid ${C.ruleSoft}` }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
        <SectionHeader number="II" caption="Before / After" title="同一个需求，两种时长" />
        <div
          className="k-comparison-grid"
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: '1fr 80px 1fr',
            gap: 0,
            alignItems: 'stretch',
          }}
        >
          {/* Before */}
          <article
            style={{
              padding: 36,
              background: '#fff',
              border: `1px solid ${C.rule}`,
              position: 'relative',
            }}
          >
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: C.muted,
                marginBottom: 16,
              }}
            >
              ⊘ 传统做法
            </div>
            <h3
              style={{
                margin: 0,
                fontFamily: F.serif,
                fontSize: 28,
                color: C.ink2,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{ fontStyle: 'italic' }}>12</span> 人天 · 全栈来回
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0' }}>
              {before.map(([day, txt]) => (
                <li
                  key={day}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '64px 1fr',
                    gap: 16,
                    padding: '10px 0',
                    borderBottom: `1px dashed ${C.ruleSoft}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 11,
                      color: C.muted,
                      letterSpacing: '0.1em',
                    }}
                  >
                    {day}
                  </span>
                  <span
                    style={{
                      fontFamily: F.serif,
                      fontSize: 14.5,
                      color: C.ink2,
                      lineHeight: 1.6,
                    }}
                  >
                    {txt}
                  </span>
                </li>
              ))}
            </ul>
          </article>

          {/* 中间金缝 */}
          <div
            className="k-comparison-vs"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 24,
                bottom: 24,
                left: '50%',
                width: 1,
                background: `linear-gradient(to bottom, transparent, ${C.gold}, transparent)`,
              }}
            />
            <div
              style={{
                position: 'relative',
                background: C.paperWarm,
                padding: '20px 12px',
                fontFamily: F.serif,
                fontStyle: 'italic',
                color: C.gold,
                fontSize: 28,
              }}
            >
              vs
            </div>
          </div>

          {/* After */}
          <article
            style={{
              padding: 36,
              background: '#fff',
              border: `1px solid ${C.gold}`,
              position: 'relative',
              boxShadow: '0 24px 48px -32px rgba(160,123,63,.35)',
            }}
          >
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: -1,
                top: -1,
                bottom: -1,
                width: 3,
                background: `linear-gradient(to bottom, ${C.gold}, ${C.goldGlow})`,
              }}
            />
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: C.gold,
                marginBottom: 16,
              }}
            >
              ✦ Kintsugi
            </div>
            <h3
              style={{
                margin: 0,
                fontFamily: F.serif,
                fontSize: 28,
                color: C.ink,
                fontWeight: 400,
                letterSpacing: '-0.01em',
              }}
            >
              <span style={{ fontStyle: 'italic', color: C.gold }}>1</span> 小时 · 一杯咖啡
            </h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0' }}>
              {after.map(([day, txt]) => (
                <li
                  key={day}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '76px 1fr',
                    gap: 16,
                    padding: '10px 0',
                    borderBottom: `1px dashed ${C.ruleSoft}`,
                  }}
                >
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 11,
                      color: C.gold,
                      letterSpacing: '0.1em',
                    }}
                  >
                    {day}
                  </span>
                  <span
                    style={{
                      fontFamily: F.serif,
                      fontSize: 14.5,
                      color: C.ink,
                      lineHeight: 1.6,
                    }}
                  >
                    {txt}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </div>
        <p
          style={{
            marginTop: 36,
            fontFamily: F.serif,
            fontSize: 13,
            color: C.muted,
            lineHeight: 1.7,
            textAlign: 'right',
          }}
        >
          注：左侧时间假设一名后端 + 一名前端 + 一名移动端协作；右侧基于一名工程师，扫一个 44 张表的真实业务库（已落库实测）。
        </p>
      </div>
    </section>
  );
}

// ============================================================
// DO ANATOMY — 一份真实的 DO JSON 注解
// ============================================================
function DOAnatomy(): React.ReactElement {
  return (
    <section style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
      <SectionHeader number="IV" caption="DO Anatomy" title="解剖一张 Dataset Object" />
      <p
        style={{
          marginTop: 28,
          fontFamily: F.serif,
          fontSize: 17,
          color: C.ink2,
          lineHeight: 1.75,
          maxWidth: 760,
        }}
      >
        DO 是 Kintsugi 的元事实源（single source of truth）。它不是「ORM 模型」也不是「OpenAPI schema」——
        它同时是这两者的<em style={{ color: C.gold }}>父亲</em>。下面这份是 LLM 增强后、人审通过的真实切片。
      </p>
      <div
        className="k-cols-2-stack k-doanatomy-grid"
        style={{
          marginTop: 40,
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 36,
          alignItems: 'stretch',
        }}
      >
        {/* 左侧用 relative 外壳 + absolute 内层。外壳无 children-in-flow → 高度 0，
            grid row 由右侧自然高度决定；align-items:stretch 把外壳拉到那个高度，
            inner 用 inset:0 填满，pre overflow:auto 自己滚。 */}
        <div
          className="k-doanatomy-left"
          style={{ position: 'relative', minHeight: 360 }}
        >
        <div
          className="k-doanatomy-left-inner"
          style={{
            position: 'absolute',
            inset: 0,
            border: `1px solid ${C.rule}`,
            background: '#fff',
            overflow: 'hidden',
            boxShadow: '0 28px 56px -36px rgba(15,23,42,.18)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: '14px 20px',
              borderBottom: `1px solid ${C.ruleSoft}`,
              background: C.paperWarm,
              fontFamily: F.mono,
              fontSize: 10,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: C.muted,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>datasets / goods.do.json</span>
            <span style={{ color: C.gold }}>● commit b3f9c1</span>
          </div>
          <pre
            className="k-doanatomy-pre"
            style={{
              margin: 0,
              padding: '20px 24px',
              fontFamily: F.mono,
              fontSize: 12.5,
              lineHeight: 1.85,
              color: C.ink2,
              overflow: 'auto',
              background: '#fff',
              whiteSpace: 'pre',
              flex: 1,
              minHeight: 0,
            }}
          >
            <Row>{'{'}</Row>
            <Row indent={2}><DoMark />{'"datasetCode": '}<DoStr>{'"ds_goods_a3f1"'}</DoStr>{','}</Row>
            <Row indent={2}><DoMark />{'"alias":        '}<DoStr>{'"商品"'}</DoStr>{',     '}<DoComment>{'// 业务名，LLM 推断、人审'}</DoComment></Row>
            <Row indent={2}>{'"tableName":   '}<DoStr>{'"goods"'}</DoStr>{','}</Row>
            <Row indent={2}>{'"primaryKey":  ['}<DoStr>{'"id"'}</DoStr>{'],'}</Row>
            <Row indent={2}>{'"softDelete":  { '}<DoStr>{'"field"'}</DoStr>{': '}<DoStr>{'"is_deleted"'}</DoStr>{' },'}</Row>
            <Row indent={2}>{'"version":     { '}<DoStr>{'"field"'}</DoStr>{': '}<DoStr>{'"updated_at"'}</DoStr>{' },'}</Row>
            <Row>{' '}</Row>
            <Row indent={2}><DoMark />{'"fields": ['}</Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{':        '}<DoStr>{'"id"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"role"'}</DoStr>{':        '}<DoStr>{'"id"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"logicalType"'}</DoStr>{': '}<DoStr>{'"uuid"'}</DoStr></Row>
            <Row indent={4}>{'},'}</Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{':         '}<DoStr>{'"name"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"businessName"'}</DoStr>{': '}<DoStr>{'"商品名称"'}</DoStr></Row>
            <Row indent={4}>{'},'}</Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{':         '}<DoStr>{'"list_price"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"businessName"'}</DoStr>{': '}<DoStr>{'"标价"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"logicalType"'}</DoStr>{': '}<DoStr>{'"decimal(12,2)"'}</DoStr></Row>
            <Row indent={4}>{'},'}</Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{':        '}<DoStr>{'"status"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"role"'}</DoStr>{':        '}<DoStr>{'"enum"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"enumValues"'}</DoStr>{': ['}<DoStr>{'"draft"'}</DoStr>{', '}<DoStr>{'"on_sale"'}</DoStr>{', '}<DoStr>{'"sold_out"'}</DoStr>{']'}</Row>
            <Row indent={4}>{'},'}</Row>
            <Row>{' '}</Row>
            <Row indent={4}><DoComment>{'// ⏤ deprecated 字段保留但不出现在 OpenAPI / SDK ⏤'}</DoComment></Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{':        '}<DoStr>{'"old_sku"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"deprecated"'}</DoStr>{': '}<DoNum>{'true'}</DoNum></Row>
            <Row indent={4}>{'}'}</Row>
            <Row indent={2}>{'],'}</Row>
            <Row>{' '}</Row>
            <Row indent={2}><DoMark />{'"relations"'}:{' ['}</Row>
            <Row indent={4}>{'{'}</Row>
            <Row indent={6}><DoStr>{'"name"'}</DoStr>{': '}<DoStr>{'"category"'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"to"'}</DoStr>{':   '}<DoStr>{'"ds_categories_..."'}</DoStr>{','}</Row>
            <Row indent={6}><DoStr>{'"on"'}</DoStr>{':   [{ '}<DoStr>{'"from"'}</DoStr>{': '}<DoStr>{'"category_id"'}</DoStr>{', '}<DoStr>{'"to"'}</DoStr>{': '}<DoStr>{'"id"'}</DoStr>{' }]'}</Row>
            <Row indent={4}>{'}'}</Row>
            <Row indent={2}>{'],'}</Row>
            <Row>{' '}</Row>
            <Row indent={2}><DoMark />{'"dataRule":'}{' {'}</Row>
            <Row indent={4}><DoStr>{'"scope"'}</DoStr>{':   '}<DoStr>{'"role"'}</DoStr>{','}</Row>
            <Row indent={4}><DoStr>{'"clauses"'}</DoStr>{': ['}<DoStr>{'"tenant_code = ${user.tenant}"'}</DoStr>{']'}</Row>
            <Row indent={2}>{'}'}</Row>
            <Row>{'}'}</Row>
          </pre>
        </div>
        </div>
        <div style={{ padding: '8px 0' }}>
          {[
            ['◉', 'datasetCode', '32 字符稳定 ID。OpenAPI / SDK 都用它，不会被表名重命名带塌。'],
            ['◉', 'fields[*].role', 'LLM 给出的字段角色：id / created_at / soft_delete / enum / fk …。决定生成的 SDK 类型与端点形状。'],
            ['◉', 'relations', '推断 + 校对的外键。Instant API 自动 join；GraphQL-like getOne(id, with: [...])。'],
            ['◉', 'dataRule.scope', 'application-level RLS。\\${user.xxx} 占位符在请求时替换；不依赖数据库 RLS 设置。'],
            ['◉', 'softDelete / version', '让 update / delete 自动写删除位 + version stamp，避免脏读。'],
          ].map(([dot, key, desc]) => (
            <div
              key={key}
              style={{
                display: 'grid',
                gridTemplateColumns: '20px 1fr',
                gap: 14,
                padding: '14px 0',
                borderBottom: `1px solid ${C.ruleSoft}`,
              }}
            >
              <span style={{ color: C.gold, fontFamily: F.serif, fontSize: 12, paddingTop: 2 }}>
                {dot}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: F.mono,
                    fontSize: 12,
                    color: C.ink,
                    letterSpacing: '0.04em',
                  }}
                >
                  {key}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: F.serif,
                    fontSize: 14,
                    color: C.ink2,
                    lineHeight: 1.6,
                  }}
                >
                  {desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Row({
  indent = 0,
  children,
}: {
  indent?: number;
  children: React.ReactNode;
}): React.ReactElement {
  // 用 div 强制每行独占一行，配合 pre 的等宽 + white-space: pre 渲染。
  return (
    <div style={{ display: 'block' }}>
      {indent > 0 ? ' '.repeat(indent) : ''}
      {children}
    </div>
  );
}

function DoStr({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ color: C.gold }}>{children}</span>;
}
function DoNum({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ color: C.ink }}>{children}</span>;
}
function DoComment({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ color: C.muted, fontStyle: 'italic' }}>{children}</span>;
}
function DoMark(): React.ReactElement {
  return <span style={{ color: C.gold, marginRight: 4 }}>⟡ </span>;
}

// ============================================================
// CODE SAMPLES — 三种语言
// ============================================================
function CodeSamples(): React.ReactElement {
  const tabs: Array<{ key: string; label: string; sub: string; code: string }> = [
    {
      key: 'ts',
      label: 'TypeScript',
      sub: '@kintsugi/sdk',
      code: `import { KintsugiClient } from '@kintsugi/sdk';

const client = new KintsugiClient({
  baseUrl: 'https://kintsugi.your-company.com',
  appCode: 'app-mart',
  auth: { token: 'eyJhbGciOi...' },
});

// 默认六个端点之一：filter，参数化 SQL + ABAC 自动注入
const r = await client.models.goods.filter({
  where: [
    { field: 'list_price', op: 'gt', value: 200 },
    { field: 'status',     op: 'in', value: ['on_sale'] },
  ],
  orderBy: [{ field: 'updated_at', dir: 'desc' }],
  page: 1,
  pageSize: 20,
});

console.log(r.total, r.data[0].name);`,
    },
    {
      key: 'swift',
      label: 'Swift',
      sub: 'KintsugiKit · iOS 13+',
      code: `import KintsugiKit

struct Goods: Codable {
    let id: String
    let name: String
    let listPrice: Double?
}

let client = KintsugiClient(
    baseURL: URL(string: "https://kintsugi.your-company.com")!,
    appCode: "app-mart",
    auth: .token("eyJ...")
)

let result: FilterResult<Goods> = try await client.filter(
    datasetCode: "ds_goods_a3f1",
    body: FilterRequest(
        where: [.gt(field: "list_price", value: 200)],
        pageSize: 20
    )
)
result.data.forEach { print($0.name) }`,
    },
    {
      key: 'kotlin',
      label: 'Kotlin',
      sub: 'com.kintsugi · Android minSdk 24',
      code: `import com.kintsugi.KintsugiClient
import com.kintsugi.KintsugiAuth
import com.kintsugi.FilterRequest
import com.kintsugi.Where
import kotlinx.serialization.Serializable

@Serializable
data class Goods(val id: String, val name: String, val list_price: Double?)

val client = KintsugiClient(
    baseUrl = "https://kintsugi.your-company.com",
    appCode = "app-mart",
    auth   = KintsugiAuth.Token("eyJ..."),
)

val r = client.filter<Goods>(
    "ds_goods_a3f1",
    FilterRequest(
        where = listOf(Where.gt("list_price", 200)),
        pageSize = 20,
    ),
)
r.data.forEach { Log.d("kintsugi", it.name) }`,
    },
    {
      key: 'curl',
      label: 'curl',
      sub: 'OpenAPI 3.0.3',
      code: `curl -X POST https://kintsugi.your-company.com/api/apps/app-mart/ds/ds_goods_a3f1/filter \\
  -H "Authorization: Bearer eyJ..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "where": [{ "field": "list_price", "op": "gt", "value": 200 }],
    "orderBy": [{ "field": "updated_at", "dir": "desc" }],
    "page": 1,
    "pageSize": 20
  }'`,
    },
  ];
  const first = tabs[0]!;
  const [active, setActive] = React.useState(first.key);
  const cur = tabs.find((t) => t.key === active) ?? first;
  return (
    <section
      style={{
        background: C.paperWarm,
        borderTop: `1px solid ${C.ruleSoft}`,
        borderBottom: `1px solid ${C.ruleSoft}`,
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
        <SectionHeader number="V" caption="Specimens" title="同一个 filter 调用，四种语言" />
        <div
          className="k-codesamples-grid"
          style={{
            marginTop: 40,
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
            gap: 0,
            border: `1px solid ${C.rule}`,
            background: '#fff',
            minHeight: 420,
          }}
        >
          <nav
            className="k-codesamples-nav"
            style={{
              borderRight: `1px solid ${C.ruleSoft}`,
              background: C.paperWarm,
              padding: 0,
            }}
          >
            {tabs.map((t) => {
              const on = t.key === active;
              return (
                <button
                  key={t.key}
                  onClick={() => setActive(t.key)}
                  className={on ? 'k-cs-active' : ''}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '20px 24px',
                    border: 'none',
                    borderLeft: on ? `3px solid ${C.gold}` : `3px solid transparent`,
                    borderBottom: `1px solid ${C.ruleSoft}`,
                    background: on ? '#fff' : 'transparent',
                    cursor: 'pointer',
                    color: on ? C.ink : C.mutedDeep,
                    transition: 'all .2s ease',
                  }}
                >
                  <div
                    style={{
                      fontFamily: F.serif,
                      fontSize: 18,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {t.label}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontFamily: F.mono,
                      fontSize: 10,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: on ? C.gold : C.muted,
                    }}
                  >
                    {t.sub}
                  </div>
                </button>
              );
            })}
          </nav>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                padding: '14px 24px',
                borderBottom: `1px solid ${C.ruleSoft}`,
                background: C.paperWarm,
                fontFamily: F.mono,
                fontSize: 10,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: C.muted,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>{cur.label} · client.models.goods.filter</span>
              <span style={{ color: C.gold }}>● 200 OK · 38ms</span>
            </div>
            <pre
              key={cur.key}
              className="k-rise"
              style={{
                margin: 0,
                padding: '24px 28px',
                fontFamily: F.mono,
                fontSize: 13,
                lineHeight: 1.75,
                color: C.ink2,
                overflowX: 'auto',
                whiteSpace: 'pre',
                background: '#fff',
              }}
            >
              {cur.code}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// ARCHITECTURE — 横向分层剖面
// ============================================================
function Architecture(): React.ReactElement {
  const layers: Array<{
    name: string;
    en: string;
    items: string[];
    accent: string;
  }> = [
    {
      name: '消费层',
      en: 'consumers',
      accent: C.gold,
      items: ['Web 控制台', 'iOS / Android SDK', 'BFF 沙箱', '飞书机器人', 'MCP Server', '第三方 codegen'],
    },
    {
      name: '契约层',
      en: 'contracts',
      accent: C.goldSoft,
      items: ['OpenAPI 3.0.3', 'Instant API（6 端点）', 'Custom SQL 端点', 'Chats NL→SQL', 'AI 报表', 'Text-to-Page'],
    },
    {
      name: '语义层',
      en: 'semantics',
      accent: C.ink,
      items: ['Dataset Object (DO)', '字段 role / 业务名 / enum', 'relations / 外键', 'dataRule (ABAC/RLS)', 'softDelete · version', 'LLM 增强 + 人审'],
    },
    {
      name: '物理层',
      en: 'physical',
      accent: C.mutedDeep,
      items: ['db-scanner（多方言）', 'Schema Snapshot', '采样 + 脱敏', '加密连接信息', 'Postgres / MySQL / TiDB / MSSQL / Oracle / SQLite'],
    },
  ];
  return (
    <section style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
      <SectionHeader number="VII" caption="Architecture" title="一图看清四层" />
      <p
        style={{
          marginTop: 28,
          fontFamily: F.serif,
          fontSize: 16,
          color: C.muted,
          maxWidth: 760,
          lineHeight: 1.7,
        }}
      >
        从下往上读：物理层是你已有的库，语义层是 Kintsugi 增强后的事实源，契约层把语义自动派生成 API，消费层是吃这些 API 的人和系统。
      </p>
      <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {layers.map((layer, i) => (
          <div
            key={layer.name}
            className="k-arch-row"
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              gap: 24,
              alignItems: 'stretch',
            }}
          >
            <div
              style={{
                padding: '22px 20px',
                background: '#fff',
                borderLeft: `3px solid ${layer.accent}`,
                border: `1px solid ${C.rule}`,
                borderLeftWidth: 3,
              }}
            >
              <div
                style={{
                  fontFamily: F.serif,
                  fontSize: 24,
                  color: C.ink,
                  letterSpacing: '-0.01em',
                }}
              >
                {layer.name}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: '0.26em',
                  textTransform: 'uppercase',
                  color: layer.accent,
                }}
              >
                {layer.en} · {String(i + 1).padStart(2, '0')}
              </div>
            </div>
            <div
              style={{
                padding: '14px 20px',
                background: C.paperWarm,
                border: `1px solid ${C.rule}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignContent: 'center',
              }}
            >
              {layer.items.map((it) => (
                <span
                  key={it}
                  style={{
                    fontFamily: F.mono,
                    fontSize: 11.5,
                    letterSpacing: '0.04em',
                    padding: '6px 12px',
                    background: '#fff',
                    border: `1px solid ${C.ruleSoft}`,
                    color: C.ink2,
                    borderRadius: 999,
                  }}
                >
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================
// PERSONAS — 适用人群
// ============================================================
function Personas(): React.ReactElement {
  const ps: Array<{ name: string; role: string; quote: string; use: string }> = [
    {
      name: '李枫',
      role: '中后台工程师 / 八年经验',
      quote: '"我厌倦了写第 N 个 controller。"',
      use: '让 Kintsugi 替你出 6 个 CRUD + ABAC，你专心写 BFF 沙箱里那段需要思考的业务编排。',
    },
    {
      name: '陈墨',
      role: '数据团队 PM',
      quote: '"我想把数据交付从两周缩到当天。"',
      use: '问数 + AI 报表跑在 DO 之上，业务方自己点；改一次 dataRule，全公司视角同步。',
    },
    {
      name: '苏白',
      role: '数字化主管 / 接手遗留系统',
      quote: '"原供应商失联了，老工程师全走了——但库还在跑。"',
      use: 'Kintsugi 不动业务库，逐库逆向出 DO + OpenAPI；老前端继续跑，新前端 / Agent 直连合约。\n把"没人懂"的系统救成"能改、能查、能审计"的系统，而不是推倒重来。',
    },
  ];
  return (
    <section
      style={{
        background: C.paperWarm,
        borderTop: `1px solid ${C.ruleSoft}`,
        borderBottom: `1px solid ${C.ruleSoft}`,
      }}
    >
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
        <SectionHeader number="VIII" caption="Personas" title="三类人，三种用法" />
        <div
          className="k-cols-3"
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
          }}
        >
          {ps.map((p) => (
            <article
              key={p.name}
              style={{
                background: '#fff',
                border: `1px solid ${C.rule}`,
                padding: '32px 28px',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: -28,
                  right: -10,
                  fontFamily: F.serif,
                  fontStyle: 'italic',
                  fontSize: 180,
                  color: C.paperWarm,
                  letterSpacing: '-0.05em',
                  lineHeight: 1,
                  pointerEvents: 'none',
                }}
              >
                "
              </span>
              <div
                style={{
                  fontFamily: F.mono,
                  fontSize: 10,
                  letterSpacing: '0.26em',
                  textTransform: 'uppercase',
                  color: C.gold,
                  marginBottom: 14,
                }}
              >
                ⌗ {p.role}
              </div>
              <blockquote
                style={{
                  margin: 0,
                  fontFamily: F.serif,
                  fontStyle: 'italic',
                  fontSize: 22,
                  lineHeight: 1.45,
                  color: C.ink,
                  letterSpacing: '-0.01em',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {p.quote}
              </blockquote>
              <div
                style={{
                  marginTop: 20,
                  fontFamily: F.serif,
                  fontSize: 14.5,
                  lineHeight: 1.7,
                  color: C.ink2,
                  position: 'relative',
                  zIndex: 1,
                  whiteSpace: 'pre-line',
                }}
              >
                {p.use}
              </div>
              <div
                style={{
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: `1px solid ${C.ruleSoft}`,
                  fontFamily: F.serif,
                  fontSize: 13,
                  color: C.muted,
                }}
              >
                — {p.name}（化名）
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// PULL QUOTE — 居中大引言
// ============================================================
function PullQuote(): React.ReactElement {
  return (
    <section
      style={{
        position: 'relative',
        background: C.paperWarm,
        borderTop: `1px solid ${C.ruleSoft}`,
        borderBottom: `1px solid ${C.ruleSoft}`,
        overflow: 'hidden',
      }}
    >
      {/* 浅色点阵背景，营造博物馆陈列纸面 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(circle at center, ${C.ruleSoft} 1px, transparent 1px)`,
          backgroundSize: '28px 28px',
          opacity: 0.55,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          maxWidth: 1240,
          margin: '0 auto',
          padding: '120px 32px 110px',
        }}
      >
        <div
          className="k-artifact-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: 80,
            alignItems: 'center',
          }}
        >
          <ArtifactPlate />
          <ArtifactCopy />
        </div>
      </div>
    </section>
  );
}

function ArtifactPlate(): React.ReactElement {
  return (
    <figure
      className="k-artifact-plate"
      style={{
        position: 'relative',
        margin: 0,
        padding: '36px 32px 28px',
        background: '#fdfaf2',
        border: `1px solid ${C.rule}`,
        maxWidth: 460,
        marginInline: 'auto',
        transform: 'rotate(-0.4deg)',
        boxShadow:
          '0 32px 60px -38px rgba(15,23,42,.32), 0 12px 22px -16px rgba(160,123,63,.3)',
        transition: 'transform .4s cubic-bezier(.2,.65,.2,1), box-shadow .4s ease',
      }}
    >
      <CropMark position="tl" />
      <CropMark position="tr" />
      <CropMark position="bl" />
      <CropMark position="br" />

      <div
        style={{
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: C.gold,
          textAlign: 'center',
          marginBottom: 22,
        }}
      >
        ⊹ Exhibit · 物证 · No. 001
      </div>

      <img
        src="/cup.png"
        alt="Kintsugi-mended ceramic bowl"
        className="k-artifact-cup"
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          maxWidth: 360,
          margin: '0 auto',
          mixBlendMode: 'multiply',
        }}
      />

      <div
        aria-hidden
        style={{
          height: 1,
          background: `linear-gradient(to right, transparent, ${C.gold} 18%, ${C.gold} 82%, transparent)`,
          marginTop: 28,
          marginBottom: 18,
        }}
      />

      <figcaption style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: F.serif,
            fontSize: 30,
            color: C.ink,
            letterSpacing: '0.06em',
          }}
        >
          錦繕
        </div>
        <div
          style={{
            fontFamily: F.mono,
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: C.muted,
            marginTop: 6,
          }}
        >
          kintsugi · ca. 16c · Japan
        </div>
        <div
          style={{
            fontFamily: F.serif,
            fontStyle: 'italic',
            fontSize: 13,
            color: C.mutedDeep,
            marginTop: 10,
            lineHeight: 1.55,
          }}
        >
          Broken ceramic, mended with gold-laden lacquer.
        </div>
      </figcaption>
    </figure>
  );
}

function CropMark({
  position,
}: {
  position: 'tl' | 'tr' | 'bl' | 'br';
}): React.ReactElement {
  const off = -8;
  const size = 14;
  const base: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderTop: `1.5px solid ${C.gold}`,
    borderLeft: `1.5px solid ${C.gold}`,
  };
  const map: Record<typeof position, React.CSSProperties> = {
    tl: { top: off, left: off },
    tr: { top: off, right: off, transform: 'rotate(90deg)' },
    bl: { bottom: off, left: off, transform: 'rotate(-90deg)' },
    br: { bottom: off, right: off, transform: 'rotate(180deg)' },
  };
  return <span aria-hidden style={{ ...base, ...map[position] }} />;
}

function ArtifactCopy(): React.ReactElement {
  return (
    <div className="k-artifact-copy" style={{ paddingTop: 8 }}>
      <div
        style={{
          fontFamily: F.mono,
          fontSize: 11,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: C.gold,
          marginBottom: 22,
        }}
      >
        ⟡ Design Principle
      </div>

      <blockquote
        className="k-pull-quote"
        style={{
          margin: 0,
          fontFamily: F.serif,
          fontSize: 'clamp(26px, 3.2vw, 40px)',
          lineHeight: 1.45,
          color: C.ink,
          letterSpacing: '-0.005em',
          fontStyle: 'italic',
        }}
      >
        <span style={{ display: 'block' }}>
          破碎的瓷器以
          <span style={{ color: C.gold, fontStyle: 'normal' }}>金</span>
          修补
        </span>
        <span style={{ display: 'block', color: C.ink2 }}>
          裂缝便成了瓷器最美的部分
        </span>
        <span style={{ display: 'block', marginTop: 24 }}>
          过期的 schema 以{' '}
          <span style={{ color: C.gold, fontStyle: 'normal' }}>AI</span> 修补
        </span>
        <span style={{ display: 'block', color: C.ink2 }}>
          元数据便成了系统最值钱的资产
        </span>
      </blockquote>

      <div
        aria-hidden
        style={{
          height: 1,
          background: `linear-gradient(to right, ${C.gold}, transparent)`,
          width: 96,
          marginTop: 32,
        }}
      />

      <div
        style={{
          marginTop: 18,
          fontFamily: F.mono,
          fontSize: 11,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: C.muted,
        }}
      >
        — Kintsugi · 锦缮 · 设计原则
      </div>
    </div>
  );
}

// ============================================================
// FAQ
// ============================================================
function FAQ(): React.ReactElement {
  const items: Array<[string, string]> = [
    [
      '它会动我数据库吗？',
      '默认只读：扫描 + 采样 + 脱敏。写入端点（create / update / delete）需要配 access policy；DO 与配置存在自己的元数据库里，不污染业务库。',
    ],
    [
      '我的数据要传到 LLM 吗？',
      '只传 schema（表名 / 列名 / 注释）+ 你勾选的脱敏样本。可切换到本地模型；商用部署支持 Azure OpenAI / 私有 DeepSeek。',
    ],
    [
      '生成的代码我能改吗？',
      '能。Text-to-Page 给的是单文件 React JSX，可在控制台编辑器里直接改、保存、版本化。BFF 沙箱里的函数也是普通 JS，能 console.log 调试。',
    ],
    [
      '如果库结构变了怎么办？',
      'db-scanner 重跑会出 schema diff；DO 上的字段红/黄/绿三态标注「新增 / 类型变更 / 删除」，你审一次再 commit。OpenAPI 跟着漂。',
    ],
    [
      'ABAC / 多租户怎么注入？',
      'DO 上写 dataRule.scope=role 与 clauses，参数里用 ${user.tenant} 这种占位，运行时由 Kintsugi 在参数化 SQL 里注入 where；不依赖数据库 RLS。',
    ],
    [
      '价格 / 开源？',
      '当前是企业内部工具集形态，按 license 部署。开源核心（db-scanner / DO schema / Instant API spec）规划中。',
    ],
  ];
  return (
    <section style={{ maxWidth: 1240, margin: '0 auto', padding: '120px 32px' }}>
      <SectionHeader number="X" caption="FAQ" title="六个最常被问到的问题" />
      <div className="k-faq-grid" style={{ marginTop: 48, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {items.map(([q, a], i) => (
          <details
            key={q}
            className="k-faq-item"
            style={{
              padding: '24px 28px',
              borderTop: `1px solid ${C.ruleSoft}`,
              borderBottom: i >= items.length - 2 ? `1px solid ${C.ruleSoft}` : 'none',
              borderRight: i % 2 === 0 ? `1px solid ${C.ruleSoft}` : 'none',
              background: '#fff',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <span
                style={{
                  fontFamily: F.serif,
                  fontStyle: 'italic',
                  fontSize: 22,
                  color: C.gold,
                  flexShrink: 0,
                  width: 36,
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                style={{
                  fontFamily: F.serif,
                  fontSize: 19,
                  color: C.ink,
                  letterSpacing: '-0.005em',
                }}
              >
                {q}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  color: C.muted,
                  fontFamily: F.mono,
                  fontSize: 14,
                }}
              >
                +
              </span>
            </summary>
            <p
              style={{
                margin: '14px 0 0 50px',
                fontFamily: F.serif,
                fontSize: 15,
                lineHeight: 1.8,
                color: C.ink2,
              }}
            >
              {a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
