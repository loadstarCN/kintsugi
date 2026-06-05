import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { DialectAdapter } from '@kintsugi/db-scanner';
import { KintsugiError } from '@kintsugi/shared';
// 必须是值导入，不能 import type —— Nest 反射元数据靠运行时 class 引用。
// 之前能跑是因为 BffService 手动 new BffRuntime(...) 不过 DI；进 Nest 后必须改回。
import { InstantApiService } from '../instant-api/instant-api.service';
import { CustomSqlService } from '../custom-sql/custom-sql.service';
import { DataSourceService } from '../datasource/datasource.service';
import { BffWorkerPool, type LogLevel } from './bff-worker-pool';
import type { SessionGucCtx } from '../instant-api/rls-policy';

/** 把 BFF 执行上下文里的 userInfo 转成 PG GUC ctx；没有 user 返回 undefined（兜底走应用层）。 */
function sessionGucFromBffCtx(ctx: { userInfo: { userId: string; tenantCode: string } | null }):
  | SessionGucCtx
  | undefined {
  const u = ctx.userInfo;
  if (!u) return undefined;
  return { tenantCode: u.tenantCode, userId: u.userId };
}

/**
 * BFF 沙箱：child_process pool + vm。
 *
 * 为什么不是 worker_threads：
 *  worker_threads 是线程隔离不是进程隔离 —— 共享 process 对象 / env / fd。攻击者通过 ctx-walk
 *  拿到 worker realm 的 require 后能 require('child_process').exec(...) RCE。
 *  所以这里用 child_process.spawn 拉独立 Node 进程跑用户代码。
 *
 * 安全模型：
 *  - 用户代码跑在独立 child process 里（pool 复用）
 *  - env 只透传 NODE_ENV，**不传** JWT_SECRET / ENCRYPTION_KEY / DATABASE_URL
 *  - 子进程内 vm 加固（不暴露 host primordial）
 *  - 即便逃出 vm 拿到子进程的 require，子进程没 DB 凭据、没 Prisma 实例
 *  - 资源配额：--max-old-space-size + watchdog SIGKILL
 *  - 所有数据访问走 IPC，主进程审批后回结果
 *
 * Pool 行为：
 *  - 启动时预 fork BFF_POOL_SIZE 个子进程（默认 4）
 *  - 每次调用从 idle 取，跑完 release 回 pool
 *  - Worker 异常 / 超时 → 标 dead，pool 替换
 *  - Worker 跑 BFF_RECYCLE_AFTER 次（默认 100）后强制重建，防 V8 heap 累积
 */

export interface BffContextUser {
  userId: string;
  tenantCode: string;
  username: string;
}

