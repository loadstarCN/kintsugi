/**
 * DingtalkService.verifySignature 行为验证。
 *
 * 钉钉机器人 outgoing webhook 加签：
 *   stringToSign = `${timestamp}\n${secret}`
 *   sign = base64(HMAC-SHA256(secret, stringToSign))
 */

import { describe, expect, it, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { DingtalkService } from './dingtalk.service';

function fakeChats() {
  return { ask: () => Promise.resolve({ sql: '', explanation: '', data: [], rowCount: 0 }) };
}

function makeSign(secret: string, timestamp: number): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
}

describe('DingtalkService.verifySignature', () => {
  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  it('passes when timestamp + sign + secret all match within window', () => {
    const svc = new DingtalkService(fakeChats() as never);
    const ts = Date.now();
    const secret = 'SECabcdefghijklmnopqrstuvwxyz';
    const sign = makeSign(secret, ts);
    expect(svc.verifySignature(String(ts), sign, secret)).toBe(true);
  });

  it('rejects timestamp older than 5min window', () => {
    const svc = new DingtalkService(fakeChats() as never);
    const ts = Date.now() - 6 * 60_000;
    const secret = 'SECxxx';
    const sign = makeSign(secret, ts);
    expect(svc.verifySignature(String(ts), sign, secret)).toBe(false);
  });

  it('rejects forged signature with right timestamp', () => {
    const svc = new DingtalkService(fakeChats() as never);
    const ts = Date.now();
    expect(svc.verifySignature(String(ts), 'not-base64-of-anything-real', 'SECxxx')).toBe(false);
  });

  it('rejects when secret unset in production', () => {
    process.env['NODE_ENV'] = 'production';
    const svc = new DingtalkService(fakeChats() as never);
    expect(svc.verifySignature(String(Date.now()), 'whatever', undefined)).toBe(false);
  });

  it('dev 默认拒（之前 warn-passes 太危险，现在需显式 KINTSUGI_BRIDGE_DEV_BYPASS=true）', () => {
    const svc = new DingtalkService(fakeChats() as never);
    expect(svc.verifySignature(String(Date.now()), 'whatever', undefined)).toBe(false);
  });

  it('dev + KINTSUGI_BRIDGE_DEV_BYPASS=true → warn-passes', () => {
    process.env['KINTSUGI_BRIDGE_DEV_BYPASS'] = 'true';
    const svc = new DingtalkService(fakeChats() as never);
    expect(svc.verifySignature(String(Date.now()), 'whatever', undefined)).toBe(true);
    delete process.env['KINTSUGI_BRIDGE_DEV_BYPASS'];
  });

  it('rejects when timestamp missing', () => {
    const svc = new DingtalkService(fakeChats() as never);
    expect(svc.verifySignature(undefined, 'sig', 'SECxxx')).toBe(false);
  });
});
