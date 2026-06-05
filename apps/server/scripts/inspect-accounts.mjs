import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;
const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
await c.connect();
const cols = await c.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='accounts' ORDER BY ordinal_position
`);
console.log('accounts columns:');
for (const r of cols.rows) console.log(' ', r.column_name, r.data_type);
console.log();
const sample = await c.query(`SELECT * FROM accounts LIMIT 3`);
console.log('sample rows:');
for (const r of sample.rows) console.log(JSON.stringify(r, null, 2));
console.log();
const cnt = await c.query(`SELECT count(*) FROM accounts`);
console.log('total:', cnt.rows[0].count);
await c.end();
