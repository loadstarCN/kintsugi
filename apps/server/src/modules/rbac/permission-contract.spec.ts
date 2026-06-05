/**
 * 强约束：所有 controller 上的 @Permission(...) 必须在
 * @kintsugi/shared 的 KNOWN_PERMISSIONS 里登记。
 *
 * 这是"角色 ↔ 权限矩阵"的单一事实源契约：
 *   - 加新接口时新增了 @Permission('foo:bar')，但 KNOWN_PERMISSIONS 没加 → CI fail，
 *     提醒去更新预置角色 / 帮助页矩阵。
 *   - KNOWN_PERMISSIONS 里有的但代码里没人用 → 也 fail（避免悬空文档）。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_PERMISSIONS } from '@kintsugi/shared';

const MODULES_DIR = join(__dirname, '..');
const PERMISSION_RE = /@Permission\(\s*['"]([^'"]+)['"]\s*\)/g;

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (full.endsWith('.controller.ts')) {
      yield full;
    }
  }
}

function collectUsedPermissions(): Set<string> {
  const used = new Set<string>();
  for (const file of walkTs(MODULES_DIR)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(PERMISSION_RE)) {
      used.add(m[1]!);
    }
  }
  return used;
}

describe('Permission contract (KNOWN_PERMISSIONS ↔ controllers)', () => {
  const used = collectUsedPermissions();
  const known = new Set<string>(KNOWN_PERMISSIONS);

  it('every @Permission used in controllers is registered in KNOWN_PERMISSIONS', () => {
    const missing = [...used].filter((k) => !known.has(k));
    expect(missing, `unregistered permissions found in controllers — add to packages/shared/src/rbac-roles.ts: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('every key in KNOWN_PERMISSIONS is actually used by some controller', () => {
    const orphaned = [...known].filter((k) => !used.has(k));
    expect(orphaned, `KNOWN_PERMISSIONS has dangling entries (no controller declares them) — remove from packages/shared/src/rbac-roles.ts: ${JSON.stringify(orphaned)}`).toEqual([]);
  });
});
