/**
 * lint-staged 配置（取代 package.json 里 inline 的 "lint-staged"）。
 *
 * 函数形式比对象 + 字符串多两个好处：
 *  1. 命令尾不会 append 匹配到的文件列表（pnpm subcommand 会被误解）
 *  2. 可以条件返回（只在真改了相关文件时触发昂贵 task）
 *
 * 为什么把 spec:check / docs build 放进 pre-commit：
 *  - spec:check 已经在 CI gate，但 CI 红灯 10 分钟才能反馈；本地一秒发现"改了 controller
 *    没刷 SDK snapshot"。
 *  - docs build 改 markdown 容易破坏 vitepress 链接（dead link 会让 build 失败），
 *    pre-commit 抓住 = PR 审稿人不用浪费一轮 review。
 *
 * 速度：spec:check ~1s（不连 DB），docs build ~4s。每次 commit 多 5s，可接受。
 */

export default {
  '*.{ts,tsx,mjs,js,cjs}': 'eslint --fix',
  '*.{json,md,yml,yaml}': 'prettier --write',

  // server OpenAPI 漂移检测：改了 platform-spec 或任何 controller → 必须刷 SDK snapshot
  'apps/server/src/modules/openapi/platform-spec.ts': () =>
    'pnpm --filter @kintsugi/server spec:check',
  'apps/server/src/modules/**/*.controller.ts': () =>
    'pnpm --filter @kintsugi/server spec:check',

  // docs 内容变更：跑 vitepress build 验证 markdown / 内链没坏
  // 合并成一个 matcher 避免 lint-staged 并发跑两次 build——同一份 .vitepress/.temp/
  // 互相踩文件会 ERR_MODULE_NOT_FOUND
  'apps/docs/docs/**/*.{md,ts}': () => 'pnpm --filter @kintsugi/docs build',
};
