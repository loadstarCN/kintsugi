import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * AES-256-GCM 加密 / 解密敏感字符串（DataSource 密码、AccessKey 明文等）。
 *
 * Master key 来源（按优先级）：
 *   1. ENCRYPTION_KEY（推荐 —— 独立的高熵 env var）
 *   2. SESSION_SECRET（兼容；旧部署可能用同一个）
 *
 * KDF：scrypt(secret, salt, 32)。
 *
 * Ciphertext 格式（两个版本共存，以 base64 解码后首字节区分）：
 *
 *   v0（legacy）：iv(12) || authTag(16) || enc
 *      固定 salt = "kintsugi-salt" 串（历史遗留）。
 *      Decrypt-only —— 永远不会再产出 v0。
 *
 *   v1（current）：0x01 || saltLen(1) || salt(saltLen) || iv(12) || authTag(16) || enc
 *      saltLen 当前固定 16，但写明长度便于将来变。
 *      每条记录独立随机 salt，rainbow-table 攻击不实用。
 *      key = scrypt(secret, salt, 32)，按 (secret, salt) 缓存最近 256 条避免重复计算。
 *
 * 迁移路径：旧 v0 数据照样能 decrypt（v0 fallback）；下次该字段被业务流程
 * encrypt 写回时自动升级到 v1。无需停机批量 re-encrypt（可选后台 job 加速）。
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN_V1 = 16;
const VERSION_V1 = 0x01;
const LEGACY_SALT_V0 = 'kintsugi-salt';

const KEY_CACHE = new Map<string, Buffer>();
const KEY_CACHE_CAP = 256;

function deriveKey(secret: string, salt: Buffer | string): Buffer {
  const saltKey = typeof salt === 'string' ? salt : salt.toString('hex');
  const cacheKey = `${secret}:${saltKey}`;
  const cached = KEY_CACHE.get(cacheKey);
  if (cached) return cached;
  const k = scryptSync(secret, salt, 32);
  if (KEY_CACHE.size >= KEY_CACHE_CAP) {
    // 简单 LRU-ish：删第一个（Map 保留插入序）
    const firstKey = KEY_CACHE.keys().next().value as string | undefined;
    if (firstKey) KEY_CACHE.delete(firstKey);
  }
  KEY_CACHE.set(cacheKey, k);
  return k;
}

function getMasterSecret(): string {
  const secret = process.env['ENCRYPTION_KEY'] ?? process.env['SESSION_SECRET'] ?? '';
  if (!secret) {
    throw new Error('ENCRYPTION_KEY or SESSION_SECRET must be set');
  }
  return secret;
}

const ENC_KEY_MIN_BYTES = 32;

/**
 * 启动时强制校验 ENCRYPTION_KEY 强度。漏配在 boot fail-fast，
 * 而不是第一次 encrypt/decrypt 才崩。
 *
 * 生产规则：
 *   · 必须设 ENCRYPTION_KEY（SESSION_SECRET fallback 在生产视为漏配）
 *   · 长度 ≥ 32 字节；推荐 64 hex（openssl rand -hex 32）
 *
 * 非生产：缺失或太短只 warn，仍走 SESSION_SECRET fallback 不阻塞 dev。
 */
export function validateEncryptionKeyAtStartup(logger?: { warn: (m: string) => void }): void {
  const enc = process.env['ENCRYPTION_KEY'];
  const sess = process.env['SESSION_SECRET'];
  const isProd = process.env['NODE_ENV'] === 'production';

  if (isProd) {
    if (!enc || enc.length === 0) {
      throw new Error(
        'ENCRYPTION_KEY is required in production. Generate with `openssl rand -hex 32` ' +
          '(64 hex chars). 丢失即全部加密数据无法解密 —— 部署前妥善保管。',
      );
    }
    if (enc.length < ENC_KEY_MIN_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY too short: got ${enc.length} chars, need ≥${ENC_KEY_MIN_BYTES}. ` +
          'Generate with `openssl rand -hex 32`.',
      );
    }
    return;
  }

  // 非生产
  const used = enc ?? sess ?? '';
  if (!used) {
    (logger ?? console).warn(
      '[crypto] neither ENCRYPTION_KEY nor SESSION_SECRET set; encrypt/decrypt will throw at first use.',
    );
    return;
  }
  if (used.length < ENC_KEY_MIN_BYTES) {
    (logger ?? console).warn(
      `[crypto] master secret only ${used.length} chars (<${ENC_KEY_MIN_BYTES}); ` +
        'using anyway since NODE_ENV != production.',
    );
  }
}

export function encrypt(plaintext: string): string {
  const secret = getMasterSecret();
  const salt = randomBytes(SALT_LEN_V1);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 0x01 || saltLen || salt || iv || tag || enc
  const out = Buffer.concat([
    Buffer.from([VERSION_V1, SALT_LEN_V1]),
    salt,
    iv,
    tag,
    enc,
  ]);
  return out.toString('base64');
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const secret = getMasterSecret();

  // v1：首字节 0x01 + 第二字节 saltLen
  // 注意：v0 数据的首字节是随机 IV[0]，1/256 概率撞上 0x01。所以走 v1 失败时
  //      要 fallback 到 v0；GCM auth tag 保证错路不会"恰好成功解出乱码"。
  if (buf.length > 0 && buf[0] === VERSION_V1) {
    try {
      return decryptV1(buf, secret);
    } catch (err) {
      // 真 v1 破损 → v0 也破，最终仍抛
      // 撞 0x01 的 v0 → v0 解成功，吞下 v1 的错
      try {
        return decryptV0(buf, secret);
      } catch {
        throw err;
      }
    }
  }

  return decryptV0(buf, secret);
}

function decryptV1(buf: Buffer, secret: string): string {
  const saltLen = buf[1] ?? 0;
  if (saltLen <= 0 || saltLen > 64) throw new Error('crypto: invalid v1 saltLen');
  const headerEnd = 2 + saltLen;
  if (buf.length < headerEnd + IV_LEN + TAG_LEN) throw new Error('crypto: v1 truncated');
  const salt = buf.subarray(2, headerEnd);
  const iv = buf.subarray(headerEnd, headerEnd + IV_LEN);
  const tag = buf.subarray(headerEnd + IV_LEN, headerEnd + IV_LEN + TAG_LEN);
  const data = buf.subarray(headerEnd + IV_LEN + TAG_LEN);
  const key = deriveKey(secret, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function decryptV0(buf: Buffer, secret: string): string {
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('crypto: blob too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(secret, LEGACY_SALT_V0);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** 调试 / 迁移用：判断一条 ciphertext 是 v0 还是 v1。 */
export function ciphertextVersion(blob: string): 0 | 1 | 'unknown' {
  try {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length === 0) return 'unknown';
    if (buf[0] === VERSION_V1) return 1;
    // v0 没有 magic byte，但首字节是 IV 起始，理论上等于 0x01 的概率 1/256
    // —— 误判靠不上单字节，但 v1 总是先 try，正确解出来就赢。这里只做粗判。
    if (buf.length >= IV_LEN + TAG_LEN) return 0;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 测试用：清缓存。 */
export function _resetKeyCacheForTests(): void {
  KEY_CACHE.clear();
}
