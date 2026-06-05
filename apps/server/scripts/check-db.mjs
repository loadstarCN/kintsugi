import pg from 'pg';
import { pgCredsFromEnv } from './_pg-creds.mjs';
const { Client } = pg;
const c = new Client(pgCredsFromEnv({ database: 'postgres' }));
await c.connect();
const r = await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'goods%' ORDER BY datname");
console.log(r.rows.map((x) => x.datname));
await c.end();
