import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';
import type { SchemaSnapshot } from '@kintsugi/db-scanner';
import { buildDoJsonForTable } from './do-builder';
import type { DoJson } from './do';
import { emitRlsPolicy, type RlsEmitResult } from '../instant-api/rls-policy';
import { QuotaService } from '../tenant/quota.service';
import { WebhookService } from '../webhook/webhook.service';

export interface DatasetSummary {
  datasetCode: string;
  appCode: string;
  dataSourceId: string;
  tableName: string;
  alias: string;
  version: number;
  updatedAt: Date;
}

@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly webhook: WebhookService,
  ) {}

  /** appCode 归属 tenant 校验（tenantCode=null 走 accessKey，已被 TenantGuard 卡死 appCode）。 */
  private async assertAppOwned(appCode: string, tenantCode: string | null): Promise<void> {
    if (tenantCode === null) return;
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: { tenantCode: true },
    });
    if (!app || app.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    }
  }

  async list(
    appCode: string,
    pageReq: PageRequest = {},
    tenantCode: string | null = null,
  ): Promise<PagedResult<DatasetSummary>> {
    await this.assertAppOwned(appCode, tenantCode);
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const kw = pageReq.keyword?.trim().toLowerCase();
    const where = {
      appCode,
      isDeleted: false,
      ...(kw
        ? {
            OR: [
              { tableName: { contains: kw, mode: 'insensitive' as const } },
              { alias: { contains: kw } },
            ],
          }
        : {}),
    };
    const select = {
      datasetCode: true,
      appCode: true,
      dataSourceId: true,
      tableName: true,
      alias: true,
      version: true,
      updatedAt: true,
    };
    const [data, total] = await Promise.all([
      this.prisma.dataset.findMany({ where, orderBy: { tableName: 'asc' }, take, skip, select }),
      this.prisma.dataset.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async get(
    datasetCode: string,
    tenantCode: string | null = null,
  ): Promise<{
    datasetCode: string;
    appCode: string;
    dataSourceId: string;
    tableName: string;
    alias: string;
    schemaName: string | null;
    version: number;
    doJson: DoJson;
    updatedAt: Date;
  }> {
    const ds = await this.prisma.dataset.findUnique({
      where: { datasetCode },
    });
    if (!ds || ds.isDeleted) {
      throw new KintsugiError('NOT_FOUND', `Dataset ${datasetCode} not found`);
    }
    await this.assertAppOwned(ds.appCode, tenantCode);
    return {
      datasetCode: ds.datasetCode,
      appCode: ds.appCode,
      dataSourceId: ds.dataSourceId,
      tableName: ds.tableName,
      alias: ds.alias,
      schemaName: ds.schemaName,
      version: ds.version,
      doJson: ds.doJson as unknown as DoJson,
      updatedAt: ds.updatedAt,
    };
  }

  /**
   * 更新 DO JSON，版本 +1；未来可以引入"协作冲突"blocked: true 机制。
   */
  async updateDoJson(
    datasetCode: string,
    doJson: DoJson,
    lastModifiedBy?: string,
    tenantCode: string | null = null,
    expectedVersion?: number,
  ): Promise<{ version: number }> {
    const before = await this.prisma.dataset.findUnique({ where: { datasetCode } });
    if (!before) throw new KintsugiError('NOT_FOUND', `Dataset ${datasetCode} not found`);
    await this.assertAppOwned(before.appCode, tenantCode);

    // 乐观锁：客户端传 expectedVersion → conditional update。
    // 若 DB 中 version 已 ≠ expected（别人改过了），update where 不命中，Prisma 抛 P2025；
    // 翻成 BLOCKED_BY_CONCURRENT_EDIT 让 UI 提示"先 reload"。
    if (expectedVersion !== undefined) {
      try {
        const updated = await this.prisma.dataset.update({
          where: { datasetCode, version: expectedVersion },
          data: {
            doJson: doJson as unknown as object,
            alias: doJson.alias,
            version: { increment: 1 },
            lastModifiedBy: lastModifiedBy ?? null,
          },
          select: { version: true },
        });
        void this.webhook.dispatch(before.appCode, 'dataset.updated', {
          datasetCode,
          version: updated.version,
          alias: doJson.alias,
        });
        return updated;
      } catch (err) {
        if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025') {
          throw new KintsugiError(
            'BLOCKED_BY_CONCURRENT_EDIT',
            `Dataset ${datasetCode} was modified by another session (current v${before.version} ≠ expected v${expectedVersion}); reload and retry`,
            { current: before.version, expected: expectedVersion },
          );
        }
        throw err;
      }
    }

    // 兼容老调用：没传 expectedVersion —— 老路径，静默覆盖。日志一条便于追溯。
    this.logger.warn(
      `updateDoJson on ${datasetCode} without expectedVersion (concurrent-edit unprotected; deprecated)`,
    );
    const updated = await this.prisma.dataset.update({
      where: { datasetCode },
      data: {
        doJson: doJson as unknown as object,
        alias: doJson.alias,
        version: { increment: 1 },
        lastModifiedBy: lastModifiedBy ?? null,
      },
      select: { version: true },
    });
    void this.webhook.dispatch(before.appCode, 'dataset.updated', {
      datasetCode,
      version: updated.version,
      alias: doJson.alias,
    });
    return updated;
  }

  /**
   * 输出当前 dataset 对应业务表的 PG RLS policy SQL。
   * 仅供 PG 方言；其他 dialect 抛 VALIDATION_FAILED。
   * 返回的是建议 SQL；DBA 自行评估后执行（不替用户跑 DDL）。
   */
  async getRlsPolicy(
    datasetCode: string,
    tenantCode: string | null = null,
  ): Promise<RlsEmitResult & { dialect: string; table: string; schema: string | null }> {
    const ds = await this.prisma.dataset.findUnique({
      where: { datasetCode },
      include: { dataSource: { select: { dialect: true } } },
    });
    if (!ds || ds.isDeleted) {
      throw new KintsugiError('NOT_FOUND', `Dataset ${datasetCode} not found`);
    }
    await this.assertAppOwned(ds.appCode, tenantCode);
    if (ds.dataSource.dialect !== 'postgres') {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `RLS policy emitter only supports PostgreSQL; dataset is ${ds.dataSource.dialect}`,
      );
    }
    const result = emitRlsPolicy({
      table: ds.tableName,
      schema: ds.schemaName,
      doJson: ds.doJson as unknown as DoJson,
    });
    return { ...result, dialect: ds.dataSource.dialect, table: ds.tableName, schema: ds.schemaName };
  }

  async softDelete(
    datasetCode: string,
    tenantCode: string | null = null,
  ): Promise<{ ok: true }> {
    const before = await this.prisma.dataset.findUnique({
      where: { datasetCode },
      select: { appCode: true },
    });
    if (!before) throw new KintsugiError('NOT_FOUND', `Dataset ${datasetCode} not found`);
    await this.assertAppOwned(before.appCode, tenantCode);
    await this.prisma.dataset.update({
      where: { datasetCode },
      data: { isDeleted: true },
    });
    void this.webhook.dispatch(before.appCode, 'dataset.deleted', { datasetCode });
    return { ok: true };
  }

  /**
   * 从一次扫描结果批量生成 Dataset。每张表一条记录；幂等：已存在则按 (appCode, dataSourceId, tableName) upsert。
   * 只处理 include 列表里的表；include 为空 = 全量。
   */
  async ingestFromScan(
    args: {
      jobId: string;
      appCode: string;
      include?: string[];
    },
    tenantCode: string | null = null,
  ): Promise<{
    created: number;
    updated: number;
    datasets: Array<{ datasetCode: string; tableName: string; alias: string }>;
  }> {
    await this.assertAppOwned(args.appCode, tenantCode);
    const job = await this.prisma.scanJob.findUnique({ where: { id: args.jobId } });
    if (!job) throw new KintsugiError('NOT_FOUND', `ScanJob ${args.jobId} not found`);
    // job 的 dataSource 也要在本租户内（防 jobId 跨租户漂移）
    if (tenantCode !== null) {
      const ds = await this.prisma.dataSource.findUnique({
        where: { id: job.dataSourceId },
        select: { application: { select: { tenantCode: true } } },
      });
      if (!ds || ds.application.tenantCode !== tenantCode) {
        throw new KintsugiError('NOT_FOUND', `ScanJob ${args.jobId} not found`);
      }
    }
    if (job.status !== 'succeeded' && job.status !== 'failed') {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `ScanJob ${args.jobId} is still ${job.status}; wait until finished`,
      );
    }
    const snapshot = job.rawSnapshot as unknown as SchemaSnapshot | null;
    if (!snapshot) throw new KintsugiError('VALIDATION_FAILED', 'scan has no snapshot');
    const inferred = (job.inferredModel as unknown) ?? {};

    const app = await this.prisma.application.findUnique({ where: { appCode: args.appCode } });
    if (!app) throw new KintsugiError('NOT_FOUND', `Application ${args.appCode} not found`);

    const dataSourceId = job.dataSourceId;
    const includeSet = args.include?.length ? new Set(args.include) : null;

    const existing = await this.prisma.dataset.findMany({
      where: { appCode: args.appCode, dataSourceId },
      select: { datasetCode: true, tableName: true },
    });
    const existingByTable = new Map(existing.map((e) => [e.tableName, e.datasetCode]));

    // 配额检查：估算这次 ingest 会新建多少 dataset（snapshot.tables 减去已存在的）
    if (tenantCode !== null) {
      const wouldBeNew = snapshot.tables.filter((t) => {
        if (includeSet && !includeSet.has(t.name)) return false;
        return !existingByTable.has(t.name);
      }).length;
      if (wouldBeNew > 0) {
        await this.quota.assertCanCreateDatasets(tenantCode, wouldBeNew);
      }
    }

    let created = 0;
    let updated = 0;
    const produced: Array<{ datasetCode: string; tableName: string; alias: string }> = [];

    for (const table of snapshot.tables) {
      if (includeSet && !includeSet.has(table.name)) continue;
      const doJson = buildDoJsonForTable(table, inferred as Parameters<typeof buildDoJsonForTable>[1]);
      const existingCode = existingByTable.get(table.name);
      if (existingCode) {
        await this.prisma.dataset.update({
          where: { datasetCode: existingCode },
          data: {
            alias: doJson.alias,
            doJson: doJson as unknown as object,
            version: { increment: 1 },
            isDeleted: false,
            schemaName: table.schema ?? null,
          },
        });
        updated++;
        produced.push({ datasetCode: existingCode, tableName: table.name, alias: doJson.alias });
      } else {
        const datasetCode = generateDatasetCode();
        await this.prisma.dataset.create({
          data: {
            datasetCode,
            appCode: args.appCode,
            dataSourceId,
            schemaName: table.schema ?? null,
            tableName: table.name,
            alias: doJson.alias,
            doJson: doJson as unknown as object,
            version: 1,
          },
        });
        created++;
        produced.push({ datasetCode, tableName: table.name, alias: doJson.alias });
      }
    }

    this.logger.log(
      `ingest scan ${args.jobId} → app=${args.appCode}: created=${created} updated=${updated}`,
    );
    if (created > 0 || updated > 0) {
      // 一次 ingest 一发，含批量信息；订阅方按 datasetCode 列表反查感兴趣的子集
      void this.webhook.dispatch(args.appCode, 'dataset.created', {
        jobId: args.jobId,
        created,
        updated,
        datasets: produced,
      });
    }
    return { created, updated, datasets: produced };
  }
}

/** 32 字符 datasetCode："ds" 前缀 + 30 字符 base36 随机；用 crypto.randomBytes 生成。 */
function generateDatasetCode(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const buf = crypto.randomBytes(30);
  let rand = 'ds';
  for (let i = 0; i < 30; i++) rand += alphabet[buf[i]! % alphabet.length];
  return rand;
}
