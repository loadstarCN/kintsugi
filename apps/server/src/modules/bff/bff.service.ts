import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';
import { BffRuntime, type BffContextUser } from './bff-runtime';
import { bffExecDuration } from '../../common/metrics';

export type BffScriptType = 'BEFORE_HOOK' | 'AFTER_HOOK' | 'ENDPOINT' | 'PUBLIC_FUNCTION';

export interface BffScriptPublic {
  id: string;
  appCode: string;
  scriptName: string;
  type: BffScriptType;
  boundDataset: string | null;
  version: number;
  lastSubmitter: string | null;
  lastSubmittedAt: Date;
  createdAt: Date;
}

@Injectable()
export class BffService {
  private readonly logger = new Logger(BffService.name);

  constructor(
    private readonly prisma: PrismaService,
    // BffRuntime 必须 DI 注入 —— 之前 new BffRuntime() 让 Nest 不知道这个实例，
    // 导致 OnModuleDestroy hook 永远不触发，worker pool 不回收。
    // 它自己依赖 instantApi/customSql/dsService，会被 Nest DI 串好。
    private readonly runtime: BffRuntime,
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
  ): Promise<PagedResult<BffScriptPublic>> {
    await this.assertAppOwned(appCode, tenantCode);
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const kw = pageReq.keyword?.trim();
    const where = {
      appCode,
      ...(kw ? { scriptName: { contains: kw, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.bffScript.findMany({ where, orderBy: { scriptName: 'asc' }, take, skip }),
      this.prisma.bffScript.count({ where }),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      appCode: r.appCode,
      scriptName: r.scriptName,
      type: r.type as BffScriptType,
      boundDataset: r.boundDataset,
      version: r.version,
      lastSubmitter: r.lastSubmitter,
      lastSubmittedAt: r.lastSubmittedAt,
      createdAt: r.createdAt,
    }));
    return { data, total, page, pageSize };
  }

  async getCode(
    id: string,
    tenantCode: string | null = null,
  ): Promise<{ code: string; scriptName: string; type: BffScriptType }> {
    const r = await this.prisma.bffScript.findUnique({ where: { id } });
    if (!r) throw new KintsugiError('NOT_FOUND', `BffScript ${id} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    return { code: r.code, scriptName: r.scriptName, type: r.type as BffScriptType };
  }

  async save(
    input: {
      appCode: string;
      scriptName: string;
      type: BffScriptType;
      boundDataset?: string;
      code: string;
      submitter?: string;
    },
    tenantCode: string | null = null,
  ): Promise<{ id: string; version: number }> {
    await this.assertAppOwned(input.appCode, tenantCode);
    const existing = await this.prisma.bffScript.findFirst({
      where: { appCode: input.appCode, scriptName: input.scriptName },
    });
    if (existing) {
      const r = await this.prisma.bffScript.update({
        where: { id: existing.id },
        data: {
          code: input.code,
          type: input.type,
          boundDataset: input.boundDataset ?? null,
          version: { increment: 1 },
          lastSubmitter: input.submitter ?? null,
          lastSubmittedAt: new Date(),
        },
        select: { id: true, version: true },
      });
      return r;
    }
    const created = await this.prisma.bffScript.create({
      data: {
        appCode: input.appCode,
        scriptName: input.scriptName,
        type: input.type,
        boundDataset: input.boundDataset ?? null,
        code: input.code,
        lastSubmitter: input.submitter ?? null,
      },
      select: { id: true, version: true },
    });
    return created;
  }

  async delete(
    id: string,
    tenantCode: string | null = null,
  ): Promise<{ ok: true }> {
    const r = await this.prisma.bffScript.findUnique({
      where: { id },
      select: { appCode: true },
    });
    if (!r) throw new KintsugiError('NOT_FOUND', `BffScript ${id} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    await this.prisma.bffScript.delete({ where: { id } });
    return { ok: true };
  }

  async executeEndpoint(input: {
    appCode: string;
    scriptName: string;
    payload: unknown;
    user: BffContextUser | null;
  }): Promise<unknown> {
    const script = await this.prisma.bffScript.findFirst({
      where: { appCode: input.appCode, scriptName: input.scriptName, type: 'ENDPOINT' },
    });
    if (!script) {
      throw new KintsugiError('NOT_FOUND', `BFF endpoint ${input.scriptName} not found`);
    }
    const datasets = await this.prisma.dataset.findMany({
      where: { appCode: input.appCode, isDeleted: false },
      select: { datasetCode: true, tableName: true },
    });
    const codeMap = new Map(datasets.map((d) => [d.tableName, d.datasetCode]));
    const ctx = this.runtime.buildContext(input.appCode, codeMap, input.user, input.payload);
    const labels = { app: input.appCode, scriptName: input.scriptName };
    const t0 = Date.now();
    let outcome: 'ok' | 'error' | 'timeout' = 'ok';
    try {
      return await this.runtime.run(script.code, ctx);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      outcome = /timeout|killed/i.test(msg) ? 'timeout' : 'error';
      throw err;
    } finally {
      bffExecDuration.record(Date.now() - t0, { ...labels, outcome });
    }
  }
}
