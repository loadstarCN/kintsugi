/**
 * 诊断脚本：直接调用 db-scanner 的 introspect，打印每阶段耗时。
 * 跑法：pnpm --filter @kintsugi/server test:introspect
 *
 * 连接 config 从 env 读：DEBUG_PG_HOST / DEBUG_PG_USER / DEBUG_PG_PASSWORD
 * 或直接 DEBUG_DATABASE_URL。**不要硬编码**——历史上有过凭证泄漏。
 */
import { registerDefaultDialects, getDialect } from '@kintsugi/db-scanner';

async function main(): Promise<void> {
  registerDefaultDialects();
  const adapter = getDialect('postgres');
  console.log('connecting...');
  const t0 = Date.now();

  const host = process.env['DEBUG_PG_HOST'];
  const user = process.env['DEBUG_PG_USER'];
  const password = process.env['DEBUG_PG_PASSWORD'];
  if (!host || !user || !password) {
    throw new Error(
      'set DEBUG_PG_HOST / DEBUG_PG_USER / DEBUG_PG_PASSWORD in .env. ' +
        'Hardcoded creds are a security incident.',
    );
  }
  await adapter.connect({
    dialect: 'postgres',
    host,
    port: Number(process.env['DEBUG_PG_PORT'] ?? '5432'),
    user,
    password,
    database: process.env['DEBUG_PG_DATABASE'] ?? 'goods',
    schema: process.env['DEBUG_PG_SCHEMA'] ?? 'public',
    sslMode: process.env['DEBUG_PG_SSLMODE'] ?? 'disable',
  });
  const t1 = Date.now();
  console.log(`connected in ${t1 - t0}ms`);

  console.log('introspecting...');
  const snapshot = await adapter.introspect({ includeRowCount: true });
  const t2 = Date.now();
  console.log(`introspected in ${t2 - t1}ms`);
  console.log(`tables=${snapshot.tables.length}`);
  for (const t of snapshot.tables.slice(0, 5)) {
    console.log(
      `  ${t.name}: ${t.columns.length} cols, ${t.indexes.length} idx, ${t.foreignKeys.length} fk`,
    );
  }
  await adapter.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
