import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmProvider, LlmResponse } from '@kintsugi/llm';
import type { SchemaSnapshot } from '@kintsugi/db-scanner';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER } from '../../llm/llm.module';
import { DataSourceService } from '../datasource/datasource.service';
import {
  SEMANTIC_ANALYSIS_SYSTEM,
  buildSemanticAnalysisUserMessage,
  filterCandidatesForChunk,
  mergeSemanticResults,
  slimSampleRows,
  type SemanticAnalysisNeighborTable,
  type SemanticAnalysisResult,
  type SemanticAnalysisSchemaInput,
  type SemanticAnalysisTable,
} from './prompts';
import { findRelationCandidates, type RelationCandidate } from './relation-candidates';

/**
 * DBAgent 服务 — 核心职责：
 *  1. 指挥 DataSourceService 打开连接
 *  2. introspect 拿到 SchemaSnapshot
 *  3. （可选）抽样几行
 *  4. **分批**喂给 LLM 做语义 + 关系推断；单批失败不中断整体
 *  5. 合并结果并持续更新 ScanJob
 */
@Injectable()
export class DbAgentService {
  private readonly logger = new Logger(DbAgentService.name);

  /** 每个 LLM 调用承担的表数。默认 6 —— 在 DeepSeek 上经验值 prompt 体积可控、单次 30–60s 完成。 */
  private readonly chunkSize = Number(process.env['LLM_CHUNK_SIZE'] ?? 6);
  /** 单次 LLM 请求的硬超时。 */
  private readonly perCallTimeoutMs = Number(process.env['LLM_PER_CALL_TIMEOUT_MS'] ?? 90_000);
  /** 单批失败时的重试次数（首次失败后再试 N 次）。 */
  private readonly perCallRetries = Number(process.env['LLM_PER_CALL_RETRIES'] ?? 1);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dsService: DataSourceService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** 触发一次扫描：完整走完 introspect + LLM 分析，落 ScanJob 记录。 */
  async scan(
    dataSourceId: string,
    opts: { sampleRowsPerTable?: number } = {},
    tenantCode: string | null = null,
  ): Promise<string> {
    await this.dsService.findOwned(dataSourceId, tenantCode);
    const job = await this.prisma.scanJob.create({
      data: { dataSourceId, status: 'scanning' },
      select: { id: true },
    });

    // 异步执行；调用方拿到 jobId 后通过另一个接口轮询。
    void this.runScan(job.id, dataSourceId, opts).catch(async (err: unknown) => {
      this.logger.error(`scan ${job.id} failed`, err as Error);
      await this.prisma.scanJob
        .update({
          where: { id: job.id },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: (err as Error).message,
          },
        })
        .catch(() => undefined);
      await this.prisma.dataSource
        .update({
          where: { id: dataSourceId },
          data: { lastScanAt: new Date(), lastScanStatus: 'failed' },
        })
        .catch(() => undefined);
    });

