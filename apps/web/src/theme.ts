/**
 * Kintsugi · 锦缮 设计令牌
 *
 * 设计立意：日本"金缮"工艺——以哑金修复瓷器裂缝。
 *  墨 (#0f172a) · 纸 (#fafaf7) · 哑金 (#a07b3f) 三色为骨；
 *  Garamond/Iowan Old Style 类衬线为字魂；
 *  细金线作为视觉签名出现在分割与高亮处。
 *
 * 所有页面应从这里取值，避免颜色与字体散落。
 */

import type { ThemeConfig } from 'antd';

export const COLORS = {
  ink: '#0f172a',
  ink2: '#1e293b',
  paper: '#fafaf7',
  paperWarm: '#f5f1e8',
  rule: '#e5e7eb',
  ruleSoft: '#eeece4',
  muted: '#64748b',
  mutedSoft: '#94a3b8',
  gold: '#a07b3f',
  goldSoft: '#c8a96a',
  blue: '#1677ff',
  ok: '#16a34a',
  warn: '#d97706',
  fail: '#b91c1c',
} as const;

export const FONTS = {
  /** 衬线 · 用于显示性大字（hero 标题、品牌、卡片标题） */
  serif:
    '"Iowan Old Style", "Apple Garamond", "EB Garamond", "Baskerville", Georgia, "Songti SC", "STSong", "宋体", serif',
  /** 等宽 · 用于元数据、caps 标签、数字、code、状态 */
  mono:
    '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  /** UI 常规 · 表单 / 表格 / 段落 */
  ui:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
} as const;

export const SHADOWS = {
  card: '0 1px 2px rgba(15,23,42,0.04)',
  cardHover: '0 8px 24px rgba(160,123,63,0.10), 0 1px 2px rgba(15,23,42,0.04)',
  hero: '0 18px 60px rgba(15,23,42,0.06)',
} as const;

export const RADII = {
  sm: 4,
  md: 6,
  lg: 8,
} as const;

/** "金缮"金线渐变（横向 / 纵向） */
export const GOLD_RULE_HORIZONTAL = `linear-gradient(90deg, transparent 0%, ${COLORS.gold} 12%, ${COLORS.goldSoft} 50%, ${COLORS.gold} 88%, transparent 100%)`;
export const GOLD_RULE_VERTICAL = `linear-gradient(180deg, transparent 0%, ${COLORS.gold} 20%, ${COLORS.goldSoft} 50%, ${COLORS.gold} 80%, transparent 100%)`;

/** Caps + 间距的 mono 标签样式（hero / section title 用） */
export const capsMono: React.CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: COLORS.mutedSoft,
};

/** 注入到 antd ConfigProvider 的主题 */
export const kintsugiTheme: ThemeConfig = {
  token: {
    colorPrimary: COLORS.blue,
    colorInfo: COLORS.blue,
    colorSuccess: COLORS.ok,
    colorWarning: COLORS.warn,
    colorError: COLORS.fail,
    colorLink: COLORS.gold,
    colorLinkHover: '#8a6932',
    colorLinkActive: '#6b522a',
    colorText: COLORS.ink,
    colorTextSecondary: COLORS.muted,
    colorTextTertiary: COLORS.mutedSoft,
    colorBorder: COLORS.rule,
    colorBorderSecondary: COLORS.ruleSoft,
    colorBgContainer: '#ffffff',
    colorBgLayout: COLORS.paper,
    colorBgElevated: '#ffffff',
    borderRadius: 8,
    borderRadiusLG: 8,
    fontFamily: FONTS.ui,
    fontSize: 14,
    boxShadow: SHADOWS.card,
    boxShadowSecondary: SHADOWS.card,
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      headerColor: COLORS.ink,
      headerHeight: 64,
      siderBg: '#ffffff',
      bodyBg: COLORS.paper,
      headerPadding: '0 28px',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: COLORS.paperWarm,
      itemSelectedColor: COLORS.ink,
      itemColor: COLORS.muted,
      itemHoverColor: COLORS.ink,
      itemHoverBg: COLORS.paperWarm,
      iconSize: 14,
      itemHeight: 40,
      itemMarginInline: 8,
      itemBorderRadius: 4,
      groupTitleColor: COLORS.mutedSoft,
      groupTitleFontSize: 11,
    },
    Card: {
      borderRadiusLG: 8,
    },
    Button: {
      borderRadius: 6,
      borderRadiusLG: 8,
    },
    Tag: {
      borderRadiusSM: 3,
    },
    Tabs: {
      itemSelectedColor: COLORS.ink,
      itemHoverColor: COLORS.gold,
      inkBarColor: COLORS.gold,
      titleFontSize: 14,
    },
    Input: {
      borderRadius: 6,
      activeBorderColor: COLORS.gold,
      hoverBorderColor: COLORS.goldSoft,
    },
    Select: {
      borderRadius: 6,
      optionSelectedBg: COLORS.paperWarm,
    },
    Table: {
      headerBg: COLORS.paperWarm,
      headerColor: COLORS.ink,
      headerSplitColor: COLORS.ruleSoft,
      borderColor: COLORS.ruleSoft,
      headerBorderRadius: 0,
    },
    Breadcrumb: {
      itemColor: COLORS.muted,
      lastItemColor: COLORS.ink,
      separatorColor: COLORS.mutedSoft,
    },
    Modal: {
      borderRadiusLG: 8,
    },
  },
};
