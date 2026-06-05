import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../modules/auth/auth.service';
import { auditWriteFailCounter } from './metrics';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * AuditInterceptor：对写请求（POST/PATCH/PUT/DELETE）以及 Instant API/BFF/SQL 执行路径写 AuditLog。
 * traceparent 透传（W3C）用于分布式追踪对齐。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{
      method: string;
      url: string;
      body?: unknown;
      user?: JwtPayload;
      accessKeyCtx?: {
        appCode: string;
        accessKey: string;
        tenantCode: string;
        boundUserId: string | null;
      };
      headers: Record<string, string | string[] | undefined>;
      params?: Record<string, string>;
    }>();
    const method = req.method;
    const url = req.url;
    const shouldAudit = WRITE_METHODS.has(method) || /\/(sql|bff|chats)\//.test(url);
    if (!shouldAudit) return next.handle();

    // 派生 audit 主体：JWT 优先；HMAC 路径也要审计（之前 HMAC 写操作不留痕迹是漏洞），
    // userId 用 boundUserId，没绑就 null（仍能按 tenantCode 索引）。
    // @Public 路由（login/register/logout、health、feishu webhook 等）两个都没有 → 不写
    // audit（tenantCode 是 FK 到 Tenant 表，没法塞 anonymous）。
    let auditCtx: {
      tenantCode: string;
      userId: string | null;
      actor: 'user' | 'accessKey';
      accessKey?: string;
    } | null = null;
    if (req.user) {
      auditCtx = { tenantCode: req.user.tenantCode, userId: req.user.sub, actor: 'user' };
    } else if (req.accessKeyCtx) {
      auditCtx = {
        tenantCode: req.accessKeyCtx.tenantCode,
        userId: req.accessKeyCtx.boundUserId,
        actor: 'accessKey',
        accessKey: req.accessKeyCtx.accessKey,
      };
    }
    if (!auditCtx) return next.handle();

    const traceparent = pickHeader(req.headers['traceparent']);
    const ctxRef = auditCtx;
    const targetType = ctxRef.actor === 'accessKey' ? 'http:hmac' : 'http';

    return next.handle().pipe(
      tap({
        next: () => {
          void this.writeAudit({
            tenantCode: ctxRef.tenantCode,
            userId: ctxRef.userId,
            accessKey: ctxRef.accessKey ?? null,
            appCode: req.params?.['appCode'] ?? null,
            action: `${method} ${simplifyUrl(url)}`,
            afterJson: safeSnapshot(req.body),
            traceparent,
            targetType,
          });
        },
        error: (err: Error) => {
          void this.writeAudit({
            tenantCode: ctxRef.tenantCode,
            userId: ctxRef.userId,
            accessKey: ctxRef.accessKey ?? null,
            appCode: req.params?.['appCode'] ?? null,
            action: `${method} ${simplifyUrl(url)} FAILED`,
            afterJson: { error: err.message },
            traceparent,
            targetType,
          });
        },
      }),
    );
  }

  private async writeAudit(entry: {
    tenantCode: string;
    userId: string | null;
    accessKey: string | null;
    appCode: string | null;
    action: string;
    afterJson?: unknown;
    traceparent?: string | null;
    targetType?: string;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantCode: entry.tenantCode,
          userId: entry.userId,
          accessKey: entry.accessKey,
          appCode: entry.appCode,
          action: entry.action,
          targetType: entry.targetType ?? 'http',
          afterJson: (entry.afterJson ?? undefined) as object | undefined,
          traceparent: entry.traceparent ?? null,
        },
      });
    } catch (err) {
      // 不把 tenantCode 作 metric label：高基数（tenants 数量增长 → 时间序列爆炸 / OOM 后端）。
      // tenant 信息留在 log 里，metric 只记 count。
      auditWriteFailCounter.add(1);
      this.logger.warn(
        `audit write failed for tenant=${entry.tenantCode}: ${(err as Error).message}`,
      );
    }
  }
}

function pickHeader(v: string | string[] | undefined): string | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] ?? null;
  return v;
}

function simplifyUrl(url: string): string {
  return url.split('?')[0] ?? url;
}

function safeSnapshot(body: unknown): unknown {
  if (!body) return null;
  try {
    const s = JSON.stringify(body);
    if (s.length > 4000) return { truncated: true, preview: s.slice(0, 4000) };
    const parsed = JSON.parse(s) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null) {
      for (const k of Object.keys(parsed)) {
        if (/password|secret|token|key/i.test(k)) parsed[k] = '***';
      }
    }
    return parsed;
  } catch {
    return null;
  }
}
