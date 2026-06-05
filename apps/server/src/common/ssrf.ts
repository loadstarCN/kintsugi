import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * 判定一个目标 host:port 是否允许从服务器主动外连。
 *
 * 拒绝列表（IPv4）：
 *  - loopback     127.0.0.0/8
 *  - link-local   169.254.0.0/16 （含云厂商 metadata 169.254.169.254）
 *  - private      10.0.0.0/8、172.16.0.0/12、192.168.0.0/16
 *  - CGNAT        100.64.0.0/10
 *  - documentation/test 0.0.0.0/8、192.0.0.0/24、198.18.0.0/15、240.0.0.0/4
 *
 * 拒绝列表（IPv6）：
 *  - loopback ::1、link-local fe80::/10、ULA fc00::/7、unspecified ::、IPv4-mapped 形式
 *
 * Hostname：先解析 A/AAAA，所有解析结果都必须不在私网段。
 *
 * 提供 KINTSUGI_ALLOW_PRIVATE_HOSTS=true 关闭检查（仅本地开发）。
 */

/** 每次 evaluate 而不是模块加载时 freeze——测试可以临时 set + reset，
 *  生产部署 env 只在 boot 时设一次，evaluate 几次也无差。 */
function bypassEnabled(): boolean {
  return (process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'] ?? '').toLowerCase() === 'true';
}

export async function assertHostAllowed(host: string): Promise<void> {
  if (bypassEnabled()) return;
  if (!host || typeof host !== 'string') {
    throw new SsrfBlocked('host is required');
  }
  const family = isIP(host);
  if (family === 4 || family === 6) {
    if (isPrivateAddress(host, family)) {
      throw new SsrfBlocked(`host ${host} resolves to a private/reserved address`);
    }
    return;
  }
  // hostname 需要解析
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new SsrfBlocked(`host ${host} dns lookup failed: ${(err as Error).message}`);
  }
  for (const a of addrs) {
    if (isPrivateAddress(a.address, a.family)) {
      throw new SsrfBlocked(`host ${host} resolves to private address ${a.address}`);
    }
  }
}

export class SsrfBlocked extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SsrfBlocked';
  }
}

function isPrivateAddress(addr: string, family: number): boolean {
  if (family === 4) return isPrivateIPv4(addr);
  if (family === 6) return isPrivateIPv6(addr);
  return true;
}

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 解析失败按拒绝
  }
  const [a, b] = parts as [number, number, number, number];
  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local，含云 metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24（保留）
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15（benchmark）
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 multicast、240.0.0.0/4 reserved、255.255.255.255 broadcast
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped ::ffff:a.b.c.d
  const v4mapped = /^::ffff:([0-9.]+)$/i.exec(lower);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]!);
  // link-local fe80::/10
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  // ULA fc00::/7（fc00:: ~ fdff::）
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // multicast ff00::/8
  if (lower.startsWith('ff')) return true;
  return false;
}
