/**
 * 验证 adapter.runReadonly 真正强制 READ ONLY 事务（PG / MySQL 端拒绝写类语句）。
 * 跑法：pnpm exec dotenv -e ../../.env -- node -r @swc-node/register apps/server/scripts/test-readonly.ts
 *      或在 apps/server 下：pnpm exec dotenv -e ../../.env -- node -r @swc-node/register scripts/test-readonly.ts
 */
import { PrismaClient } from '@prisma/client';
import { registerDefaultDialects, getDialect } from '@kintsugi/db-scanner';
import { decrypt } from '../src/common/crypto';

async function main(): Promise<void> {
  registerDefaultDialects();
  const prisma = new PrismaClient();
  const ds = await prisma.dataSource.findFirst();
  if (!ds) {
    console.log('no datasource; bootstrap demo first');
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`testing dialect=${ds.dialect}, host=${ds.host}`);

  const adapter = getDialect(ds.dialect);
  await adapter.connect({
    dialect: ds.dialect as 'postgres' | 'mysql' | 'mariadb' | 'tidb' | 'mssql' | 'oracle' | 'sqlite',
    host: ds.host,
    port: ds.port,
    user: ds.username,
    password: decrypt(ds.passwordCiphertext),
    database: ds.database,
    schema: ds.schema ?? undefined,
    sslMode: (ds.sslMode as 'disable' | 'require' | 'verify-ca' | 'verify-full' | undefined) ?? undefined,
  });

  let pass = 0;
  let fail = 0;

  // 1. SELECT 通过
  try {
    const r = await adapter.runReadonly('select 1 as v');
    if (Array.isArray(r) && (r[0] as { v?: number })?.v === 1) {
      console.log('✓ SELECT via runReadonly OK');
      pass++;
    } else {
      console.log(`✗ SELECT returned unexpected: ${JSON.stringify(r)}`);
      fail++;
    }
  } catch (err) {
    console.log(`✗ SELECT failed: ${(err as Error).message}`);
    fail++;
  }

  // 2. CREATE TEMP TABLE 被 RO 拒绝
  try {
    await adapter.runReadonly('create temp table __ro_probe_kintsugi (x int)');
    console.log('✗ CREATE TEMP TABLE NOT REJECTED — RO 没生效');
    fail++;
  } catch (err) {
    console.log(`✓ CREATE rejected by RO: ${(err as Error).message.slice(0, 100)}`);
    pass++;
  }

  // 3. UPDATE（无副作用 where false）也被 RO 拒
  try {
    if (ds.dialect === 'postgres') {
      await adapter.runReadonly("update pg_class set relname=relname where 1=0");
    } else {
      await adapter.runReadonly("update information_schema.tables set table_name=table_name where 1=0");
    }
    console.log('✗ UPDATE NOT REJECTED');
    fail++;
  } catch (err) {
    console.log(`✓ UPDATE rejected by RO: ${(err as Error).message.slice(0, 100)}`);
    pass++;
  }

  await adapter.close();
  await prisma.$disconnect();

  console.log(`\nresult: ${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
