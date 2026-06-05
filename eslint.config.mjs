// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Workspace-level ESLint flat config (eslint v9).
 *
 * 起点定低：开 `recommended` 一档 + 关掉几条对现有代码改起来太重的规则。
 * 目标是先让 lint 跑起来 + 把"不该写"的（unused vars / no-await / etc）卡住，
 * 后续再分阶段升 strict-type-checked。
 *
 * 不开 strict-type-checked：现在的代码量上 strict 会爆 1k+ 个 warning，
 * 跟 prettier 的目标（"低维护成本"）冲突。
 */
export default tseslint.config(
  // ---- 全局忽略 ----
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vitepress/cache/**',
      'apps/docs/dist/**',
      'apps/docs/docs/.vitepress/cache/**',
      'apps/web/dist/**',
      'apps/server/scripts/fixtures/**', // JSON-only
      'packages/sdk/src/generated/**', // 自动生成
      'packages/mobile-sdk/**', // Swift / Kotlin
      '**/*.d.ts', // typedef 文件
    ],
  },

  // ---- 基线：JS recommended ----
  js.configs.recommended,

  // ---- 所有 JS/TS 文件给 node + browser globals ----
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // ---- TS 文件：typescript-eslint recommended（不带 type-checked，避免每次跑 tsc 巨慢）----
  ...tseslint.configs.recommended,

  // ---- bin scripts / mjs / cjs：允许 require / module ----
  // 必须在 tseslint.configs.recommended 之后，否则 no-require-imports 会被它打开。
  {
    files: ['**/bin/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // ---- 项目特定的关键守门 + 现实主义松绑 ----
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      // 对现有代码量挂太重的 → 降级 / 关闭
      '@typescript-eslint/no-explicit-any': 'off', // 边界 any 比"被迫装类型"更诚实
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // 这几条是"实际会咬人"的 bug 模式
      'no-console': 'off', // server 用 pino，但脚本和 boot 还是 console
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // ---- 测试 / 脚本：更宽松 ----
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/scripts/**', '**/*.config.{ts,mjs,js}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ---- mcp-server / cli：用了大量 dynamic require / process.env 直接读 ----
  {
    files: ['packages/mcp-server/**', 'packages/cli/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // ---- web: react-hooks 规则插件 ----
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
