import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;
const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
await c.connect();
const t = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' ORDER BY table_name
`);
console.log('tables:', t.rows.length);
for (const r of t.rows.slice(0, 50)) console.log('  ', r.table_name);
// 抽一个最重要的
try {
  const g = await c.query('SELECT count(*) FROM goods');
  console.log('goods count:', g.rows[0].count);
} catch (e) {
  console.log('goods 查询失败:', e.message);
}
await c.end();
