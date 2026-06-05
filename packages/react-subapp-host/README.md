# @kintsugi/react-subapp-host ⏸️ v2

微前端沙箱：把用户自定义 React 子应用（`src/app/index.jsx`）嵌入主控制台。

## 目标

- 用 `qiankun` / `icestark` / `wujie` 三选一做微前端运行时。
- 子应用能访问 `useSdkClient()` / `useI18n()` / `useNavigate()` / `useLocation()` hooks。
- 导入白名单：只允许 React / ReactDOM / @kintsugi/sdk / antd；禁止 fs / network / eval。
- 发布模式 vs 编辑模式双轨。

## 今天做不到的原因

- 需要真 bundling pipeline（esbuild / swc）+ 子应用 manifest；
- 安全沙箱需要 shadowDOM + IIFE 包装 + proxy；
- 热更新与版本化（每次发布存 sourceFiles snapshot，带 version）。

## 起点 API 草案

```ts
// 主控制台侧
loadReactSubApp(pageId: string, container: HTMLElement): Promise<SubAppHandle>
// 子应用侧（会被 inject 到 window）
export function useSdkClient(): Client
```