export interface BffExecutionContext {
  userInfo: BffContextUser | null;
  input: unknown;
  client: {
    models: ModelsProxy;
    sql: {
      execute(sqlCode: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    /** 单库事务：fn 内 client.* 调用绑定到同一连接 + BEGIN/COMMIT/ROLLBACK 包裹。
     *  跨 dataSourceId 的 fn 内部调用直接抛错。 */
    tx<T>(fn: () => Promise<T>): Promise<T>;
  };
  logger: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  /** runtime 内部用：tx 期间根据 datasetCode 解析 dataSourceId */
  _bffMeta?: {
    appCode: string;
    datasetCodeByTableName: Map<string, string>;
  };
}

/** 一次 BFF 执行的 tx 状态。在 RPC handler 之间共享。 */
interface BffTxState {
  entered: boolean;
  adapter: DialectAdapter | null;
  dataSourceId: string | null;
}

interface ModelProxyEntry {
  filter(body: Record<string, unknown>): Promise<unknown>;
  getOne(id: string): Promise<unknown>;
  create(data: Record<string, unknown>): Promise<unknown>;
  update(id: string, data: Record<string, unknown>): Promise<unknown>;
  delete(id: string): Promise<unknown>;
}

type ModelsProxy = Record<string, ModelProxyEntry>;

const RPC_METHODS = ['filter', 'getOne', 'create', 'update', 'delete'] as const;
type RpcMethod = (typeof RPC_METHODS)[number];

@Injectable()
export class BffRuntime implements OnModuleDestroy {
  private readonly logger = new Logger(BffRuntime.name);
  private pool: BffWorkerPool | null = null;

  constructor(
    private readonly instantApi: InstantApiService,
    private readonly customSql: CustomSqlService,
    private readonly dsService: DataSourceService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.destroy();
  }

  private getPool(): BffWorkerPool {
    if (!this.pool) this.pool = new BffWorkerPool();
    return this.pool;
  }

  buildContext(
    appCode: string,
    datasetCodeByTableName: Map<string, string>,
    user: BffContextUser | null,
    input: unknown,
  ): BffExecutionContext {
    // 这个 context 是给"主进程直接调 BffRuntime.run"使用（单元测试 / 内部 caller）。
    // 实际 BFF 子进程跑用户代码时，子进程在 child source 里**自己重建** ctx，client 各
    // 方法是发 RPC 回主进程的 stub。两条路径在主进程 handleRpc 里汇合。
    const models: ModelsProxy = {};
    for (const [tableName, datasetCode] of datasetCodeByTableName) {
      models[tableName] = {
        filter: (body) => this.instantApi.filter(appCode, datasetCode, body),
        getOne: (id) => this.instantApi.getOne(appCode, datasetCode, id),
        create: (data) => this.instantApi.create(appCode, datasetCode, data),
        update: (id, data) => this.instantApi.update(appCode, datasetCode, id, data),
        delete: (id) => this.instantApi.remove(appCode, datasetCode, id),
      };
    }
    return {
      userInfo: user,
      input,
      client: {
        models,
        sql: {
          execute: (sqlCode: string, params?: Record<string, unknown>) =>
            this.customSql
              .execute(sqlCode, params ?? {}, { actor: 'human' })
              .then((r) => r.data),
        },
        tx: async <T,>(fn: () => Promise<T>): Promise<T> => {
          // 主进程直跑路径：直接 await fn（这条路径不实现真事务，因为没经过 RPC 状态机）。
          // 走 BFF 子进程 + RPC 路径才有真事务（见 handleRpc 的 tx.* 分支）。
          return await fn();
        },
      },
      logger: {
        log: (...args) => console.log('[BFF]', ...args),
        warn: (...args) => console.warn('[BFF]', ...args),
        error: (...args) => console.error('[BFF]', ...args),
      },
      _bffMeta: { appCode, datasetCodeByTableName },
    };
  }

  async run(code: string, context: BffExecutionContext, timeoutMs = 5000): Promise<unknown> {
    const modelNames = Object.keys(context.client.models);
    const safeInput = this.toSerializable(context.input);
    const safeUser = context.userInfo
      ? {
          userId: context.userInfo.userId,
          tenantCode: context.userInfo.tenantCode,
          username: context.userInfo.username,
        }
      : null;

    const pool = this.getPool();
    const worker = await pool.acquire();
    // 每次 BFF 执行独立的 tx 状态。结束时若仍 entered（用户没 commit/rollback）必须释放。
    const txState: BffTxState = { entered: false, adapter: null, dataSourceId: null };
    try {
      return await worker.run(
        {
          code,
          input: safeInput,
          userInfo: safeUser,
          modelNames,
          vmTimeoutMs: Math.min(timeoutMs, 30_000),
        },
        {
          onLog: (level: LogLevel, args: string[]) => context.logger[level](...args),
          onRpc: (target, args) => this.handleRpc(context, target, args, txState),
        },
        timeoutMs,
      );
    } finally {
      // tx 没正常 commit/rollback 就到 finally —— 强制 ROLLBACK 释放连接
      if (txState.adapter) {
        try {
          await txState.adapter.execute('ROLLBACK').catch(() => undefined);
        } finally {
          await txState.adapter.close().catch(() => undefined);
        }
        this.logger.warn(
          'BFF tx forced ROLLBACK (worker exited without explicit commit/rollback)',
        );
      }
      // 用户代码 throw / syntax error 不应该让 worker 报废 —— 进程还活着，sandbox 下次重建即可。
      // 只有 worker 真死（timeout SIGKILL / IPC 断 / 异常退出）才 recycle。
      pool.release(worker, !worker.dead);
    }
  }

  private async handleRpc(
    ctx: BffExecutionContext,
    target: string,
    args: unknown[],
    tx: BffTxState,
  ): Promise<unknown> {
    const parts = target.split('.');

    // ---- tx 控制：tx.begin / tx.commit / tx.rollback ----
    if (parts[0] === 'tx' && parts.length === 2) {
      if (parts[1] === 'begin') {
        if (tx.entered) throw new Error('tx already begun');
        tx.entered = true;
        // 不立刻 openAdapter —— 等第一次 dataset 调用时才知道 dsId
        return { ok: true };
      }
      if (parts[1] === 'commit') {
        if (!tx.entered) throw new Error('tx not begun');
        if (tx.adapter) {
          try {
            await tx.adapter.execute('COMMIT');
          } finally {
            await tx.adapter.close().catch(() => undefined);
          }
        }
        tx.entered = false;
        tx.adapter = null;
        tx.dataSourceId = null;
        return { ok: true };
      }
      if (parts[1] === 'rollback') {
        if (!tx.entered) throw new Error('tx not begun');
        if (tx.adapter) {
          try {
            await tx.adapter.execute('ROLLBACK').catch(() => undefined);
          } finally {
            await tx.adapter.close().catch(() => undefined);
          }
        }
        tx.entered = false;
        tx.adapter = null;
        tx.dataSourceId = null;
        return { ok: true };
      }
    }

    // ---- 数据 RPC：sql / models ----
    // 在 tx 内：dsId 必须一致；首次调用时 openAdapter + BEGIN
    if (parts[0] === 'sql' && parts[1] === 'execute' && parts.length === 2) {
      const [sqlCode, params] = args as [string, Record<string, unknown>?];
      if (tx.entered) {
        const dsId = await this.customSql.resolveDataSourceId(sqlCode);
        if (tx.adapter && tx.dataSourceId !== dsId) {
          throw new KintsugiError(
            'VALIDATION_FAILED',
            `BFF tx cross dataSource not supported (tx bound to ${tx.dataSourceId}, sql to ${dsId})`,
          );
        }
        if (!tx.adapter) {
          const adapter = await this.dsService.openAdapter(dsId, sessionGucFromBffCtx(ctx));
          await adapter.execute('BEGIN');
          tx.adapter = adapter;
          tx.dataSourceId = dsId;
        }
        // tx 内 sql.execute：actor='human' + 外部 adapter（不另开 readonly 事务，
        // 由外层 BEGIN 控制；DB 端的写允许性由当前事务模式决定，正常 BEGIN 是读写）
        const r = await this.customSql.execute(sqlCode, params ?? {}, {
          actor: 'human',
          adapter: tx.adapter,
        });
        return r.data;
      }
      return ctx.client.sql.execute(sqlCode, params);
    }

    if (parts[0] === 'models' && parts.length === 3) {
      const [, table, method] = parts as [string, string, string];
      if (!RPC_METHODS.includes(method as RpcMethod)) {
        throw new Error(`unknown method models.${table}.${method}`);
      }
      const meta = ctx._bffMeta;
      if (!meta) {
        // 没 _bffMeta（直接用 buildContext 跑的单测路径），走旧 closure
        const entry = ctx.client.models[table];
        if (!entry) throw new Error(`unknown model ${table}`);
        const fn = entry[method as RpcMethod] as (...args: unknown[]) => Promise<unknown>;
        return fn.call(entry, ...args);
      }
      const datasetCode = meta.datasetCodeByTableName.get(table);
      if (!datasetCode) throw new Error(`unknown model ${table}`);

      // tx 期间：解析 dsId 校验跨库；首次调用启 BEGIN
      let txAdapter: DialectAdapter | undefined;
      if (tx.entered) {
        const dsId = await this.instantApi.resolveDataSourceId(meta.appCode, datasetCode);
        if (tx.adapter && tx.dataSourceId !== dsId) {
          throw new KintsugiError(
            'VALIDATION_FAILED',
            `BFF tx cross dataSource not supported (tx bound to ${tx.dataSourceId}, request to ${dsId})`,
          );
        }
        if (!tx.adapter) {
          const adapter = await this.dsService.openAdapter(dsId, sessionGucFromBffCtx(ctx));
          await adapter.execute('BEGIN');
          tx.adapter = adapter;
          tx.dataSourceId = dsId;
        }
        txAdapter = tx.adapter;
      }

      const opts = txAdapter ? { adapter: txAdapter } : undefined;
      switch (method as RpcMethod) {
        case 'filter':
          return this.instantApi.filter(meta.appCode, datasetCode, args[0] as never, {}, opts);
        case 'getOne':
          return this.instantApi.getOne(meta.appCode, datasetCode, args[0] as string, {}, opts);
        case 'create':
          return this.instantApi.create(meta.appCode, datasetCode, args[0] as never, {}, opts);
        case 'update':
          return this.instantApi.update(
            meta.appCode,
            datasetCode,
            args[0] as string,
            args[1] as never,
            {},
            opts,
          );
        case 'delete':
          return this.instantApi.remove(meta.appCode, datasetCode, args[0] as string, {}, opts);
      }
    }

    throw new Error(`unknown rpc target ${target}`);
  }

  private toSerializable(x: unknown): unknown {
    try {
      return JSON.parse(JSON.stringify(x ?? null));
    } catch {
      return null;
    }
  }
}
