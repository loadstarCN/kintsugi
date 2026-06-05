/**
 * 离线刷新 packages/sdk/spec/openapi.platform.json 快照。
 *
 * 通常路径：`pnpm --filter @kintsugi/sdk gen` 会从 live server
 * (KINTSUGI_API_BASE 默认 http://localhost:4000) 拉 /api/openapi.platform.json，
 * 没起 server 时它 fallback 到现有 snapshot——结果就是改了 platform-spec.ts
 * 但 server 没跑，gen 不会真刷 snapshot，pre-commit spec:check 就会拒。
 *
 * 这个脚本直接 import buildPlatformSpec() 写盘，不依赖 live server。
 *
 * 用法：
 *   pnpm --filter @kintsugi/server spec:dump
 *   pnpm --filter @kintsugi/sdk gen        # 用刚写的 snapshot 重生成 types
 *   git add packages/sdk/spec packages/sdk/src/generated
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPlatformSpec } from '../src/modules/openapi/platform-spec';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'packages', 'sdk', 'spec', 'openapi.platform.json');

const spec = buildPlatformSpec();
fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(spec, null, 2) + '\n');

console.log(`✓ snapshot written to ${SNAPSHOT_PATH}`);
