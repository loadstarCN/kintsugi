import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;
const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
await c.connect();
const PII = /(name|email|phone|fax|mobile|address|zip|website|remark|company|owner|user_id|comment|notes?|description|account|id_card|passport|password|salt|hash|token|secret|key|sign|wechat|qq|telegram|whatsapp|skype|line)/i;

const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' ORDER BY table_name`);

for (const { table_name } of tables.rows) {
  const cnt = (await c.query(`SELECT count(*)::int as n FROM "${table_name}"`)).rows[0].n;
  const cols = await c.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table_name]);
  const sus = cols.rows.filter(c => PII.test(c.column_name) && !/^id$|user_id|created|modfied|modified/i.test(c.column_name));
  if (sus.length > 0) {
    console.log(`\n=== ${table_name} (${cnt} rows) ===`);
    for (const s of sus) console.log(`  ${s.column_name} (${s.data_type})`);
  }
}
await c.end();
