import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { assertHostAllowed, SsrfBlocked } from './ssrf';

describe('assertHostAllowed', () => {
  beforeEach(() => {
    delete process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'];
  });
  afterEach(() => {
    delete process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'];
  });

  it('rejects loopback IPv4', async () => {
    await expect(assertHostAllowed('127.0.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('127.5.6.7')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects link-local incl. cloud metadata 169.254.169.254', async () => {
    await expect(assertHostAllowed('169.254.169.254')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('169.254.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertHostAllowed('10.0.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('172.16.5.5')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('172.31.255.255')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('192.168.1.1')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects CGNAT 100.64/10', async () => {
    await expect(assertHostAllowed('100.64.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('100.127.255.255')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects 0.0.0.0/8 + multicast/reserved', async () => {
    await expect(assertHostAllowed('0.0.0.0')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('224.0.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('255.255.255.255')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects loopback + link-local IPv6', async () => {
    await expect(assertHostAllowed('::1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('fe80::1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('fc00::1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('::')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('rejects IPv4-mapped IPv6 of private addr', async () => {
    await expect(assertHostAllowed('::ffff:127.0.0.1')).rejects.toBeInstanceOf(SsrfBlocked);
    await expect(assertHostAllowed('::ffff:169.254.169.254')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('accepts public IPv4 (8.8.8.8)', async () => {
    await expect(assertHostAllowed('8.8.8.8')).resolves.toBeUndefined();
  });

  it('rejects empty / non-string host', async () => {
    await expect(assertHostAllowed('')).rejects.toBeInstanceOf(SsrfBlocked);
  });

  it('KINTSUGI_ALLOW_PRIVATE_HOSTS=true bypasses the check', async () => {
    process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'] = 'true';
    await expect(assertHostAllowed('127.0.0.1')).resolves.toBeUndefined();
    await expect(assertHostAllowed('169.254.169.254')).resolves.toBeUndefined();
  });

  it('hostname that does not resolve → SsrfBlocked (DNS lookup error)', async () => {
    await expect(
      assertHostAllowed('this-host-does-not-exist.invalid'),
    ).rejects.toBeInstanceOf(SsrfBlocked);
  });
});
