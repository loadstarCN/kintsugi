import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QuotaService } from './quota.service';
import { KintsugiError } from '@kintsugi/shared';

interface MockPrisma {
  tenant: { findUnique: ReturnType<typeof vi.fn> };
  dataSource: { count: ReturnType<typeof vi.fn> };
  dataset: { count: ReturnType<typeof vi.fn> };
}

function makePrisma(opts: {
  tenantLimits?: Partial<{ maxDataSources: number | null; maxDatasets: number | null; maxDailyLlmCalls: number | null }>;
  dataSourceCount?: number;
  datasetCount?: number;
}): MockPrisma {
  return {
    tenant: {
      findUnique: vi.fn().mockResolvedValue({
        maxDataSources: opts.tenantLimits?.maxDataSources ?? null,
        maxDatasets: opts.tenantLimits?.maxDatasets ?? null,
        maxDailyLlmCalls: opts.tenantLimits?.maxDailyLlmCalls ?? null,
      }),
    },
    dataSource: { count: vi.fn().mockResolvedValue(opts.dataSourceCount ?? 0) },
    dataset: { count: vi.fn().mockResolvedValue(opts.datasetCount ?? 0) },
  };
}

describe('QuotaService', () => {
  beforeEach(() => {
    delete process.env['QUOTA_DEFAULT_MAX_DATASOURCES'];
    delete process.env['QUOTA_DEFAULT_MAX_DATASETS'];
  });

  it('allows DataSource create when under env default (50)', async () => {
    const svc = new QuotaService(makePrisma({ dataSourceCount: 49 }) as never);
    await expect(svc.assertCanCreateDataSource('t1')).resolves.toBeUndefined();
  });

  it('refuses DataSource create when at env default cap', async () => {
    const svc = new QuotaService(makePrisma({ dataSourceCount: 50 }) as never);
    await expect(svc.assertCanCreateDataSource('t1')).rejects.toThrow(KintsugiError);
  });

  it('tenant column overrides env default', async () => {
    process.env['QUOTA_DEFAULT_MAX_DATASOURCES'] = '5';
    const svc = new QuotaService(
      makePrisma({ tenantLimits: { maxDataSources: 100 }, dataSourceCount: 10 }) as never,
    );
    // env says 5, but tenant column says 100; tenant wins → 10 < 100 → ok
    await expect(svc.assertCanCreateDataSource('t1')).resolves.toBeUndefined();
  });

  it('tenant column null + env=unlimited → no limit', async () => {
    process.env['QUOTA_DEFAULT_MAX_DATASOURCES'] = 'unlimited';
    const svc = new QuotaService(makePrisma({ dataSourceCount: 9999 }) as never);
    await expect(svc.assertCanCreateDataSource('t1')).resolves.toBeUndefined();
  });

  it('Dataset bulk create respects (existing + additional) > limit', async () => {
    const svc = new QuotaService(
      makePrisma({ tenantLimits: { maxDatasets: 100 }, datasetCount: 95 }) as never,
    );
    await expect(svc.assertCanCreateDatasets('t1', 3)).resolves.toBeUndefined();
    await expect(svc.assertCanCreateDatasets('t1', 6)).rejects.toThrow(KintsugiError);
  });
});
