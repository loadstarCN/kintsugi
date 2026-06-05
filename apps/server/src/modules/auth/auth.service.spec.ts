/**
 * AuthService.login —— 失败计数 + user-level lockout 行为。
 *
 * 不连真 DB；mock Prisma 的几个用到的方法。bcrypt 真跑（hash + compare）—— 慢但不需要 DB。
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { KintsugiError } from '@kintsugi/shared';

interface UserRow {
  id: string;
  tenantCode: string;
  username: string;
  passwordHash: string;
  failedLoginCount: number;
  lastFailedLoginAt: Date | null;
  lockedUntil: Date | null;
}

interface MockPrisma {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  tenant: { findUnique: ReturnType<typeof vi.fn> };
  jwtRevocation: { findUnique: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  _state: { user: UserRow };
}

function makePrisma(
  userOverrides: Partial<UserRow> = {},
  tenantOverrides: { edition?: string; trialExpiresAt?: Date | null } = {},
): MockPrisma {
  const passwordHash = bcrypt.hashSync('correct-password', 4); // low cost for test speed
  const user: UserRow = {
    id: 'u1',
    tenantCode: 't1',
    username: 'alice',
    passwordHash,
    failedLoginCount: 0,
    lastFailedLoginAt: null,
    lockedUntil: null,
    ...userOverrides,
  };
  return {
    user: {
      findFirst: vi.fn().mockImplementation(async () => ({ ...user })),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === user.id ? { ...user } : null,
      ),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<UserRow> & { failedLoginCount?: number | { increment: number } } }) => {
          if (where.id !== user.id) throw new Error('not found');
          const d = data as Record<string, unknown>;
          if (d['failedLoginCount'] != null) {
            const v = d['failedLoginCount'];
            user.failedLoginCount =
              typeof v === 'object' && v !== null && 'increment' in v
                ? user.failedLoginCount + (v as { increment: number }).increment
                : (v as number);
          }
          if ('lastFailedLoginAt' in d) user.lastFailedLoginAt = d['lastFailedLoginAt'] as Date | null;
          if ('lockedUntil' in d) user.lockedUntil = d['lockedUntil'] as Date | null;
          return { ...user };
        },
      ),
      updateMany: vi.fn().mockImplementation(
        async ({ where, data }: {
          where: { id: string; lastFailedLoginAt?: { gt: Date }; OR?: Array<{ lockedUntil: null | { lt: Date } }> };
          data: Partial<UserRow> & { failedLoginCount?: number | { increment: number } };
        }) => {
          if (where.id !== user.id) return { count: 0 };
          if (where.lastFailedLoginAt?.gt) {
            if (!user.lastFailedLoginAt || user.lastFailedLoginAt <= where.lastFailedLoginAt.gt) {
              return { count: 0 };
            }
          }
          if (where.OR) {
            // {lockedUntil:null} | {lockedUntil:{lt:now}}
            const now = (where.OR.find((c) => c.lockedUntil && typeof c.lockedUntil === 'object') as { lockedUntil: { lt: Date } } | undefined)?.lockedUntil?.lt;
            const passes =
              user.lockedUntil === null || (now && user.lockedUntil < now);
            if (!passes) return { count: 0 };
          }
          const d = data as Record<string, unknown>;
          if (d['failedLoginCount'] != null) {
            const v = d['failedLoginCount'];
            user.failedLoginCount =
              typeof v === 'object' && v !== null && 'increment' in v
                ? user.failedLoginCount + (v as { increment: number }).increment
                : (v as number);
          }
          if ('lastFailedLoginAt' in d) user.lastFailedLoginAt = d['lastFailedLoginAt'] as Date | null;
          if ('lockedUntil' in d) user.lockedUntil = d['lockedUntil'] as Date | null;
          return { count: 1 };
        },
      ),
    },
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        edition: tenantOverrides.edition ?? 'PRO',
        trialExpiresAt: tenantOverrides.trialExpiresAt ?? null,
      }),
    },
    jwtRevocation: {
      findUnique: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    _state: { user },
  };
}

describe('AuthService.login lock behavior', () => {
  beforeEach(() => {
    process.env['JWT_SECRET'] = 'test-secret-32-bytes-min-XXXXXX';
    process.env['LOGIN_FAIL_MAX'] = '3'; // 测试用更小阈值
    process.env['LOGIN_FAIL_WINDOW_MS'] = '900000';
    process.env['LOGIN_LOCK_MS'] = '900000';
  });

  it('correct password resets failure counter', async () => {
    const prisma = makePrisma({ failedLoginCount: 2, lastFailedLoginAt: new Date() });
    const svc = new AuthService(prisma as never);
    await svc.login({ tenantCode: 't1', username: 'alice', password: 'correct-password' });
    expect(prisma._state.user.failedLoginCount).toBe(0);
    expect(prisma._state.user.lastFailedLoginAt).toBeNull();
    expect(prisma._state.user.lockedUntil).toBeNull();
  });

  it('wrong password increments counter (within window)', async () => {
    const recent = new Date(Date.now() - 60_000); // 1 min ago
    const prisma = makePrisma({ failedLoginCount: 1, lastFailedLoginAt: recent });
    const svc = new AuthService(prisma as never);
    await expect(
      svc.login({ tenantCode: 't1', username: 'alice', password: 'wrong' }),
    ).rejects.toThrow(KintsugiError);
    expect(prisma._state.user.failedLoginCount).toBe(2);
  });

  it('wrong password resets to 1 when previous attempt was outside window', async () => {
    const old = new Date(Date.now() - 86_400_000); // 24h ago
    const prisma = makePrisma({ failedLoginCount: 99, lastFailedLoginAt: old });
    const svc = new AuthService(prisma as never);
    await expect(
      svc.login({ tenantCode: 't1', username: 'alice', password: 'wrong' }),
    ).rejects.toThrow(KintsugiError);
    expect(prisma._state.user.failedLoginCount).toBe(1);
  });

  it('hits lockout when count reaches threshold', async () => {
    const recent = new Date(Date.now() - 60_000);
    const prisma = makePrisma({ failedLoginCount: 2, lastFailedLoginAt: recent });
    const svc = new AuthService(prisma as never);
    await expect(
      svc.login({ tenantCode: 't1', username: 'alice', password: 'wrong' }),
    ).rejects.toThrow(KintsugiError);
    expect(prisma._state.user.failedLoginCount).toBe(3);
    expect(prisma._state.user.lockedUntil).toBeInstanceOf(Date);
  });

  it('concurrent failed logins still trigger lockout (atomic increment)', async () => {
    // 用同一个 prisma + state，多个并发 login 失败应让 count 单调累加
    const recent = new Date(Date.now() - 60_000);
    const prisma = makePrisma({ failedLoginCount: 0, lastFailedLoginAt: recent });
    const svc = new AuthService(prisma as never);
    await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        svc.login({ tenantCode: 't1', username: 'alice', password: 'wrong' }),
      ),
    );
    // 4 次失败都应被记到（不被 snapshot 覆盖）
    expect(prisma._state.user.failedLoginCount).toBeGreaterThanOrEqual(3);
    expect(prisma._state.user.lockedUntil).toBeInstanceOf(Date);
  });

  it('locked user is rejected even with correct password', async () => {
    const future = new Date(Date.now() + 60_000);
    const prisma = makePrisma({ lockedUntil: future });
    const svc = new AuthService(prisma as never);
    await expect(
      svc.login({ tenantCode: 't1', username: 'alice', password: 'correct-password' }),
    ).rejects.toThrow(/locked.*retry in/);
  });

  it('expired lock allows login again', async () => {
    const past = new Date(Date.now() - 60_000);
    const prisma = makePrisma({ lockedUntil: past });
    const svc = new AuthService(prisma as never);
    const r = await svc.login({
      tenantCode: 't1',
      username: 'alice',
      password: 'correct-password',
    });
    expect(r.token).toBeTruthy();
  });
});
