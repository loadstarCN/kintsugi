---
layout: home

hero:
  name: Kintsugi
  text: 锦缮
  tagline: 给一个数据库连接字符串，自动生成 AI-Native 企业业务系统
  image:
    src: /logo.svg
    alt: Kintsugi
  actions:
    - theme: brand
      text: 5 分钟上手
      link: /getting-started/quickstart
    - theme: alt
      text: 核心概念
      link: /concepts/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/LoadstarCN/kintsugi

features:
  - icon: 🔍
    title: DBAgent 数据库逆向
    details: 连一个老库即可识别表结构 / 关系 / 业务语义；无主外键、命名混乱、异构多库都能扫
  - icon: ⚡
    title: Instant API
    details: 每张 Dataset 自动 9 个标准接口（filter/getOne/create/update/...），SQL 自动参数化，租户隔离开箱即用
  - icon: 📝
    title: 白盒可审计
    details: AI 生成的页面是真实 React 源码，BFF 是真实 JS，Custom SQL 是真实 SQL；可 git 管理、可二次开发
  - icon: 🤖
    title: AI-Native
    details: 系统天生暴露 CLI / MCP / Skills，Claude / Cursor / 飞书 Agent 可直接调用业务而不是只观察
  - icon: 🔒
    title: 企业级底座
    details: 多租户、RBAC、ABAC + PG RLS、HMAC OpenAPI、HTTPS、密钥旋转、审计、限流、追踪
  - icon: 🧩
    title: 80/20 原则
    details: 80% 标准 CRUD AI 自动生成；20% 个性化用 Pro Code（BFF / Custom SQL / React 子应用）扩展
---

## 一句话定位

**Kintsugi = AI 时代的"先逆向理解、再生成系统"的企业业务底座。**

它不是低代码搭积木，也不是聊天机器人。给它一个数据库，它产出：

- **业务模型 + ER 图**（DBAgent 推理）
- **管理后台**（Text-to-Page 生成 React 子应用）
- **Instant API**（每张表 9+ 个标准接口）
- **OpenAPI 文档**（自动）
- **AI 入口**（MCP / CLI / Skills，供 Agent 调用）
- **权限 / 多租户 / 审计**（企业底座）

## 适合谁

- **企业 IT**：要让旧库长出新前端，但又必须能审计代码、能 git 管理
- **开发团队**：80% CRUD 不想写，但不接受全黑盒；要能 Pro Code 扩展
- **AI 工具链团队**：希望让 Agent 直接调用自家业务，而不是只读
- **想做 AI-Native 产品的人**：要把 LUI（语言交互）和 GUI（图形交互）并存
