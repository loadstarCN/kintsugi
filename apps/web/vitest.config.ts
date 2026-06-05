import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // api.ts 用了 window.location，handleUnauthorized 模块级 guard 也依赖它
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.spec.{ts,tsx}'],
  },
});
