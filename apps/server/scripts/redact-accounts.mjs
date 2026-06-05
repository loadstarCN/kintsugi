import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;

const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
await c.connect();

const before = await c.query(`
  SELECT count(*) as n,
         count(*) FILTER (WHERE company_name IS NOT NULL) as has_company,
         count(*) FILTER (WHERE email IS NOT NULL) as has_email,
         count(*) FILTER (WHERE phone IS NOT NULL) as has_phone,
         count(*) FILTER (WHERE address IS NOT NULL) as has_address
  FROM accounts
`);
console.log('before:', before.rows[0]);

// 脱敏：保留 id / type / created_at / modfied_at / user_id 结构；
// name 用 "Account-<id 前8位>" 规则化；其他 PII 一律 NULL。
const r = await c.query(`
  UPDATE accounts SET
    name = 'Account-' || substring(id::text, 1, 8),
    company_name = NULL,
    address = NULL,
    zip = NULL,
    email = NULL,
    website = NULL,
    phone = NULL,
    fax = NULL,
    remark = NULL,
    image = NULL
`);
console.log('updated rows:', r.rowCount);

const sample = await c.query(`SELECT id, type, name, company_name, email, phone FROM accounts LIMIT 5`);
console.log('sample after:');
for (const row of sample.rows) console.log(' ', row);

await c.end();
