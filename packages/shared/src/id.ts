import { randomBytes } from 'node:crypto';
import type { AppCode, DatasetCode, SqlCode } from './brand';

const HEX_ALPHABET = '0123456789abcdef';
const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Cryptographically random string of `len` chars from the given alphabet. */
export function randomString(len: number, alphabet = LOWER_ALNUM): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b === undefined) throw new Error('randomBytes short read');
    out += alphabet[b % alphabet.length];
  }
  return out;
}

/** `app-xxxxxxxx` — 8 hex chars, matches the source product's format. */
export function newAppCode(): AppCode {
  return `app-${randomString(8, HEX_ALPHABET)}` as AppCode;
}

/** 32-char lowercase alphanumeric — matches source product Dataset code shape. */
export function newDatasetCode(): DatasetCode {
  return randomString(32, LOWER_ALNUM) as DatasetCode;
}

/** `xxxxx-xxxxx` — two 5-char lowercase alphanumeric groups, matches source SqlCode shape. */
export function newSqlCode(): SqlCode {
  return `${randomString(5, LOWER_ALNUM)}-${randomString(5, LOWER_ALNUM)}` as SqlCode;
}
