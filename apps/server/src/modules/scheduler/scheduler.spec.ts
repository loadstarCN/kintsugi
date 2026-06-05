import 'reflect-metadata';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SchedulerService } from './scheduler.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WebhookService } from '../webhook/webhook.service';
import type { MailService } from '../mail/mail.service';

interface FakePrisma {
  accessKey: { findMany: ReturnType<typeof vi.fn> };
  auditLog: { deleteMany: ReturnType<typeof vi.fn> };
  tenant: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
}

function makeService(): { svc: SchedulerService; prisma: FakePrisma; mail: { sendTemplate: ReturnType<typeof vi.fn> } } {
  const prisma: FakePrisma = {
    accessKey: { findMany: vi.fn(async () => []) },
    auditLog: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    tenant: {
      // 默认 trial-notify 扫到空：scheduler 测试关心的不是 trial-notify 路径，
      // 而是 audit-purge / inactive-user / expiring-key；mock 成空就行
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    $queryRawUnsafe: vi.fn(async () => [{ count: 0n }]),
  };
  const webhook = { retryPending: vi.fn(async () => ({ retried: 0, deadLettered: 0 })) };
  const mail = { sendTemplate: vi.fn(async () => null) };
  const svc = new SchedulerService(
    prisma as unknown as PrismaService,
    webhook as unknown as WebhookService,
    mail as unknown as MailService,
  );
  return { svc, prisma, mail };
}

describe('SchedulerService.purgeOldAuditLog', () => {
  beforeEach(() => {
    delete process.env['AUDIT_RETENTION_DAYS'];
  });
  afterEach(() => {
    delete process.env['AUDIT_RETENTION_DAYS'];
  });

  it('skips entirely when AUDIT_RETENTION_DAYS=0', async () => {
    process.env['AUDIT_RETENTION_DAYS'] = '0';
    const { svc, prisma } = makeService();
    const r = await (svc as unknown as { purgeOldAuditLog: () => Promise<number> }).purgeOldAuditLog();
    expect(r).toBe(0);
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('default 365 days: deletes rows with createdAt < cutoff', async () => {
    const { svc, prisma } = makeService();
    prisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 17 });
    const r = await (svc as unknown as { purgeOldAuditLog: () => Promise<number> }).purgeOldAuditLog();
    expect(r).toBe(17);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
    const arg = prisma.auditLog.deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } };
    const cutoff = arg.where.createdAt.lt;
    const expected = Date.now() - 365 * 86400_000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it('honors AUDIT_RETENTION_DAYS env override', async () => {
    process.env['AUDIT_RETENTION_DAYS'] = '30';
    const { svc, prisma } = makeService();
    prisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 3 });
    await (svc as unknown as { purgeOldAuditLog: () => Promise<number> }).purgeOldAuditLog();
    const arg = prisma.auditLog.deleteMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } };
    const cutoff = arg.where.createdAt.lt;
    const expected = Date.now() - 30 * 86400_000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it('skips when env is non-numeric (treated as disabled)', async () => {
    process.env['AUDIT_RETENTION_DAYS'] = 'forever';
    const { svc, prisma } = makeService();
    const r = await (svc as unknown as { purgeOldAuditLog: () => Promise<number> }).purgeOldAuditLog();
    expect(r).toBe(0);
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 0 silently when nothing to delete (no error logged)', async () => {
    const { svc, prisma } = makeService();
    const r = await (svc as unknown as { purgeOldAuditLog: () => Promise<number> }).purgeOldAuditLog();
    expect(r).toBe(0);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalled();
  });
});
