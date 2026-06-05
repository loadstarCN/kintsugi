/**
 * 调试脚本共享的 PG 连接 config。
 *
 * **不要硬编码凭证**——之前 7 个 mjs/ts 脚本都把 user/password 写死，
 * 凡 git clone 仓库的人都拿到 RDS 凭据。已 rotate；此 helper 强制走 env。
 *
 * 用法：
 *   import { pgCredsFromEnv } from './_pg-creds.mjs';
 *   const c = new Client(pgCredsFromEnv({ database: 'goods_test' }));
 */

export function pgCredsFromEnv(overrides = {}) {
  const url = process.env.METADATA_DATABASE_URL ?? process.env.DEBUG_DATABASE_URL;
  if (url) {
    return { connectionString: url, ...overrides };
  }
  const { DEBUG_PG_HOST, DEBUG_PG_PORT, DEBUG_PG_USER, DEBUG_PG_PASSWORD } = process.env;
  if (!DEBUG_PG_HOST || !DEBUG_PG_USER || !DEBUG_PG_PASSWORD) {
    throw new Error(
      'pgCredsFromEnv: set METADATA_DATABASE_URL or DEBUG_DATABASE_URL in .env, ' +
        'or DEBUG_PG_{HOST,PORT,USER,PASSWORD}. Hardcoded creds are a security incident.',
    );
  }
  return {
    host: DEBUG_PG_HOST,
    port: Number(DEBUG_PG_PORT ?? '5432'),
    user: DEBUG_PG_USER,
    password: DEBUG_PG_PASSWORD,
    database: 'postgres',
    ...overrides,
  };
}
