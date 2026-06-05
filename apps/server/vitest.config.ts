import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // Nest DI 依赖 emitDecoratorMetadata：vitest 默认 esbuild 不发 decorator type metadata，
  // controller / @Injectable 注入会拿到 undefined。这里换 swc transform 把元数据发出来。
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    // 默认 globals 关；spec 自己 `import { describe, it, expect } from 'vitest'`
    globals: false,
    // e2e 路径要起 Nest app，比单测慢得多
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // 阈值 = 当前 baseline 略低（反退化 gate，而非"到达目标")。
      // 现状 lines=45% / branches=72% / functions=69% / statements=45%。
      // 已覆盖 e2e: auth / application / webhook / health / audit / access-key /
      // datasource / dataset / chats / reports / pages / bff / custom-sql /
      // instant-api / rbac / openapi / asset-transfer / dbagent / sdk-download / trial。
      // 目标长期：lines 60% / branches 80%。
      thresholds: {
        lines: 44,
        functions: 68,
        statements: 44,
        branches: 71,
      },
      // exclude 编辑器 / 测试 / 脚本 / 引导
      exclude: [
        'dist/**',
        'src/main.ts',
        'src/tracing.ts',
        'scripts/**',
        '**/*.spec.ts',
        '**/*.config.ts',
        'src/**/*.dto.ts',
        'src/**/index.ts',
      ],
    },
  },
});
