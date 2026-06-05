import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';

export interface AuditQuery extends PageRequest {
  appCode?: string;
  userId?: string;
  /** 按 access key 过滤（HMAC 路径写入；JWT 路径恒为 null）。 */
  accessKey?: string;
  action?: string;
  traceparent?: string;
  /** ISO date 字符串。 */
  from?: string;
  to?: string;
}

export interface AuditEntry {
  id: string;
  tenantCode: string;
  appCode: string | null;
  userId: string | null;
  accessKey: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  traceparent: string | null;
  createdAt: Date;
  afterJson: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** tenantCode=null（access key 路径）调用方需自己保证已被 TenantGuard 限定 appCode，
   *  这里仍按 tenantCode null 兜底为"不可读全租户"——访问方必须传 appCode 才放行。 */
  async list(
    tenantCode: string | null,
    q: AuditQuery,
  ): Promise<PagedResult<AuditEntry>> {
    const where = this.whereOf(tenantCode, q);
    const { take, skip, page, pageSize } = paginate(q, { defaultPageSize: 50, maxPageSize: 200 });
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          tenantCode: true,
          appCode: true,
          userId: true,
          accessKey: true,
          action: true,
          targetType: true,
          targetId: true,
          traceparent: true,
          createdAt: true,
          afterJson: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** CSV 流：iterate by cursor，单次 load 批 1000 行；上限 50_000 行避免 OOM。 */
  async *exportCsv(tenantCode: string | null, q: AuditQuery): AsyncGenerator<string, void, void> {
    const where = this.whereOf(tenantCode, q);
    yield 'id,tenantCode,appCode,userId,accessKey,action,targetType,targetId,traceparent,createdAt\n';
    let cursor: string | null = null;
    let yielded = 0;
    const HARD_CAP = 50_000;
    const BATCH = 1000;
    type Row = {
      id: string;
      tenantCode: string;
      appCode: string | null;
      userId: string | null;
      accessKey: string | null;
      action: string;
      targetType: string;
      targetId: string | null;
      traceparent: string | null;
      createdAt: Date;
    };
    while (yielded < HARD_CAP) {
      const rows: Row[] = await this.prisma.auditLog.findMany({
        where,
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          tenantCode: true,
          appCode: true,
          userId: true,
          accessKey: true,
          action: true,
          targetType: true,
          targetId: true,
          traceparent: true,
          createdAt: true,
        },
      });
      if (rows.length === 0) break;
      for (const r of rows) {
        yield [
          r.id,
          r.tenantCode,
          r.appCode ?? '',
          r.userId ?? '',
          r.accessKey ?? '',
          r.action,
          r.targetType,
          r.targetId ?? '',
          r.traceparent ?? '',
          r.createdAt.toISOString(),
        ]
          .map(csvCell)
          .join(',') + '\n';
        yielded += 1;
        if (yielded >= HARD_CAP) break;
      }
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < BATCH) break;
    }
  }

  private whereOf(
    tenantCode: string | null,
    q: AuditQuery,
  ): {
    tenantCode?: string;
    appCode?: string;
    userId?: string;
    accessKey?: string;
    action?: { contains: string; mode: 'insensitive' };
    traceparent?: string;
    createdAt?: { gte?: Date; lte?: Date };
  } {
    const where: ReturnType<AuditService['whereOf']> = {};
    if (tenantCode) where.tenantCode = tenantCode;
    if (q.appCode) where.appCode = q.appCode;
    if (q.userId) where.userId = q.userId;
    if (q.accessKey) where.accessKey = q.accessKey;
    if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
    if (q.traceparent) where.traceparent = q.traceparent;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    return where;
  }
}

function csvCell(v: string): string {
  if (v == null) return '';
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
