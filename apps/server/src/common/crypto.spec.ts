import { describe, expect, it, beforeAll } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { encrypt, decrypt, ciphertextVersion, _resetKeyCacheForTests, validateEncryptionKeyAtStartup } from './crypto';

/** 复刻 v0 编码（旧固定 salt，无 version byte）—— 用来验证 v1 decrypt 能向后兼容。 */
function encryptV0Legacy(plaintext: string, secret: string): string {
  const key = scryptSync(secret, 'kintsugi-salt', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

describe('crypto encrypt/decrypt', () => {
  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = 'test-encryption-key-32-bytes-min-XXXXXX';
    _resetKeyCacheForTests();
  });

  it('round-trips an arbitrary string', () => {
    const plain = 'hello-world-中文-!@#$%^&*()';
    const ct = encrypt(plain);
    expect(ct).not.toBe(plain);
    expect(decrypt(ct)).toBe(plain);
  });

  it('produces different ciphertext each time (IV is random)', () => {
    const plain = 'same-input';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it('rejects tampered ciphertext via auth tag', () => {
    const ct = encrypt('secret');
    const buf = Buffer.from(ct, 'base64');
    // 翻转 ciphertext 区域的最后一个字节
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws when no key is configured', () => {
    const old = process.env['ENCRYPTION_KEY'];
    const oldS = process.env['SESSION_SECRET'];
    delete process.env['ENCRYPTION_KEY'];
    delete process.env['SESSION_SECRET'];
    try {
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY or SESSION_SECRET/);
    } finally {
      if (old !== undefined) process.env['ENCRYPTION_KEY'] = old;
      if (oldS !== undefined) process.env['SESSION_SECRET'] = oldS;
    }
  });

  it('encrypt produces v1 (leading 0x01)', () => {
    const ct = encrypt('hello');
    expect(ciphertextVersion(ct)).toBe(1);
    const buf = Buffer.from(ct, 'base64');
    expect(buf[0]).toBe(0x01);
    expect(buf[1]).toBe(16); // saltLen
  });

  it('two encrypts of same plaintext use distinct salts (random per record)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    const aBuf = Buffer.from(a, 'base64');
    const bBuf = Buffer.from(b, 'base64');
    const saltA = aBuf.subarray(2, 18).toString('hex');
    const saltB = bBuf.subarray(2, 18).toString('hex');
    expect(saltA).not.toBe(saltB);
  });

  it('decrypts legacy v0 ciphertext (fallback path)', () => {
    const v0 = encryptV0Legacy('legacy-secret-data', process.env['ENCRYPTION_KEY']!);
    expect(ciphertextVersion(v0)).toBe(0);
    expect(decrypt(v0)).toBe('legacy-secret-data');
  });

  it('rejects v1 ciphertext with corrupted salt header', () => {
    const ct = encrypt('payload');
    const buf = Buffer.from(ct, 'base64');
    // 把 saltLen 改成不合理的 0
    buf[1] = 0;
    expect(() => decrypt(buf.toString('base64'))).toThrow(/saltLen/);
  });

  it('rejects v1 ciphertext truncated below header size', () => {
    const tiny = Buffer.from([0x01, 0x10, 0, 0, 0]).toString('base64');
    expect(() => decrypt(tiny)).toThrow(/truncated/);
  });

  it('startup-validate: prod 漏配 ENCRYPTION_KEY → 抛', () => {
    const prevEnc = process.env['ENCRYPTION_KEY'];
    const prevNode = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      delete process.env['ENCRYPTION_KEY'];
      expect(() => validateEncryptionKeyAtStartup()).toThrow(/required in production/);
    } finally {
      if (prevEnc !== undefined) process.env['ENCRYPTION_KEY'] = prevEnc;
      if (prevNode !== undefined) process.env['NODE_ENV'] = prevNode;
      else delete process.env['NODE_ENV'];
    }
  });

  it('startup-validate: prod 太短 → 抛 with length info', () => {
    const prevEnc = process.env['ENCRYPTION_KEY'];
    const prevNode = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      process.env['ENCRYPTION_KEY'] = 'tooShort';
      expect(() => validateEncryptionKeyAtStartup()).toThrow(/too short.*8/);
    } finally {
      if (prevEnc !== undefined) process.env['ENCRYPTION_KEY'] = prevEnc;
      else delete process.env['ENCRYPTION_KEY'];
      if (prevNode !== undefined) process.env['NODE_ENV'] = prevNode;
      else delete process.env['NODE_ENV'];
    }
  });

  it('startup-validate: prod ≥32 字节 → 不抛', () => {
    const prevEnc = process.env['ENCRYPTION_KEY'];
    const prevNode = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
      expect(() => validateEncryptionKeyAtStartup()).not.toThrow();
    } finally {
      if (prevEnc !== undefined) process.env['ENCRYPTION_KEY'] = prevEnc;
      else delete process.env['ENCRYPTION_KEY'];
      if (prevNode !== undefined) process.env['NODE_ENV'] = prevNode;
      else delete process.env['NODE_ENV'];
    }
  });

  it('startup-validate: 非 prod 太短 → warn 不抛', () => {
    const prevEnc = process.env['ENCRYPTION_KEY'];
    const prevNode = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'development';
      process.env['ENCRYPTION_KEY'] = 'short';
      const warns: string[] = [];
      expect(() => validateEncryptionKeyAtStartup({ warn: (m) => warns.push(m) })).not.toThrow();
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0]).toMatch(/only 5 chars/);
    } finally {
      if (prevEnc !== undefined) process.env['ENCRYPTION_KEY'] = prevEnc;
      else delete process.env['ENCRYPTION_KEY'];
      if (prevNode !== undefined) process.env['NODE_ENV'] = prevNode;
      else delete process.env['NODE_ENV'];
    }
  });

  it('falls back to v0 when v0 IV happens to start with 0x01 (1/256 collision)', () => {
    // 手工构造一个 IV[0]=0x01 的 v0 ciphertext，验证 decrypt 走 fallback。
    const secret = process.env['ENCRYPTION_KEY']!;
    const key = scryptSync(secret, 'kintsugi-salt', 32);
    const iv = Buffer.concat([Buffer.from([0x01]), randomBytes(11)]);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update('manual', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const v0WithLeading01 = Buffer.concat([iv, tag, enc]).toString('base64');
    expect(decrypt(v0WithLeading01)).toBe('manual');
  });
});
