import { spawn, type ChildProcess } from 'node:child_process';
import { Logger } from '@nestjs/common';
import { KintsugiError } from '@kintsugi/shared';

/**
 * BFF worker pool。
 *
 * 单 worker = 一个长寿命 child_process，跑同一段 inline node 脚本。
 * 每次 init 跑一段用户代码，跑完不 exit，等下一个 init。
 * 这样把 ~150-300ms 的 spawn 启动开销摊到 pool 启动一次性付出。
 *
 * 健康检查：
 *  - timeout / error / 异常 exit → 该 worker 标 dead，pool 丢弃 + 补一个新的
 *  - 定时回收（防长跑 worker heap 不断增长）：每 N 次执行后强制 recycle
 *
 * 配置：
 *  - BFF_POOL_SIZE       默认 4
 *  - BFF_MAX_HEAP_MB     默认 128
 *  - BFF_RECYCLE_AFTER   默认 100（worker 跑这么多次后 recycle）
 */

export type LogLevel = 'log' | 'warn' | 'error';

export interface JobMessages {
  onLog: (level: LogLevel, args: string[]) => void;
  onRpc: (target: string, args: unknown[]) => Promise<unknown>;
}

export interface JobPayload {
  code: string;
  input: unknown;
  userInfo: unknown;
  modelNames: string[];
  vmTimeoutMs: number;
}

interface ChildRpc {
  type: 'rpc';
  id: string;
  target: string;
  args: unknown[];
}
interface ChildResult {
  type: 'result';
  value: unknown;
}
interface ChildError {
  type: 'error';
  message: string;
}
interface ChildLog {
  type: 'log';
  level: LogLevel;
  args: string[];
}
interface ChildJobDone {
  type: 'job-done';
}
type ChildMessage = ChildRpc | ChildResult | ChildError | ChildLog | ChildJobDone;

interface CurrentJob {
  resolve(value: unknown): void;
  reject(err: Error): void;
  msgs: JobMessages;
  settled: boolean;
  watchdog: NodeJS.Timeout | null;
}

class BffWorker {
  private readonly logger = new Logger(BffWorker.name);
  private child: ChildProcess;
  private currentJob: CurrentJob | null = null;
  private _dead = false;
  private _runs = 0;

  constructor(private readonly heapMb: number) {
    this.child = this.spawn();
  }