    return job.id;
  }

  private async runScan(
    jobId: string,
    dataSourceId: string,
    opts: { sampleRowsPerTable?: number },
  ): Promise<void> {
    const adapter = await this.dsService.openAdapter(dataSourceId);
    try {
      const snapshot = await adapter.introspect({
        includeRowCount: true,
        sampleRows: !!opts.sampleRowsPerTable,
        sampleSize: opts.sampleRowsPerTable ?? 0,
      });
      this.logger.log(`introspect ${dataSourceId} -> ${snapshot.tables.length} tables`);

      const candidates = findRelationCandidates(snapshot);
      const topCandidates = candidates.filter((c) => c.heuristicScore >= 0.5).slice(0, 200);

      // 先把结构化结果落盘；LLM 失败也不丢扫描产出。
      await this.prisma.scanJob.update({
        where: { id: jobId },
        data: {
          rawSnapshot: snapshot as unknown as object,
          inferredModel: { ruleCandidates: candidates } as unknown as object,
        },
      });

      const sampleSize = opts.sampleRowsPerTable ?? 0;
      const samples: Record<string, Array<Record<string, unknown>>> = {};
      if (sampleSize > 0) {
        const PER_TABLE_TIMEOUT_MS = Number(
          process.env['DBAGENT_SAMPLE_TIMEOUT_MS'] ?? 8_000,
        );
        for (const t of snapshot.tables.slice(0, 50)) {
          try {
            // 单表超时：避免一张大表 sampleTable 慢死把整次扫描卡到天荒地老
            const s = await raceWithTimeout(
              adapter.sampleTable(t.schema, t.name, sampleSize),
              PER_TABLE_TIMEOUT_MS,
              `sampleTable(${t.name}) timeout`,
            );
            samples[t.name] = s.rows;
          } catch (err) {
            this.logger.warn(`sample skipped for ${t.name}: ${(err as Error).message}`);
          }
        }
      }

      const merged = await this.runChunkedSemanticAnalysis({
        jobId,
        snapshot,
        samples,
        candidates,
        topCandidates,
      });

      await this.prisma.scanJob.update({
        where: { id: jobId },
        data: {
          status: 'succeeded',
          finishedAt: new Date(),
          inferredModel: {
            ...merged.parsed,
            ruleCandidates: candidates,
            llmChunkStats: merged.stats,
          } as unknown as object,
          tokensUsed: merged.totalTokens ?? null,
          errorMessage: merged.partialErrors.length
            ? `LLM 部分批次失败（其他已合并）：\n- ${merged.partialErrors.join('\n- ')}`
            : null,
        },
      });

      await this.prisma.dataSource.update({
        where: { id: dataSourceId },
        data: { lastScanAt: new Date(), lastScanStatus: 'succeeded' },
      });
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }

  /**
   * 按 chunkSize 把表分成若干批，每批单独调用 LLM；
   * 支持超时 + 重试 + 跳过失败批（保留规则候选），阶段性回写 ScanJob 以便前端轮询时能看到进度。
   */
  private async runChunkedSemanticAnalysis(args: {
    jobId: string;
    snapshot: SchemaSnapshot;
    samples: Record<string, Array<Record<string, unknown>>>;
    candidates: RelationCandidate[];
    topCandidates: RelationCandidate[];
  }): Promise<{
    parsed: SemanticAnalysisResult;
    totalTokens: number | null;
    partialErrors: string[];
    stats: Array<{ batch: number; tables: number; status: 'ok' | 'failed'; tokensUsed?: number; error?: string }>;
  }> {
    const { jobId, snapshot, samples, topCandidates, candidates } = args;
    const chunks = chunk(snapshot.tables, Math.max(1, this.chunkSize));
    this.logger.log(
      `LLM semantic analysis: ${snapshot.tables.length} tables in ${chunks.length} chunks (size=${this.chunkSize})`,
    );

    const parts: SemanticAnalysisResult[] = [];
    const partialErrors: string[] = [];
    const stats: Array<{
      batch: number;
      tables: number;
      status: 'ok' | 'failed';
      tokensUsed?: number;
      error?: string;
    }> = [];
    let totalTokens = 0;
    let anyUsage = false;

    const tableByName = new Map(snapshot.tables.map((t) => [t.name, t]));

    for (let i = 0; i < chunks.length; i++) {
      const chunkTables = chunks[i]!;
      const chunkTableNames = chunkTables.map((t) => t.name);
      const inChunk = new Set(chunkTableNames);
      const llmTables: SemanticAnalysisTable[] = chunkTables.map((t) => toLlmTable(t, samples));
      const relCands = filterCandidatesForChunk(topCandidates, chunkTableNames);

      // 收集本批候选里引用到、但不在本批的表名 → 瘦身成 neighborTables
      const neighborNames = new Set<string>();
      for (const c of relCands) {
        if (!inChunk.has(c.fromTable)) neighborNames.add(c.fromTable);
        if (!inChunk.has(c.toTable)) neighborNames.add(c.toTable);
      }
      const neighborTables: SemanticAnalysisNeighborTable[] = [];
      for (const name of neighborNames) {
        const src = tableByName.get(name);
        if (!src) continue;
        neighborTables.push(toNeighborTable(src));
      }

      const input: SemanticAnalysisSchemaInput = {
        dialect: snapshot.dialect,
        database: snapshot.database,
        tables: llmTables,
        relationCandidates: relCands,
        ...(neighborTables.length ? { neighborTables } : {}),
      };

      this.logger.log(
        `  chunk ${i + 1}/${chunks.length}: ${chunkTableNames.length} tables, ${relCands.length} candidates, ${neighborTables.length} neighbors`,
      );

      try {
        const { parsed, usage } = await this.callLlmWithRetry(input);
        parts.push(parsed);
        if (usage?.totalTokens != null) {
          totalTokens += usage.totalTokens;
          anyUsage = true;
        }
        stats.push({
          batch: i + 1,
          tables: chunkTableNames.length,
          status: 'ok',
          ...(usage?.totalTokens != null ? { tokensUsed: usage.totalTokens } : {}),
        });
      } catch (err) {
        const msg = `chunk ${i + 1} (${chunkTableNames.slice(0, 3).join(',')}${chunkTableNames.length > 3 ? '…' : ''}): ${(err as Error).message}`;
        this.logger.error(msg);
        partialErrors.push(msg);
        stats.push({
          batch: i + 1,
          tables: chunkTableNames.length,
          status: 'failed',
          error: (err as Error).message,
        });
      }

      // 每批结束都更新 inferredModel，便于前端轮询看到 LLM 逐步完成的结果。
      const mergedSoFar = mergeSemanticResults(parts);
      await this.prisma.scanJob
        .update({
          where: { id: jobId },
          data: {
            inferredModel: {
              ...mergedSoFar,
              ruleCandidates: candidates,
              llmChunkStats: stats,
            } as unknown as object,
            tokensUsed: anyUsage ? totalTokens : null,
          },
        })
        .catch((e) =>
          this.logger.warn(`persist partial chunk ${i + 1} failed: ${(e as Error).message}`),
        );
    }

    return {
      parsed: mergeSemanticResults(parts),
      totalTokens: anyUsage ? totalTokens : null,
      partialErrors,
      stats,
    };
  }

  private async callLlmWithRetry(
    input: SemanticAnalysisSchemaInput,
  ): Promise<{ parsed: SemanticAnalysisResult; usage?: LlmResponse['usage'] }> {
    let attempt = 0;
    const maxAttempts = 1 + Math.max(0, this.perCallRetries);
    let lastErr: Error | undefined;
    while (attempt < maxAttempts) {
      attempt++;
      try {
        return await this.runLlmSemanticAnalysis(input);
      } catch (err) {
        lastErr = err as Error;
        const retriable = isRetriableError(lastErr);
        this.logger.warn(
          `LLM call attempt ${attempt}/${maxAttempts} failed${retriable ? ' (retriable)' : ''}: ${lastErr.message}`,
        );
        if (!retriable) break;
      }
    }
    throw lastErr ?? new Error('LLM call failed with unknown error');
  }

  private async runLlmSemanticAnalysis(
    input: SemanticAnalysisSchemaInput,
  ): Promise<{ parsed: SemanticAnalysisResult; usage?: LlmResponse['usage'] }> {
    const resp = await this.llm.complete({
      responseFormatJson: true,
      temperature: 0,
      timeoutMs: this.perCallTimeoutMs,
      messages: [
        { role: 'system', content: SEMANTIC_ANALYSIS_SYSTEM },
        { role: 'user', content: buildSemanticAnalysisUserMessage(input) },
      ],
    });

    const parsed = this.safeParseJson<SemanticAnalysisResult>(resp.content);
    const result: { parsed: SemanticAnalysisResult; usage?: LlmResponse['usage'] } = { parsed };
    if (resp.usage) result.usage = resp.usage;
    return result;
  }

  private safeParseJson<T>(raw: string): T {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try {
      return JSON.parse(trimmed) as T;
    } catch (err) {
      throw new Error(
        `LLM returned non-JSON response (len=${trimmed.length}): ${(err as Error).message}`,
      );
    }
  }

  async getJob(jobId: string, tenantCode: string | null = null): Promise<unknown> {
    const job = await this.prisma.scanJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        dataSourceId: true,
      },
    });
    if (!job) throw new KintsugiError('NOT_FOUND', `ScanJob ${jobId} not found`);
    // 把 dataSource 归属交给 DataSourceService.findOwned —— 跨租户伪装成 NOT_FOUND
    await this.dsService.findOwned(job.dataSourceId, tenantCode);
    return this.prisma.scanJob.findUnique({ where: { id: jobId } });
  }

  /**
   * 增量 sync：触发新扫描；**不再阻塞**等结果。
   * 返回 { jobId, priorJobId } —— 调用方拿 jobId 去轮询 GET /jobs/:jobId 直至 succeeded，
   * 再用 GET /sync/diff?currentJobId=&priorJobId= 拿结构化 diff。
   *
   * 之前 `sync()` 内部 3s 轮 prisma 持续 20min，把一个 HTTP worker 钉死，单租户就能拖整个 server。
   */
  async sync(
    dataSourceId: string,
    tenantCode: string | null = null,
  ): Promise<{ jobId: string; priorJobId: string | null }> {
    await this.dsService.findOwned(dataSourceId, tenantCode);
    const prior = await this.prisma.scanJob.findFirst({
      where: { dataSourceId, status: 'succeeded' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    });
    const jobId = await this.scan(dataSourceId, { sampleRowsPerTable: 0 }, tenantCode);
    return { jobId, priorJobId: prior?.id ?? null };
  }

  /**
   * 给定一个已 succeeded 的当前 job 与（可选的）prior job，算 schema diff。
   * 调用方需保证 currentJobId 已 succeeded（否则返回 status='not-ready'，不抛错）。
   * priorJobId=null 表示首次 sync —— 整库都是 addedTables。
   */
  async getSyncDiff(
    currentJobId: string,
    priorJobId: string | null,
    tenantCode: string | null = null,
  ): Promise<
    | {
        status: 'ready';
        diff: {
          addedTables: string[];
          removedTables: string[];
          modifiedTables: Array<{
            table: string;
            addedColumns: string[];
            removedColumns: string[];
            changedColumns: Array<{ column: string; before: unknown; after: unknown }>;
          }>;
        };
      }
    | { status: 'not-ready'; jobStatus: string }
  > {
    const cur = await this.prisma.scanJob.findUnique({ where: { id: currentJobId } });
    if (!cur) throw new KintsugiError('NOT_FOUND', `ScanJob ${currentJobId} not found`);
    // 用 DataSourceService.findOwned 做归属校验 —— 跨租户 / 不存在都伪装 NOT_FOUND
    await this.dsService.findOwned(cur.dataSourceId, tenantCode);

    if (cur.status !== 'succeeded' || !cur.rawSnapshot) {
      return { status: 'not-ready', jobStatus: cur.status };
    }

    const next = cur.rawSnapshot as unknown as import('@kintsugi/db-scanner').SchemaSnapshot;
    if (!priorJobId) {
      return {
        status: 'ready',
        diff: {
          addedTables: next.tables.map((t) => t.name),
          removedTables: [],
          modifiedTables: [],
        },
      };
    }

    const prior = await this.prisma.scanJob.findUnique({ where: { id: priorJobId } });
    if (!prior?.rawSnapshot) {
      return {
        status: 'ready',
        diff: {
          addedTables: next.tables.map((t) => t.name),
          removedTables: [],
          modifiedTables: [],
        },
      };
    }
    // 同 dataSource 校验
    if (prior.dataSourceId !== cur.dataSourceId) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        'priorJobId and currentJobId belong to different datasources',
      );
    }
    const prev = prior.rawSnapshot as unknown as import('@kintsugi/db-scanner').SchemaSnapshot;
    const { diffSnapshots } = await import('./schema-diff');
    return { status: 'ready', diff: diffSnapshots(prev, next) };
  }

  /** 列最近扫描任务（默认 50 条，按开始时间倒序）。不返回 rawSnapshot / inferredModel，仅元信息。 */
  async listJobsForDataSource(
    dataSourceId: string,
    pageReq: { page?: number; pageSize?: number } = {},
    tenantCode: string | null = null,
  ): Promise<{
    data: Array<{
      id: string;
      status: string;
      startedAt: Date;
      finishedAt: Date | null;
      tokensUsed: number | null;
      errorMessage: string | null;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    await this.dsService.findOwned(dataSourceId, tenantCode);
    const page = Math.max(1, pageReq.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, pageReq.pageSize ?? 50));
    const where = { dataSourceId };
    const select = {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      tokensUsed: true,
      errorMessage: true,
    };
    const [data, total] = await Promise.all([
      this.prisma.scanJob.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select,
      }),
      this.prisma.scanJob.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }
}

