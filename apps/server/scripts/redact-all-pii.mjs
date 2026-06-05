/**
 * 批量脱敏 goods_test 里剩余表的 PII 字段。
 * 对 NOT NULL 约束的字段用空字符串 / placeholder 代替 NULL。
 */
import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;

const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
await c.connect();

async function run(sql, label) {
  try {
    const r = await c.query(sql);
    console.log(`  ✓ ${label}: ${r.rowCount ?? 0} rows`);
  } catch (err) {
    console.log(`  ✗ ${label}: ${err.message}`);
  }
}

console.log('redacting goods_test ...');

// contacts
await run(
  `UPDATE contacts SET
     name = 'Contact-' || substring(id::text, 1, 8),
     phone = '',
     email = 'contact-' || substring(id::text, 1, 8) || '@example.invalid',
     remark = ''`,
  'contacts',
);

// consultancies
await run(
  `UPDATE consultancies SET
     name = 'Consult-' || substring(id::text, 1, 8),
     email = 'consult-' || substring(id::text, 1, 8) || '@example.invalid',
     company_name = ''`,
  'consultancies',
);

// delivery_infos
await run(
  `UPDATE delivery_infos SET
     address = '',
     zip = '',
     phone = '',
     email = '',
     notes = ''`,
  'delivery_infos',
);

// notes / remark 类（自由备注） —— 注意同时处理 NOT NULL 情况
for (const t of [
  'bills',
  'invoices',
  'order_deliveries',
  'order_payments',
  'orders',
  'purchase_bills',
  'purchase_order_payments',
  'purchase_orders',
]) {
  await run(`UPDATE "${t}" SET notes = ''`, `${t}.notes`);
}
await run(`UPDATE quotes SET remark = ''`, 'quotes.remark');

// tracking_company
await run(
  `UPDATE order_deliveries SET tracking_company = ''`,
  'order_deliveries.tracking_company',
);

// registers
await run(
  `UPDATE registers SET
     name = 'Register-' || substring(id::text, 1, 8),
     company_name = '',
     ceo_name = '',
     address = '',
     email = 'register-' || substring(id::text, 1, 8) || '@example.invalid',
     website = ''`,
  'registers',
);

// subscribes
await run(
  `UPDATE subscribes SET email = 'subscribe-' || substring(id::text, 1, 8) || '@example.invalid'`,
  'subscribes.email',
);

// vendor 文件名 / 在线名
await run(
  `UPDATE vendor_quote_docs SET file_name = 'doc-' || substring(id::text, 1, 8)`,
  'vendor_quote_docs.file_name',
);
await run(
  `UPDATE vendor_raw_docs SET file_name = 'raw-' || substring(id::text, 1, 8)`,
  'vendor_raw_docs.file_name',
);
await run(
  `UPDATE vendor_quote_onlines SET name = 'Vendor-' || substring(id::text, 1, 8)`,
  'vendor_quote_onlines.name',
);

// users.username
await run(
  `UPDATE users SET username = 'user-' || substring(id::text, 1, 8)`,
  'users.username',
);

console.log('\n保留（业务字典，公开可展示）：');
console.log('  categories / countries / goods / manufacturers / originals / original_series');

await c.end();