  private spawn(): ChildProcess {
    const child = spawn(
      process.execPath,
      [`--max-old-space-size=${this.heapMb}`, '-e', CHILD_SOURCE],
      {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { NODE_ENV: process.env['NODE_ENV'] ?? '' },
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[BFF.child] ${chunk.toString().trimEnd()}\n`);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[BFF.child:err] ${chunk.toString().trimEnd()}\n`);
    });
    child.on('message', (msg: ChildMessage) => this.onMessage(msg));
    child.on('error', (err) => {
      this.logger.warn(`worker error: ${err.message}`);
      this.markDead();
      this.failCurrent(`BFF worker error: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      this.markDead();
      this.failCurrent(`BFF worker exited code=${code} signal=${signal}`);
    });
    return child;
  }

  get dead(): boolean {
    return this._dead;
  }
  get runs(): number {
    return this._runs;
  }

  /** pool 检测到此 worker 应丢弃后调；强行 SIGKILL，事件回调里失败当前 job。 */
  destroy(): void {
    this.markDead();
    this.child.kill('SIGTERM');
    // 兜底：1s 没退出就 SIGKILL
    setTimeout(() => {
      if (!this.child.killed) this.child.kill('SIGKILL');
    }, 1000).unref();
  }

  /** 跑一次用户代码。注意此方法假定调用方已经从 pool acquire，互斥执行。 */
  async run(payload: JobPayload, msgs: JobMessages, timeoutMs: number): Promise<unknown> {
    if (this._dead) {
      throw new KintsugiError('INTERNAL', 'BFF worker is dead');
    }
    if (this.currentJob) {
      throw new KintsugiError('INTERNAL', 'BFF worker concurrency violated (pool bug)');
    }
    this._runs++;
    return new Promise<unknown>((resolve, reject) => {
      const job: CurrentJob = { resolve, reject, msgs, settled: false, watchdog: null };
      job.watchdog = setTimeout(() => {
        if (job.settled) return;
        job.settled = true;
        this.markDead();
        this.child.kill('SIGKILL');
        reject(new KintsugiError('INTERNAL', `BFF runtime error: timeout ${timeoutMs}ms`));
      }, timeoutMs);
      this.currentJob = job;
      try {
        this.child.send({
          type: 'init',
          code: payload.code,
          input: payload.input,
          userInfo: payload.userInfo,
          modelNames: payload.modelNames,
          vmTimeoutMs: payload.vmTimeoutMs,
        });
      } catch (err) {
        this.settle(false, () => reject(err as Error));
      }
    });
  }

  private settle(ok: boolean, fn: () => void): void {
    const job = this.currentJob;
    if (!job || job.settled) return;
    job.settled = true;
    if (job.watchdog) clearTimeout(job.watchdog);
    fn();
    void ok; // result / error 都通过 settle 走，标记差异留给 pool.release 决定 healthy
    // 注意：currentJob 不在这里清空 —— job-done 来时清，避免 result/error 之后 RPC reply 误入下一 job
  }

  private failCurrent(reason: string): void {
    if (!this.currentJob) return;
    this.settle(false, () => this.currentJob!.reject(new KintsugiError('INTERNAL', reason)));
    this.currentJob = null;
  }

  private markDead(): void {
    this._dead = true;
  }

  private onMessage(msg: ChildMessage): void {
    if (!this.currentJob && msg.type !== 'job-done') {
      // child 发的孤儿消息（上一个 job 已 settle / job-done 后）；忽略
      return;
    }
    switch (msg.type) {
      case 'result':
        this.settle(true, () => this.currentJob!.resolve(msg.value));
        return;
      case 'error':
        this.settle(false, () =>
          this.currentJob!.reject(new KintsugiError('INTERNAL', `BFF runtime error: ${msg.message}`)),
        );
        return;
      case 'log':
        this.currentJob!.msgs.onLog(msg.level, msg.args);
        return;
      case 'rpc':
        void this.currentJob!.msgs
          .onRpc(msg.target, msg.args)
          .then((result) => {
            if (this._dead) return;
            try {
              this.child.send({ type: 'rpc-reply', id: msg.id, result });
            } catch {
              /* child gone */
            }
          })
          .catch((err: Error) => {
            if (this._dead) return;
            try {
              this.child.send({ type: 'rpc-reply', id: msg.id, error: err.message });
            } catch {
              /* child gone */
            }
          });
        return;
      case 'job-done':
        // child 自报"我准备好接下一个 init"，pool 释放此 worker 给下一个 job
        this.currentJob = null;
        return;
    }
  }
}

export class BffWorkerPool {
  private readonly logger = new Logger(BffWorkerPool.name);
  private readonly idle: BffWorker[] = [];
  private readonly busy = new Set<BffWorker>();
  private readonly waiters: Array<(w: BffWorker) => void> = [];
  private readonly heapMb: number;
  private readonly recycleAfter: number;
  private readonly size: number;

  constructor(opts?: { size?: number; heapMb?: number; recycleAfter?: number }) {
    this.size = Math.max(1, opts?.size ?? Number(process.env['BFF_POOL_SIZE'] ?? 4));
    this.heapMb = opts?.heapMb ?? Number(process.env['BFF_MAX_HEAP_MB'] ?? 128);
    this.recycleAfter = opts?.recycleAfter ?? Number(process.env['BFF_RECYCLE_AFTER'] ?? 100);
    for (let i = 0; i < this.size; i++) {
      this.idle.push(new BffWorker(this.heapMb));
    }
    this.logger.log(
      `BFF worker pool: size=${this.size} heap=${this.heapMb}MB recycleAfter=${this.recycleAfter}`,
    );
  }

  async acquire(): Promise<BffWorker> {
    while (this.idle.length > 0) {
      const w = this.idle.shift()!;
      if (w.dead) continue; // 跳过已死的
      this.busy.add(w);
      return w;
    }
    return new Promise<BffWorker>((resolve) => this.waiters.push(resolve));
  }

  release(worker: BffWorker, healthy: boolean): void {
    this.busy.delete(worker);
    const shouldRecycle =
      !healthy || worker.dead || worker.runs >= this.recycleAfter;
    let toReturn: BffWorker = worker;
    if (shouldRecycle) {
      worker.destroy();
      toReturn = new BffWorker(this.heapMb);
      this.logger.debug(
        `recycled worker (healthy=${healthy} dead=${worker.dead} runs=${worker.runs})`,
      );
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      this.busy.add(toReturn);
      waiter(toReturn);
    } else {
      this.idle.push(toReturn);
    }
  }

  async destroy(): Promise<void> {
    while (this.idle.length > 0) this.idle.shift()!.destroy();
    for (const w of this.busy) w.destroy();
    this.busy.clear();
  }
}

/**
 * 子进程脚本（inline，通过 `node -e` 跑）。
 *
 * 与单次 spawn 版本的关键差异：
 *  - 跑完一次 init 不 process.exit；发 'job-done' 后等下一个 init
 *  - 每次 init 主动 pending.clear() + 重建 sandbox，确保两个 job 之间没有状态泄漏
 *  - 顶部超时 watchdog 改为 60s 没收到 init（活检 idle 的子进程也要心跳）—— 主进程
 *    health check / 长 idle 后自然 SIGTERM 回收，子进程不要自杀
 */
const CHILD_SOURCE = `
const vm = require('node:vm');
const crypto = require('node:crypto');

if (typeof process.send !== 'function') {
  console.error('BFF child started without IPC channel');
  process.exit(2);
}

const pending = new Map();
let inJob = false;

function rpc(target, args) {
  const id = crypto.randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send({ type: 'rpc', id, target, args });
  });
}

function safeStr(x) {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean' || x == null) return String(x);
  try { return JSON.stringify(x); } catch { return '[unserializable]'; }
}

function postLog(level) {
  return (...args) => {
    try {
      process.send({ type: 'log', level, args: args.map(safeStr).slice(0, 20) });
    } catch (_) { /* parent gone */ }
  };
}

function buildCtx({ input, userInfo, modelNames }) {
  const models = Object.create(null);
  for (const name of modelNames) {
    models[name] = {
      filter: (body) => rpc('models.' + name + '.filter', [body]),
      getOne: (id) => rpc('models.' + name + '.getOne', [id]),
      create: (data) => rpc('models.' + name + '.create', [data]),
      update: (id, data) => rpc('models.' + name + '.update', [id, data]),
      delete: (id) => rpc('models.' + name + '.delete', [id]),
    };
  }
  return {
    userInfo,
    input,
    client: {
      models,
      sql: { execute: (sqlCode, params) => rpc('sql.execute', [sqlCode, params || {}]) },
      // 真事务：tx.begin/commit/rollback 三段 RPC，主进程绑定单一 adapter，
      // tx 内 client.models.* 调用走 tx-bound adapter；跨 dataSource 主进程会拒绝。
      // 注意：tx 内 client.sql.execute 不在事务里（CustomSql 还没接外部 adapter）。
      tx: async (fn) => {
        await rpc('tx.begin', []);
        try {
          const r = await fn();
          await rpc('tx.commit', []);
          return r;
        } catch (err) {
          try { await rpc('tx.rollback', []); } catch (_) { /* swallow */ }
          throw err;
        }
      },
    },
    logger: { log: postLog('log'), warn: postLog('warn'), error: postLog('error') },
  };
}

function postResult(value) {
  let safe;
  try { safe = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch { safe = null; }
  try { process.send({ type: 'result', value: safe }); } catch (_) {}
}
function postError(message) {
  try { process.send({ type: 'error', message: String(message) }); } catch (_) {}
}
function postJobDone() {
  try { process.send({ type: 'job-done' }); } catch (_) {}
}

process.on('message', async (msg) => {
  if (msg && msg.type === 'rpc-reply') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
    return;
  }
  if (msg && msg.type === 'init') {
    if (inJob) {
      postError('worker busy (protocol error)');
      return;
    }
    inJob = true;
    pending.clear();  // 清上一 job 残留（理论上不该有，安全起见）
    const ctx = buildCtx(msg);
    const sandbox = { module: { exports: null }, exports: {}, console: ctx.logger };
    const sb = vm.createContext(sandbox);
    try {
      new vm.Script(msg.code, { filename: 'bff.js' }).runInContext(sb, { timeout: msg.vmTimeoutMs });
    } catch (err) {
      postError('syntax/compile: ' + (err && err.message || err));
      pending.clear();
      inJob = false;
      postJobDone();
      return;
    }
    const handler = sandbox.module.exports || sandbox.exports;
    if (typeof handler !== 'function') {
      postError('BFF must export a function via module.exports');
      pending.clear();
      inJob = false;
      postJobDone();
      return;
    }
    try {
      const result = await handler(ctx);
      postResult(result);
    } catch (err) {
      postError((err && err.message) || String(err));
    } finally {
      pending.clear();
      inJob = false;
      postJobDone();
    }
  }
});

// IPC channel 关了（主进程退出）→ 子进程也退
process.on('disconnect', () => process.exit(0));
`;
