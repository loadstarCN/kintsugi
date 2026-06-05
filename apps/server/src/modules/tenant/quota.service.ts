import { Injectable } from '@nestjs/common';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 租户硬配额。每条规则两档来源：
 *  1. Tenant 表上的列（人工 / 计费系统设置；优先）
 *  2. 环境变量默认（运营级硬上限）
 *
 * null = 不限。
 *
 * 当前覆盖：
 *  - DataSource 数（QUOTA_DEFAULT_MAX_DATASOURCES，env 默认 50）
 *  - Dataset 数（QUOTA_DEFAULT_MAX_DATASETS，env 默认 1000）
 *
 * 未来：每天 LLM 调用总数（QUOTA_DEFAULT_MAX_DAILY_LLM）—— 已在 schema，gateway 接 TODO。
 */
@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanCreateDataSource(tenantCode: string): Promise<void> {
    const limit = await this.resolveLimit(tenantCode, 'maxDataSources', 'QUOTA_DEFAULT_MAX_DATASOURCES', 50);
    if (limit === null) return;
    const count = await this.prisma.dataSource.count({
      where: { application: { tenantCode } },
    });
    if (count >= limit) {
      throw new KintsugiError(
        'QUOTA_EXCEEDED',
        `tenant ${tenantCode} reached DataSource limit (${count}/${limit})`,
        { resource: 'dataSource', count, limit },
      );
    }
  }

  async assertCanCreateDatasets(tenantCode: string, additionalCount: number): Promise<void> {
    const limit = await this.resolveLimit(tenantCode, 'maxDatasets', 'QUOTA_DEFAULT_MAX_DATASETS', 1000);
    if (limit === null) return;
    const existing = await this.prisma.dataset.count({
      where: { application: { tenantCode }, isDeleted: false },
    });
    if (existing + additionalCount > limit) {
      throw new KintsugiError(
        'QUOTA_EXCEEDED',
        `tenant ${tenantCode} would exceed Dataset limit (${existing} + ${additionalCount} > ${limit})`,
        { resource: 'dataset', existing, additionalCount, limit },
      );
    }
  }

  /** Tenant 列优先；列为 null 时退到 env；env 缺失退到 hardcoded default。
   *  hardcoded default 也可以是 Infinity 表示"不限"。 */
  private async resolveLimit(
    tenantCode: string,
    column: 'maxDataSources' | 'maxDatasets' | 'maxDailyLlmCalls',
    envKey: string,
    fallback: number | null,
  ): Promise<number | null> {
    const t = await this.prisma.tenant.findUnique({
      where: { tenantCode },
      select: {
        maxDataSources: true,
        maxDatasets: true,
        maxDailyLlmCalls: true,
      },
    });
    if (t?.[column] != null) return t[column] as number;
    const envVal = process.env[envKey];
    if (envVal === '0' || envVal?.toLowerCase() === 'unlimited' || envVal?.toLowerCase() === 'none') {
      return null;
    }
    if (envVal && Number.isFinite(Number(envVal))) return Number(envVal);
    return fallback;
  }
}