function chunk<T>(arr: ReadonlyArray<T>, size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNeighborTable(t: SchemaSnapshot['tables'][number]): SemanticAnalysisNeighborTable {
  const pkCols = t.columns
    .filter((c) => c.primaryKeyOrder !== undefined)
    .sort((a, b) => (a.primaryKeyOrder ?? 0) - (b.primaryKeyOrder ?? 0))
    .map((c) => ({ name: c.name, nativeType: c.nativeType }));

  // 没有显式 PK 时退化成把第一列当作主键线索（至少让 LLM 能看到有列）
  if (pkCols.length === 0 && t.columns[0]) {
    pkCols.push({ name: t.columns[0].name, nativeType: t.columns[0].nativeType });
  }

  const neighbor: SemanticAnalysisNeighborTable = {
    name: t.name,
    primaryKeyColumns: pkCols,
  };
  if (t.comment) neighbor.comment = t.comment;
  return neighbor;
}

function toLlmTable(
  t: SchemaSnapshot['tables'][number],
  samples: Record<string, Array<Record<string, unknown>>>,
): SemanticAnalysisTable {
  const tableEntry: SemanticAnalysisTable = {
    name: t.name,
    columns: t.columns.map((c) => {
      const col: SemanticAnalysisTable['columns'][number] = {
        name: c.name,
        nativeType: c.nativeType,
        logicalType: c.logicalType,
        nullable: c.nullable,
        isAutoIncrement: c.isAutoIncrement,
      };
      if (c.primaryKeyOrder !== undefined) col.primaryKeyOrder = c.primaryKeyOrder;
      if (c.enumValues) col.enumValues = c.enumValues.slice(0, 12); // enum 过多时截取
      if (c.comment) col.comment = c.comment;
      return col;
    }),
    foreignKeys: t.foreignKeys.map((fk) => ({
      columns: fk.columns,
      referencedTable: fk.referencedTable,
      referencedColumns: fk.referencedColumns,
    })),
  };
  if (t.comment) tableEntry.comment = t.comment;
  const rows = slimSampleRows(samples[t.name]);
  if (rows) tableEntry.sampleRows = rows;
  return tableEntry;
}

function raceWithTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
  ]);
}

function isRetriableError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    err.name === 'AbortError' ||
    msg.includes('abort') ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('econnreset') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('429')
  );
}
