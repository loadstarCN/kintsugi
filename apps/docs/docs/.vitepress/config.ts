import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Kintsugi（锦缮）',
  description: '连一个数据库连接字符串，自动生成 AI-Native 企业业务系统的平台',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    ['meta', { name: 'theme-color', content: '#1f6feb' }],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '快速开始', link: '/getting-started/quickstart' },
      { text: '核心概念', link: '/concepts/architecture' },
      { text: '使用指南', link: '/guides/dbagent-tuning' },
      { text: 'API', link: '/reference/instant-api' },
      {
        text: 'v0.x',
        items: [
          { text: '更新日志', link: '/changelog' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],

    sidebar: {
      '/getting-started/': [
        {
          text: '快速开始',
          items: [
            { text: '安装与启动', link: '/getting-started/installation' },
            { text: '5 分钟 quickstart', link: '/getting-started/quickstart' },
            { text: '从零做出第一个应用', link: '/getting-started/first-app' },
          ],
        },
      ],
      '/concepts/': [
        {
          text: '核心概念',
          items: [
            { text: '系统架构', link: '/concepts/architecture' },
            { text: 'Tenant / Application / Dataset', link: '/concepts/tenant-application-dataset' },
            { text: 'DO（Dataset Object）', link: '/concepts/do' },
            { text: 'Instant API', link: '/concepts/instant-api' },
            { text: 'ABAC + RLS', link: '/concepts/abac-rls' },
            { text: 'BFF 沙箱', link: '/concepts/bff' },
            { text: 'AI-Native 接入', link: '/concepts/ai-native' },
            { text: '术语表', link: '/concepts/glossary' },
          ],
        },
      ],
      '/guides/': [
        {
          text: '使用指南',
          items: [
            { text: 'DBAgent 调优', link: '/guides/dbagent-tuning' },
            { text: '写 BFF 脚本', link: '/guides/bff-scripts' },
            { text: '写 Custom SQL', link: '/guides/custom-sql' },
            { text: 'HMAC 签名规范', link: '/guides/hmac' },
            { text: 'Text-to-Page 提示词', link: '/guides/text-to-page' },
            { text: '备份与灾难恢复', link: '/guides/backup-dr' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '平台 API（自动生成）', link: '/reference/api' },
            { text: 'Instant API', link: '/reference/instant-api' },
            { text: 'CLI（kintsugi）', link: '/reference/cli' },
            { text: 'MCP Tools', link: '/reference/mcp' },
            { text: 'TypeScript SDK', link: '/reference/sdk-ts' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/LoadstarCN/kintsugi' },
    ],

    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2026 Kintsugi contributors',
    },

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
      label: '本页内容',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdatedText: '最后更新',
  },

  // 站点根目录到 build 出 dist
  outDir: '../dist',

  // localhost / 内网链接不算 dead link（不要 build 时报错）
  ignoreDeadLinks: [/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/],
});
