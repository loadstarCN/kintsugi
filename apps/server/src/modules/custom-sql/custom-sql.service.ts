import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { DialectAdapter } from '@kintsugi/db-scanner';
import { PrismaService } from '../../prisma/prisma.service';
import { DataSourceService } from '../datasource/datasource.service';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CustomSqlPublic {
  sqlCode: string;
  appCode: string;
  dataSourceId: string;
  sqlName: string;
  content: string;
  paramsSchema: unknown;
  lastSubmitter: string | null;
  lastSubmittedAt: Date;
  createdAt: Date;
}

/** 禁止执行的高危 SQL 关键字。AI Agent 一律不得执行；人类必须 X-Confirm-Risk 才能执行 critical。 */
const BLOCKED_BY_AI = /\b(drop|truncate|delete|alter|create\s+table|grant|revoke)\b/i;
const REQUIRES_HUMAN_CONFIRM = /\b(drop|truncate|alter)\b/i;

@Injectable()
export class CustomSqlService {
  private readonly logger = new Logger(CustomSqlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ds: DataSourceService,
  ) {}

  /** appCode 归属 tenant 校验（tenantCode=null 走 accessKey，已被 TenantGuard 卡死 appCode）。*/
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
  ): Promise<PagedResult<CustomSqlPublic>> {
    await this.assertAppOwned(appCode, tenantCode);
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const kw = pageReq.keyword?.trim();
    const where = {
      appCode,
      ...(kw ? { sqlName: { contains: kw, mode: 'insensitive' as const } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.customSql.findMany({ where, orderBy: { lastSubmittedAt: 'desc' }, take, skip }),
      this.prisma.customSql.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async get(sqlCode: string, tenantCode: string | null = null): Promise<CustomSqlPublic> {
    const r = await this.prisma.customSql.findUnique({ where: { sqlCode } });
    if (!r) throw new KintsugiError('NOT_FOUND', `Custom SQL ${sqlCode} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    return r;
  }

  async save(
    input: {
      appCode: string;
      dataSourceId: string;
      sqlName: string;
      content: string;
      paramsSchema?: unknown;
      submitter?: string;
    },
    tenantCode: string | null = null,
  ): Promise<{ sqlCode: string; riskLevel: RiskLevel }> {
    await this.assertAppOwned(input.appCode, tenantCode);
    // dataSourceId 也要在本租户内
    await this.ds.findOwned(input.dataSourceId, tenantCode);
    const riskLevel = classifyRisk(input.content);
    const sqlCode = generateSqlCode();
    await this.prisma.customSql.create({
      data: {
        sqlCode,
        appCode: input.appCode,
        dataSourceId: input.dataSourceId,
        sqlName: input.sqlName,
        content: input.content,
        paramsSchema: (input.paramsSchema ?? undefined) as object | undefined,
        lastSubmitter: input.submitter ?? null,
      },
    });
    return { sqlCode, riskLevel };
  }

  async update(
    sqlCode: string,
    patch: Partial<{ content: string; sqlName: string; paramsSchema: unknown; submitter: string }>,
    tenantCode: string | null = null,
  ): Promise<{ ok: true; riskLevel: RiskLevel }> {
    const current = await this.get(sqlCode, tenantCode);
    const content = patch.content ?? current.content;
    const riskLevel = classifyRisk(content);
    await this.prisma.customSql.update({
      where: { sqlCode },
      data: {
        sqlName: patch.sqlName ?? current.sqlName,
        content,
        paramsSchema: ((patch.paramsSchema ?? current.paramsSchema) ?? undefined) as object | undefined,
        lastSubmitter: patch.submitter ?? current.lastSubmitter,
        lastSubmittedAt: new Date(),
      },
    });
    return { ok: true, riskLevel };
  }

  /** validate：不执行，只做语法 + 风险等级评估 */
  validate(content: string): { riskLevel: RiskLevel; placeholders: string[] } {
    return {
      riskLevel: classifyRisk(content),
      placeholders: extractPlaceholders(content),
    };
  }

  /**
   * 解析 sqlCode → dataSourceId（不开 adapter，给 BFF tx 状态机用来校验跨库）
   */
  async resolveDataSourceId(sqlCode: string): Promise<string> {
    const r = await this.prisma.customSql.findUnique({
      where: { sqlCode },
      select: { dataSourceId: true },
    });
    if (!r) throw new KintsugiError('NOT_FOUND', `Custom SQL ${sqlCode} not found`);
    return r.dataSourceId;
  }

  /** 执行。actor: 'human' 允许 medium；'ai' 只允许 low。
   *  txAdapter：BFF tx 期间主进程传入，跳过自己的 open/close，复用事务连接。
   *  注意：txAdapter 提供时不再走 readonly 事务（已经在外层 BEGIN 里）。
   */
  async execute(
    sqlCode: string,
    params: Record<string, unknown>,
    opts: {
      actor: 'human' | 'ai';
      sqlSafe?: boolean;
      adapter?: DialectAdapter;
      tenantCode?: string | null;
      /** 用于 PG RLS GUC 注入；非 PG 方言会被忽略。 */
      userId?: string | null;
      deptIds?: string[];
    } = { actor: 'human' },
  ): Promise<{ data: unknown; error?: string; rowCount: number; riskLevel: RiskLevel }> {
    const sql = await this.get(sqlCode, opts.tenantCode ?? null);
    const risk = classifyRisk(sql.content);

    if (opts.actor === 'ai' && BLOCKED_BY_AI.test(sql.content)) {
      const err = `AI actor cannot execute ${risk} SQL (contains blocked keyword)`;
      if (opts.sqlSafe) return { data: null, error: err, rowCount: 0, riskLevel: risk };
      throw new KintsugiError('FORBIDDEN', err);
    }
    if (risk === 'critical' && opts.actor !== 'human') {
      const err = `critical SQL requires human actor`;
      if (opts.sqlSafe) return { data: null, error: err, rowCount: 0, riskLevel: risk };
      throw new KintsugiError('FORBIDDEN', err);
    }

    // tx 模式（外部 adapter）下：不再开新连接，不走 runReadonly（外层已 BEGIN）
    if (opts.adapter) {
      const adapter = opts.adapter;
      const { boundSql, boundParams } = bindParams(sql.content, params, adapter);
      try {
        const res = await adapter.execute(boundSql, boundParams);
        return { data: res.rows, rowCount: res.rowCount, riskLevel: risk };
      } catch (err) {
        const msg = (err as Error).message;
        if (opts.sqlSafe) return { data: null, error: msg, rowCount: 0, riskLevel: risk };
        throw err;
      }
      // 不 close —— 外部 adapter 由 caller 管理生命周期
    }

    const adapter = await this.ds.openAdapter(sql.dataSourceId, {
      tenantCode: opts.tenantCode ?? null,
      userId: opts.userId ?? null,
      deptIds: opts.deptIds ?? [],
    });
    const { boundSql, boundParams } = bindParams(sql.content, params, adapter);
    try {
      // 强制路径：AI actor 或 low-risk SQL 走 READ ONLY 事务，DB 端兜底拒绝写类。
      // human actor 跑非 low SQL 才允许写（且 critical 必须 human，前面已校验）。
      const useReadonly = opts.actor === 'ai' || risk === 'low';
      if (useReadonly) {
        const rows = await adapter.runReadonly<Record<string, unknown>>(boundSql, boundParams);
        return { data: rows, rowCount: rows.length, riskLevel: risk };
      }
      const res = await adapter.execute(boundSql, boundParams);
      return { data: res.rows, rowCount: res.rowCount, riskLevel: risk };
    } catch (err) {
      const msg = (err as Error).message;
      if (opts.sqlSafe) return { data: null, error: msg, rowCount: 0, riskLevel: risk };
      throw err;
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }
}

function classifyRisk(content: string): RiskLevel {
  if (/\b(drop|truncate)\b/i.test(content)) return 'critical';
  if (/\b(alter|delete|update|insert)\b/i.test(content)) {
    if (REQUIRES_HUMAN_CONFIRM.test(content)) return 'critical';
    return 'medium';
  }
  return 'low';
}

function extractPlaceholders(content: string): string[] {
  const matches = content.matchAll(/#\{(\w+)\}/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}

/** 把 #{name} 占位换成 adapter 方言的占位符（PG → $1/$2，MySQL → ?/?）。 */
function bindParams(
  content: string,
  params: Record<string, unknown>,
  adapter: { placeholder(index: number): string },
): { boundSql: string; boundParams: unknown[] } {
  const ordered: unknown[] = [];
  let i = 0;
  const sql = content.replace(/#\{(\w+)\}/g, (_m, name: string) => {
    ordered.push(params[name]);
    i++;
    return adapter.placeholder(i);
  });
  return { boundSql: sql, boundParams: ordered };
}

function generateSqlCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  // crypto.randomBytes：每个字节取低 6 位，再 mod 36 落到 alphabet 上。
  // 单字节 mod 36 有轻微偏差（256/36 ≈ 7.11），对 sqlCode 这种非密钥用途可忽略。
  const seg = (len: number): string => {
    const buf = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[buf[i]! % alphabet.length];
    return out;
  };
  return `${seg(5)}-${seg(5)}`;
}
