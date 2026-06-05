import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { encrypt, decrypt } from '../../common/crypto';
import { assertHostAllowed, SsrfBlocked } from '../../common/ssrf';
import { getDialect, type ConnectionParams, type DialectAdapter } from '@kintsugi/db-scanner';
import type { CreateDataSourceDto, UpdateDataSourceDto } from './dto';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';
import { applySessionGuc, releaseSessionGuc, type SessionGucCtx } from '../instant-api/rls-policy';
import { dbConnInFlight } from '../../common/metrics';
import { QuotaService } from '../tenant/quota.service';

/** 不含密码密文的公开视图。API 层永远不要把 passwordCiphertext 发出去。 */
export interface DataSourcePublic {
  id: string;
  appCode: string;
  dialect: string;
  displayName: string;
  host: string;
  port: number;
  database: string;
  schema: string | null;
  username: string;
  sslMode: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastScanAt: Date | null;
  lastScanStatus: string;
}

const publicSelect = {
  id: true,
  appCode: true,
  dialect: true,
  displayName: true,
  host: true,
  port: true,
  database: true,
  schema: true,
  username: true,
  sslMode: true,
  createdAt: true,
  updatedAt: true,
  lastScanAt: true,
  lastScanStatus: true,
} as const;

@Injectable()
export class DataSourceService {
  private readonly logger = new Logger(DataSourceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  /**
   * 校验 dsId 归当前 tenant；命中 → 返回该 DS 行（带 tenantCode）；不归属 →
   * 返 NOT_FOUND（**不要返 403**：返 403 会泄漏"这个 id 存在"的信息，等于 IDOR 探针辅助）。
   *
   * tenantCode === null 时（accessKey 路径暂无 tenantCode）跳过；调用方必须保证
   * 上游已校验过 appCode 归属。
   */
  async findOwned(
    id: string,
    tenantCode: string | null,
  ): Promise<{ id: string; appCode: string }> {
    const ds = await this.prisma.dataSource.findUnique({
      where: { id },
      select: { id: true, appCode: true, application: { select: { tenantCode: true } } },
    });
    if (!ds) throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    if (tenantCode !== null && ds.application.tenantCode !== tenantCode) {
      // 故意把跨租户访问伪装成 NOT_FOUND
      throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    }
    return { id: ds.id, appCode: ds.appCode };
  }

  async create(dto: CreateDataSourceDto, tenantCode: string | null): Promise<DataSourcePublic> {
    // appCode 归属在 TenantGuard 已经校过；这里只做防御纵深
    if (tenantCode !== null) {
      const app = await this.prisma.application.findUnique({
        where: { appCode: dto.appCode },
        select: { tenantCode: true },
      });
      if (!app || app.tenantCode !== tenantCode) {
        throw new KintsugiError('NOT_FOUND', `Application ${dto.appCode} not found`);
      }
      await this.quota.assertCanCreateDataSource(tenantCode);
    }
    try {
      await assertHostAllowed(dto.host);
    } catch (err) {
      if (err instanceof SsrfBlocked) {
        throw new KintsugiError('VALIDATION_FAILED', err.message);
      }
      throw err;
    }
    return this.prisma.dataSource.create({
      data: {
        appCode: dto.appCode,
        dialect: dto.dialect,
        displayName: dto.displayName,
        host: dto.host,
        port: dto.port,
        database: dto.database,
        schema: dto.schema ?? null,
        username: dto.username,
        passwordCiphertext: encrypt(dto.password),
        sslMode: dto.sslMode ?? null,
      },
      select: publicSelect,
    });
  }

  async list(
    args: { appCode?: string; tenantCode: string | null },
    pageReq: PageRequest = {},
  ): Promise<PagedResult<DataSourcePublic>> {
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    // tenantCode 强制过滤——之前无 appCode 时返回全表，是 IDOR
    const where: Record<string, unknown> = {};
    if (args.appCode) where['appCode'] = args.appCode;
    if (args.tenantCode !== null) {
      where['application'] = { tenantCode: args.tenantCode };
    }
    const [data, total] = await Promise.all([
      this.prisma.dataSource.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: publicSelect,
      }),
      this.prisma.dataSource.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async get(id: string, tenantCode: string | null): Promise<DataSourcePublic> {
    await this.findOwned(id, tenantCode);
    const ds = await this.prisma.dataSource.findUnique({
      where: { id },
      select: publicSelect,
    });
    if (!ds) throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    return ds;
  }

  async update(
    id: string,
    dto: UpdateDataSourceDto,
    tenantCode: string | null,
  ): Promise<DataSourcePublic> {
    const existing = await this.prisma.dataSource.findUnique({
      where: { id },
      select: { id: true, host: true, application: { select: { tenantCode: true } } },
    });
    if (!existing) throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    if (tenantCode !== null && existing.application.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    }

    if (dto.host && dto.host !== existing.host) {
      try {
        await assertHostAllowed(dto.host);
      } catch (err) {
        if (err instanceof SsrfBlocked) {
          throw new KintsugiError('VALIDATION_FAILED', err.message);
        }
        throw err;
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.displayName !== undefined) data['displayName'] = dto.displayName;
    if (dto.host !== undefined) data['host'] = dto.host;
    if (dto.port !== undefined) data['port'] = dto.port;
    if (dto.database !== undefined) data['database'] = dto.database;
    if (dto.schema !== undefined) data['schema'] = dto.schema || null;
    if (dto.username !== undefined) data['username'] = dto.username;
    if (dto.sslMode !== undefined) data['sslMode'] = dto.sslMode;
    // password 只在 caller 显式传非空字符串时改 —— 空串 / undefined 都视为"不改"
    if (dto.password) data['passwordCiphertext'] = encrypt(dto.password);

    if (Object.keys(data).length === 0) {
      throw new KintsugiError('VALIDATION_FAILED', 'no fields to update');
    }

    return this.prisma.dataSource.update({
      where: { id },
      data,
      select: publicSelect,
    });
  }

  async remove(id: string, tenantCode: string | null): Promise<{ ok: true }> {
    await this.findOwned(id, tenantCode);
    await this.prisma.dataSource.delete({ where: { id } });
    return { ok: true };
  }

  async testConnection(
    id: string,
    tenantCode: string | null,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    await this.findOwned(id, tenantCode);
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);

    try {
      await assertHostAllowed(ds.host);
    } catch (err) {
      if (err instanceof SsrfBlocked) return { ok: false, error: err.message };
      throw err;
    }

    const adapter = getDialect(ds.dialect);
    try {
      await adapter.connect(this.toConnParams(ds));
      const versionRow = await adapter.runReadonly<{ v?: string }>(
        ds.dialect === 'postgres' ? 'select version() as v' : 'select version() as v',
      );
      return { ok: true, version: versionRow[0]?.v };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }

  /**
   * 内部用：开 adapter 不做 tenant 检查 —— 调用方都是已经过 appCode 鉴权拿到 dsId 的
   * 服务（chats/reports/instant-api/custom-sql/bff/dbagent），跨租户进不来。
   *
   * sessionCtx 可选：传入会在 PG 连接上 SET kintsugi.tenant/user_id/dept_ids，
   * 给客户启用的 RLS policy 喂 GUC，避免被自家 policy 挡掉。非 PG 方言会忽略。
   * 失败 warn-log 不抛——应用层 extraWhere 仍是兜底。
   */
  async openAdapter(id: string, sessionCtx?: SessionGucCtx): Promise<DialectAdapter> {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) throw new KintsugiError('NOT_FOUND', `DataSource ${id} not found`);
    try {
      await assertHostAllowed(ds.host);
    } catch (err) {
      if (err instanceof SsrfBlocked) {
        throw new KintsugiError('VALIDATION_FAILED', err.message);
      }
      throw err;
    }
    const adapter = getDialect(ds.dialect);
    await adapter.connect(this.toConnParams(ds));
    if (sessionCtx) {
      await applySessionGuc(adapter, sessionCtx, this.logger);
    }
    // 包一层 close 计数：开+1 关-1，泄漏的连接在 dashboard 上能看出来
    dbConnInFlight.add(1, { dialect: ds.dialect });
    const origClose = adapter.close.bind(adapter);
    let closed = false;
    adapter.close = async () => {
      if (closed) return;
      closed = true;
      // 防御纵深：close 前显式 RESET RLS GUC，万一未来换连接池也不会泄漏
      if (sessionCtx) {
        await releaseSessionGuc(adapter, this.logger);
      }
      dbConnInFlight.add(-1, { dialect: ds.dialect });
      return origClose();
    };
    return adapter;
  }

  private toConnParams(ds: {
    dialect: string;
    host: string;
    port: number;
    username: string;
    passwordCiphertext: string;
    database: string;
    schema: string | null;
    sslMode: string | null;
  }): ConnectionParams {
    let password: string;
    try {
      password = decrypt(ds.passwordCiphertext);
    } catch (err) {
      // 解密失败大概率是服务端 ENCRYPTION_KEY 与入库时不一致 —— 翻成 502 + 结构化 code，
      // 让前端 / 监控能与一般 500 区分；明文错误细节只进 server log，不外露。
      this.logger.error(
        `decrypt datasource credential failed for ${ds.host}: ${(err as Error).message}`,
      );
      throw new KintsugiError(
        'DATASOURCE_UNREACHABLE',
        'datasource credential decrypt failed — server ENCRYPTION_KEY may be misconfigured',
        { reason: 'decrypt_failed' },
      );
    }
    return {
      dialect: ds.dialect as ConnectionParams['dialect'],
      host: ds.host,
      port: ds.port,
      user: ds.username,
      password,
      database: ds.database,
      schema: ds.schema ?? undefined,
      sslMode: (ds.sslMode as ConnectionParams['sslMode']) ?? undefined,
    };
  }
}
