import { Button, Drawer, Dropdown, Grid, Layout, Menu, Result, Space } from 'antd';
import {
  ApiOutlined,
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  SafetyCertificateOutlined,
  ConsoleSqlOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FunctionOutlined,
  HeartOutlined,
  HomeOutlined,
  LayoutOutlined,
  LinkOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  TableOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import * as React from 'react';
import { HealthPage } from './pages/HealthPage';
import { DataSourceListPage } from './pages/DataSourceListPage';
import { HomePage } from './pages/HomePage';
import { ScanHistoryPage } from './pages/ScanHistoryPage';
import { ScanResultPage } from './pages/ScanResultPage';
import { DatasetListPage } from './pages/DatasetListPage';
import { DatasetDetailPage } from './pages/DatasetDetailPage';
import { DatasetDataPage } from './pages/DatasetDataPage';
import { ErGraphPage } from './pages/ErGraphPage';
import { ChatsPage } from './pages/ChatsPage';
import { PagesListPage } from './pages/PagesListPage';
import { PageRunnerPage } from './pages/PageRunnerPage';
import { ReportsPage } from './pages/ReportsPage';
import { CustomSqlPage } from './pages/CustomSqlPage';
import { BffPage } from './pages/BffPage';
import { AssetTransferPage } from './pages/AssetTransferPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { LoginPage } from './pages/LoginPage';
import { ApplyPage } from './pages/ApplyPage';
import { LandingPage } from './pages/LandingPage';
import { HelpPage } from './pages/help/HelpPage';
import { AdminTrialsPage } from './pages/AdminTrialsPage';
import { RolesPage } from './pages/RolesPage';
// BillingPage / AdminUpgradeRequestsPage 暂时下架（价格未定终稿），import 一并下掉
// 让 dead-code elimination 不打包。等定稿后恢复 import + Route 即可。
import { ProtectedRoute } from './ProtectedRoute';
import { hasGrant, useAuth } from './auth';
import { COLORS, FONTS } from './theme';

const { Header, Sider, Content } = Layout;

export function App() {
  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/apply" element={<ApplyPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Shell />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

interface NavItem {
  key: string;
  to: string;
  label: string;
  icon: React.ReactNode;
  /** 可选：只对持有此 grant 的用户展示（前端匹配 RbacService 通配符规则）。 */
  requireGrant?: string;
}

const NAV: Array<{
  group: string;
  caption: string;
  items: NavItem[];
}> = [
  {
    group: '总览',
    caption: 'Overview',
    items: [
      { key: 'home', to: '/', label: '首页', icon: <HomeOutlined /> },
    ],
  },
  {
    group: '建模',
    caption: 'Modeling',
    items: [
      { key: 'datasources', to: '/datasources', label: '数据源', icon: <DatabaseOutlined /> },
      { key: 'datasets', to: '/datasets', label: '数据集', icon: <TableOutlined /> },
    ],
  },
  {
    group: '消费',
    caption: 'Consume',
    items: [
      { key: 'pages', to: '/pages', label: '页面', icon: <LayoutOutlined /> },
      { key: 'chats', to: '/chats', label: '问数', icon: <MessageOutlined /> },
      { key: 'reports', to: '/reports', label: 'AI 报表', icon: <BarChartOutlined /> },
    ],
  },
  {
    group: '扩展',
    caption: 'Extensions',
    items: [
      { key: 'sql', to: '/sql', label: 'Custom SQL', icon: <ConsoleSqlOutlined /> },
      { key: 'bff', to: '/bff', label: 'BFF', icon: <FunctionOutlined /> },
    ],
  },
  {
    group: '运维',
    caption: 'Operations',
    items: [
      {
        key: 'transfer',
        to: '/transfer',
        label: '资产导入导出',
        icon: <DeploymentUnitOutlined />,
        requireGrant: '*:asset:read',
      },
      { key: 'integrations', to: '/integrations', label: '集成 / SDK', icon: <LinkOutlined /> },
      {
        key: 'webhooks',
        to: '/webhooks',
        label: 'Webhooks',
        icon: <ApiOutlined />,
        requireGrant: '*:webhook:read',
      },
      {
        key: 'audit',
        to: '/audit-logs',
        label: '审计日志',
        icon: <AuditOutlined />,
        requireGrant: '*:audit:read',
      },
      { key: 'health', to: '/health', label: '健康检查', icon: <HeartOutlined /> },
    ],
  },
  // 「账户 → 订阅与计费」+「管理 → 升级/续费审批」 暂时全部隐藏，
  // 价格 / 套餐没定终稿前不对外露出（路由也下面一并去掉）。
  {
    group: '管理',
    caption: 'Admin',
    items: [
      {
        key: 'admin-roles',
        to: '/admin/roles',
        label: '角色 / 权限',
        icon: <UserOutlined />,
        // 租户级管理：tenant-admin 持有 *:rbac:read 默认露出
        requireGrant: '*:rbac:read',
      },
      {
        key: 'admin-trials',
        to: '/admin/trials',
        label: '试用申请审批',
        icon: <SafetyCertificateOutlined />,
        // 平台级：服务端 PermissionGuard 用 *:admin:read；只有 platform-admin 才能看到
        requireGrant: '*:admin:read',
      },
    ],
  },
  {
    group: '帮助',
    caption: 'Help',
    items: [
      { key: 'help', to: '/help', label: '操作说明 / SDK', icon: <BookOutlined /> },
    ],
  },
];

function Shell() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // 路由变化后自动关闭抽屉
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  // 视口拉宽到桌面后，避免 drawer 状态卡在 open
  React.useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);

  // 选中态：精确匹配 / 子路径前缀
  const selectedKey = React.useMemo(() => {
    const path = location.pathname;
    if (path === '/') return 'home';
    for (const grp of NAV) {
      for (const it of grp.items) {
        if (it.to === '/') continue;
        if (path === it.to || path.startsWith(it.to + '/')) return it.key;
      }
    }
    return 'home';
  }, [location.pathname]);

  // 按 grants 过滤：requireGrant 设了的，没匹配就不显示；整组 items 全过滤
  // 掉后整个 group 也不渲染（避免空标题）。
  const menuItems = NAV.flatMap((grp) => {
    const items = grp.items.filter((it) => !it.requireGrant || hasGrant(me, it.requireGrant));
    if (items.length === 0) return [];
    return [
      {
        key: `g-${grp.group}`,
        type: 'group' as const,
        label: (
          <Space size={8}>
            <span style={{ fontFamily: FONTS.mono, opacity: 0.85 }}>{grp.caption}</span>
            <span style={{ fontSize: 11, color: COLORS.mutedSoft }}>·</span>
            <span style={{ fontSize: 11, color: COLORS.mutedSoft }}>{grp.group}</span>
          </Space>
        ),
        children: items.map((it) => ({
          key: it.key,
          icon: it.icon,
          label: <Link to={it.to}>{it.label}</Link>,
        })),
      },
    ];
  });

  const sideMenu = (
    <>
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        style={{ borderRight: 'none', paddingTop: 12, paddingBottom: 16 }}
        items={menuItems}
      />
      <SiderFooter />
    </>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        className="kintsugi-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? 10 : 24,
          paddingLeft: isMobile ? 12 : 28,
          paddingRight: isMobile ? 12 : 24,
        }}
      >
        {isMobile && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
            aria-label="打开导航"
            style={{ marginRight: 4 }}
          />
        )}
        <Brand compact={isMobile} />
        <div style={{ flex: 1 }} />
        <Space size={isMobile ? 8 : 20} align="center">
          {!isMobile && (
            <Link
              to="/integrations?tab=openapi"
              style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: COLORS.muted,
                textDecoration: 'none',
              }}
            >
              <ApiOutlined style={{ marginRight: 6 }} />
              API · 接口文档
            </Link>
          )}
          <Dropdown
            menu={{
              items: [
                ...(isMobile
                  ? [
                      {
                        key: 'openapi',
                        icon: <ApiOutlined />,
                        label: 'API · 接口文档',
                        onClick: () => navigate('/integrations?tab=openapi'),
                      },
                      { type: 'divider' as const },
                    ]
                  : []),
                {
                  key: 'logout',
                  icon: <LogoutOutlined />,
                  label: '退出登录',
                  onClick: async () => {
                    await logout();
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <Button
              type="text"
              style={{
                color: COLORS.ink,
                paddingInline: isMobile ? 6 : 10,
                fontFamily: FONTS.mono,
                fontSize: 12,
                letterSpacing: '0.04em',
              }}
            >
              <Space size={8}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: COLORS.paperWarm,
                    border: `1px solid ${COLORS.ruleSoft}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: COLORS.gold,
                    flexShrink: 0,
                  }}
                >
                  <UserOutlined />
                </span>
                {!isMobile && me ? `${me.username}@${me.tenantCode}` : ''}
              </Space>
            </Button>
          </Dropdown>
        </Space>
      </Header>
      <Layout>
        {!isMobile && (
          <Sider
            className="kintsugi-sider"
            width={232}
            style={{ background: '#ffffff' }}
          >
            {sideMenu}
          </Sider>
        )}
        {isMobile && (
          <Drawer
            placement="left"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            width={272}
            title={
              <span style={{
                fontFamily: FONTS.mono,
                fontSize: 11,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: COLORS.muted,
              }}>
                导航
              </span>
            }
            styles={{ body: { padding: 0, background: '#fff' } }}
            className="kintsugi-mobile-drawer"
          >
            {sideMenu}
          </Drawer>
        )}
        <Content className="kintsugi-content" style={{ padding: 0 }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/datasources" element={<PageWrap><DataSourceListPage /></PageWrap>} />
            <Route path="/datasources/:dsId/scans" element={<PageWrap><ScanHistoryPage /></PageWrap>} />
            <Route path="/datasources/:dsId/scans/:jobId" element={<PageWrap><ScanResultPage /></PageWrap>} />
            <Route path="/datasources/:dsId/er" element={<PageWrap fullbleed><ErGraphPage /></PageWrap>} />
            <Route path="/datasets" element={<PageWrap><DatasetListPage /></PageWrap>} />
            <Route path="/datasets/:datasetCode" element={<PageWrap><DatasetDetailPage /></PageWrap>} />
            <Route path="/datasets/:datasetCode/data" element={<PageWrap><DatasetDataPage /></PageWrap>} />
            <Route path="/chats" element={<PageWrap><ChatsPage /></PageWrap>} />
            <Route path="/pages" element={<PageWrap><PagesListPage /></PageWrap>} />
            <Route path="/pages/:id" element={<PageWrap><PageRunnerPage /></PageWrap>} />
            <Route path="/reports" element={<PageWrap><ReportsPage /></PageWrap>} />
            <Route path="/sql" element={<PageWrap><CustomSqlPage /></PageWrap>} />
            <Route path="/bff" element={<PageWrap><BffPage /></PageWrap>} />
            <Route path="/transfer" element={<PageWrap><AssetTransferPage /></PageWrap>} />
            <Route path="/integrations" element={<PageWrap><IntegrationsPage /></PageWrap>} />
            <Route path="/audit-logs" element={<PageWrap><AuditLogsPage /></PageWrap>} />
            <Route path="/webhooks" element={<PageWrap><WebhooksPage /></PageWrap>} />
            <Route path="/health" element={<PageWrap><HealthPage /></PageWrap>} />
            <Route path="/help" element={<PageWrap fullbleed><HelpPage /></PageWrap>} />
            <Route path="/help/:slug" element={<PageWrap fullbleed><HelpPage /></PageWrap>} />
            <Route path="/admin/roles" element={<PageWrap><RolesPage /></PageWrap>} />
            <Route path="/admin/trials" element={<PageWrap><AdminTrialsPage /></PageWrap>} />
            {/* /billing + /admin/upgrade-requests 暂时下架，价格定稿后恢复 */}
            <Route path="*" element={<PageWrap><NotFound /></PageWrap>} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'flex',
        alignItems: 'baseline',
        gap: compact ? 8 : 12,
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 18,
          height: 18,
          background: COLORS.ink,
          borderRadius: 2,
          position: 'relative',
          alignSelf: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            background:
              'linear-gradient(135deg, transparent 38%, #c8a96a 39%, #a07b3f 50%, #c8a96a 61%, transparent 62%)',
          }}
        />
      </span>
      <span
        style={{
          fontFamily: FONTS.serif,
          fontWeight: 400,
          fontSize: compact ? 18 : 22,
          letterSpacing: '-0.01em',
          color: COLORS.ink,
        }}
      >
        Kintsugi
      </span>
      {!compact && (
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: COLORS.gold,
          }}
        >
          锦缮 · console
        </span>
      )}
    </Link>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="找不到这个页面"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          回首页
        </Button>
      }
      style={{ paddingTop: 64 }}
    />
  );
}

function SiderFooter() {
  return (
    <div
      style={{
        padding: '20px 24px',
        borderTop: `1px solid ${COLORS.ruleSoft}`,
        margin: '8px 12px 0',
        fontFamily: FONTS.mono,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: COLORS.mutedSoft,
        lineHeight: 1.7,
      }}
    >
      <div>v0.1 · build {new Date().toISOString().slice(0, 10)}</div>
      <div style={{ marginTop: 4 }}>
        <span style={{ color: COLORS.gold }}>●</span>{' '}
        <span style={{ color: COLORS.muted }}>SDK · CLI · MCP 已就绪</span>
      </div>
    </div>
  );
}

/** 给所有内页统一加 padding；ER 图等需要全屏的传 fullbleed=true。
 *  padding / min-height 在 index.css 里，随 header 高度自适应。 */
function PageWrap({
  children,
  fullbleed,
}: {
  children: React.ReactNode;
  fullbleed?: boolean;
}) {
  return (
    <div
      className={`kintsugi-fade-up ${fullbleed ? 'kintsugi-page kintsugi-page-fullbleed' : 'kintsugi-page'}`}
      style={{ background: COLORS.paper }}
    >
      {children}
    </div>
  );
}
