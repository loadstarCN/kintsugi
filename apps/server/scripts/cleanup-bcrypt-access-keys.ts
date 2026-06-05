/**
 * 旧 bcrypt 时代的 AccessKey.secretKeyHash 是 bcrypt 哈希——AES-GCM decrypt 会抛错。
 * verifySignature 已经把这种 key 视为失效（warn-log + return null），但 DB 里还堆着。
 *
 * 这个脚本扫一遍：
 *  - 对每条未撤销的 AccessKey 试着 decrypt(secretKeyHash)
 *  - 解不开 → revokedAt = now（默认）或 dry-run 只打印
 *  - 输出统计：good / legacy / decrypted-but-empty
 *
 * 用法：
 *   pnpm --filter @kintsugi/server bcrypt:cleanup           # dry-run
 *   pnpm --filter @kintsugi/server bcrypt:cleanup -- --apply
 */

import { PrismaClient } from '@prisma/client';
import { decrypt } from '../src/common/crypto';

interface Stats {
  total: number;
  good: number;
  legacy: number;
  emptyAfterDecrypt: number;
  revoked: number;
  alreadyRevoked: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  const stats: Stats = {
    total: 0,
    good: 0,
    legacy: 0,
    emptyAfterDecrypt: 0,
    revoked: 0,
    alreadyRevoked: 0,
  };
  const legacyIds: string[] = [];

  console.log(`[bcrypt:cleanup] mode=${apply ? 'APPLY' : 'dry-run (re-run with --apply to revoke)'}`);

  // 流式扫——access key 表大时也不一次性读全
  let cursor: string | null = null;
  const BATCH = 500;
  for (;;) {
    const rows = await prisma.accessKey.findMany({
      take: BATCH,
      ...(cursor ? { cursor: { accessKey: cursor }, skip: 1 } : {}),
      orderBy: { accessKey: 'asc' },
      select: { accessKey: true, secretKeyHash: true, revokedAt: true, createdBy: true },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.accessKey;
    for (const r of rows) {
      stats.total += 1;
      if (r.revokedAt) {
        stats.alreadyRevoked += 1;
        continue;
      }
      try {
        const plain = decrypt(r.secretKeyHash);
        if (!plain) {
          stats.emptyAfterDecrypt += 1;
          legacyIds.push(r.accessKey);
        } else {
          stats.good += 1;
        }
      } catch {
        stats.legacy += 1;
        legacyIds.push(r.accessKey);
      }
    }
    if (rows.length < BATCH) break;
  }

  console.log(`\nScan summary:`);
  console.log(`  total:           ${stats.total}`);
  console.log(`  good (decrypts): ${stats.good}`);
  console.log(`  already revoked: ${stats.alreadyRevoked}`);
  console.log(`  legacy bcrypt:   ${stats.legacy}`);
  console.log(`  empty plaintext: ${stats.emptyAfterDecrypt}`);
  console.log(`  to revoke:       ${legacyIds.length}`);

  if (legacyIds.length === 0) {
    console.log(`\nNothing to do.`);
    await prisma.$disconnect();
    return;
  }

  if (!apply) {
    console.log(`\nDry run. Sample IDs:`);
    for (const id of legacyIds.slice(0, 5)) console.log(`  ${id}`);
    console.log(`\nRe-run with --apply to revoke these ${legacyIds.length} key(s).`);
    await prisma.$disconnect();
    return;
  }

  // 批量 revoke
  const r = await prisma.accessKey.updateMany({
    where: { accessKey: { in: legacyIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  stats.revoked = r.count;
  console.log(`\nRevoked ${stats.revoked} key(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
