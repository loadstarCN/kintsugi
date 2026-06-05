import { Card, Layout, Menu, Result, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import * as React from 'react';
import { COLORS, FONTS } from '../../theme';
import { HELP_CONTENTS, HELP_SECTIONS, type HelpSlug } from './contents';

const { Sider, Content } = Layout;

/**
 * 系统内嵌文档站。两段：
 *  · 操作说明 — 各功能页面的"该怎么用"，含截图位（先文字 + UI 路径，截图后续补）
 *  · SDK 教程 — TS / iOS / Android 已可用；Python / Go / Java 占位（文档先就位，
 *    SDK 实现 round-12 跟进）
 *
 * 仅登录后可见（路由挂在 Shell 里）；没接入 OpenAPI（内部页面不暴露给 SDK 用户）。
 */
export function HelpPage(): React.ReactElement {
  const { slug } = useParams<{ slug: string }>();
  const activeSlug: HelpSlug = (slug && slug in HELP_CONTENTS ? slug : 'index') as HelpSlug;
  const article = HELP_CONTENTS[activeSlug];

  const menuItems = HELP_SECTIONS.map((section) => ({
    key: `g-${section.group}`,
    type: 'group' as const,
    label: (
      <span style={{ fontFamily: FONTS.mono, opacity: 0.8 }}>{section.group}</span>
    ),
    children: section.items.map((it) => ({
      key: it.slug,
      label: <Link to={`/help/${it.slug}`}>{it.label}</Link>,
    })),
  }));

  return (
    <Layout style={{ background: 'transparent', minHeight: '100%' }}>
      <Sider
        width={240}
        style={{
          background: COLORS.paper,
          borderRight: `1px solid ${COLORS.rule}`,
          paddingTop: 12,
          overflow: 'auto',
        }}
      >
        <div style={{ padding: '0 16px 12px', borderBottom: `1px solid ${COLORS.rule}` }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            帮助中心
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            操作说明 · SDK 教程
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeSlug]}
          style={{ borderRight: 'none', paddingTop: 8 }}
          items={menuItems}
        />
      </Sider>
      <Content style={{ padding: '24px 32px', background: COLORS.paper }}>
        <Card
          style={{
            maxWidth: 920,
            margin: '0 auto',
            border: `1px solid ${COLORS.rule}`,
          }}
          styles={{ body: { padding: '32px 40px' } }}
        >
          {article ? (
            <article className="kintsugi-help-article">{article}</article>
          ) : (
            <Result status="404" title="404" subTitle="文档未找到" />
          )}
        </Card>
        <style>{`
          .kintsugi-help-article h1 {
            margin: 0 0 8px;
            font-size: 28px;
          }
          .kintsugi-help-article h2 {
            margin: 32px 0 12px;
            font-size: 20px;
            border-bottom: 1px solid ${COLORS.rule};
            padding-bottom: 6px;
          }
          .kintsugi-help-article h3 {
            margin: 20px 0 8px;
            font-size: 16px;
          }
          .kintsugi-help-article p {
            line-height: 1.75;
            color: ${COLORS.ink};
            margin: 0 0 12px;
          }
          .kintsugi-help-article ul, .kintsugi-help-article ol {
            line-height: 1.85;
            padding-left: 22px;
            margin: 0 0 12px;
          }
          .kintsugi-help-article code {
            background: ${COLORS.paperWarm};
            padding: 1px 6px;
            border-radius: 4px;
            font-family: ${FONTS.mono};
            font-size: 13px;
          }
          .kintsugi-help-article pre {
            background: ${COLORS.paperWarm};
            border: 1px solid ${COLORS.rule};
            border-radius: 6px;
            padding: 14px 16px;
            margin: 0 0 16px;
            overflow-x: auto;
            font-family: ${FONTS.mono};
            font-size: 13px;
            line-height: 1.6;
          }
          .kintsugi-help-article pre code {
            background: transparent;
            padding: 0;
            font-size: inherit;
          }
          .kintsugi-help-article blockquote {
            margin: 0 0 12px;
            padding: 8px 14px;
            border-left: 3px solid ${COLORS.gold};
            background: ${COLORS.paperWarm};
            color: ${COLORS.muted};
          }
          .kintsugi-help-article a {
            color: ${COLORS.gold};
            text-decoration: underline;
          }
          .kintsugi-help-article table {
            border-collapse: collapse;
            width: 100%;
            margin: 0 0 16px;
          }
          .kintsugi-help-article th, .kintsugi-help-article td {
            border: 1px solid ${COLORS.rule};
            padding: 6px 10px;
            font-size: 13px;
          }
          .kintsugi-help-article th {
            background: ${COLORS.paperWarm};
            text-align: left;
          }
        `}</style>
      </Content>
    </Layout>
  );
}
