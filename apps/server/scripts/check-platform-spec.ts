/**
 * 平台 OpenAPI 漂移检测。
 *
 * 比较 `buildPlatformSpec()` 当前输出 与 `packages/sdk/spec/openapi.platform.json`
 * 已 checked-in 的快照。不一致就退出码 1，CI 拒绝合并。
 *
 * 触发条件：
 *  - 改了 platform-spec.ts 但忘了跑 `pnpm --filter @kintsugi/sdk gen` 提交快照
 *  - 改了 controller 加新端点 + 改了 platform-spec.ts，但快照没刷
 *
 * 用法：
 *   pnpm --filter @kintsugi/server spec:check
 *
 * 修复：
 *   pnpm --filter @kintsugi/sdk gen
 *   git add packages/sdk/spec packages/sdk/src/generated
 *   git commit
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPlatformSpec } from '../src/modules/openapi/platform-spec';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'packages', 'sdk', 'spec', 'openapi.platform.json');

function main(): void {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error(`✗ snapshot not found: ${SNAPSHOT_PATH}`);
    console.error(`  run: pnpm --filter @kintsugi/sdk gen`);
    process.exit(1);
  }

  const expected = JSON.stringify(buildPlatformSpec(), null, 2) + '\n';
  const actual = fs.readFileSync(SNAPSHOT_PATH, 'utf8');

  if (expected === actual) {
    console.log(`✓ platform spec snapshot is in sync`);
    return;
  }

  console.error(`✗ platform spec drift detected`);
  console.error(`  snapshot: ${SNAPSHOT_PATH}`);
  console.error(`  diff (snapshot vs current buildPlatformSpec):`);

  // 简单 line-by-line diff，限制行数避免淹没 CI 日志
  const expLines = expected.split('\n');
  const actLines = actual.split('\n');
  const max = Math.max(expLines.length, actLines.length);
  let shown = 0;
  for (let i = 0; i < max; i++) {
    if (expLines[i] === actLines[i]) continue;
    if (shown >= 30) {
      console.error(`  ... (more diffs truncated)`);
      break;
    }
    if (actLines[i] !== undefined) console.error(`  - ${actLines[i]}`);
    if (expLines[i] !== undefined) console.error(`  + ${expLines[i]}`);
    shown++;
  }

  console.error(``);
  console.error(`  fix: pnpm --filter @kintsugi/sdk gen`);
  console.error(`       git add packages/sdk/spec packages/sdk/src/generated`);
  process.exit(1);
}

main();
