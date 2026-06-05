import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webPort = Number(env['WEB_PORT'] ?? 5173);
  const serverPort = Number(env['SERVER_PORT'] ?? 4000);
  return {
    plugins: [react()],
    // 工作区里的 @kintsugi/shared 是 tsc 输出的 CJS（dist/index.js），浏览器
    // 不能直接执行 CJS module。必须 include 进 deps 优化器，让 esbuild 把它
    // 预打成 ESM 后再被 import。
    optimizeDeps: {
      include: ['@kintsugi/shared'],
    },
    // 生产构建（rollup）静态分析不到 CJS 包里 `Object.defineProperty(exports, ...)`
    // 形式的命名导出，导致 build 时报"@kintsugi/shared 没有 callerCanGrant"。
    // 把它纳入 commonjs 插件的处理范围，让 rollup 用动态 require 兜底解析。
    build: {
      commonjsOptions: {
        include: [/node_modules/, /packages\/shared/],
      },
    },
    server: {
      port: webPort,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
