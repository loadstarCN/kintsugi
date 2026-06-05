import { describe, expect, it, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { WecomService } from './wecom.service';

function fakeChats() {
  return { ask: () => Promise.resolve({ sql: '', explanation: '', data: [], rowCount: 0 }) };
}

function makeSig(token: string, ts: string, nonce: string, payload: string): string {
  return crypto
    .createHash('sha1')
    .update([token, ts, nonce, payload].sort().join(''))
    .digest('hex');
}

describe('WecomService.verifySignature', () => {
  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  it('passes when token + ts + nonce + payload match', () => {
    const svc = new WecomService(fakeChats() as never);
    const token = 'TOKEN-x';
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = 'n123';
    const payload = '<xml>echostr</xml>';
    const sig = makeSig(token, ts, nonce, payload);
    expect(svc.verifySignature(sig, ts, nonce, payload, token)).toBe(true);
  });

  it('rejects expired timestamp (>5min)', () => {
    const svc = new WecomService(fakeChats() as never);
    const token = 'TOKEN';
    const ts = String(Math.floor(Date.now() / 1000) - 600);
    const sig = makeSig(token, ts, 'n', 'p');
    expect(svc.verifySignature(sig, ts, 'n', 'p', token)).toBe(false);
  });

  it('rejects forged signature', () => {
    const svc = new WecomService(fakeChats() as never);
    const ts = String(Math.floor(Date.now() / 1000));
    expect(svc.verifySignature('a'.repeat(40), ts, 'n', 'p', 'TOKEN')).toBe(false);
  });

  it('production refuses when token unset', () => {
    process.env['NODE_ENV'] = 'production';
    const svc = new WecomService(fakeChats() as never);
    expect(svc.verifySignature('x', String(Date.now()), 'n', 'p', undefined)).toBe(false);
  });

  it('dev 默认拒（之前 warn-passes 太危险）', () => {
    const svc = new WecomService(fakeChats() as never);
    expect(svc.verifySignature('x', String(Date.now()), 'n', 'p', undefined)).toBe(false);
  });

  it('dev + KINTSUGI_BRIDGE_DEV_BYPASS=true → 放行', () => {
    process.env['KINTSUGI_BRIDGE_DEV_BYPASS'] = 'true';
    const svc = new WecomService(fakeChats() as never);
    expect(svc.verifySignature('x', String(Date.now()), 'n', 'p', undefined)).toBe(true);
    delete process.env['KINTSUGI_BRIDGE_DEV_BYPASS'];
  });
});
