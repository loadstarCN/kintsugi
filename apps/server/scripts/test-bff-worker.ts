/**
 * BFF worker_thread 沙箱单元测试，不依赖 server / DB。
 * 跑法：cd apps/server && pnpm exec node -r @swc-node/register scripts/test-bff-worker.ts
 */
import { BffRuntime, type BffExecutionContext } from '../src/modules/bff/bff-runtime';

// 假 InstantApi / CustomSql / DataSource：worker 通过 RPC 打回主进程，主进程调这俩
const callLog: Array<{ method: string; usedTxAdapter: boolean }> = [];

class FakeInstantApi {
  filter = async (
    _appCode: string,
    datasetCode: string,
    body: Record<string, unknown>,
    _user: unknown,
    opts?: { adapter?: unknown },
  ): Promise<unknown> => {
    callLog.push({ method: 'filter', usedTxAdapter: !!opts?.adapter });
    return { from: 'main', datasetCode, body, rows: [{ id: 1 }, { id: 2 }] };
  };
  getOne = async (
    _a: string,
    _d: string,
    id: string,
    _u?: unknown,
    opts?: { adapter?: unknown },
  ): Promise<unknown> => {
    callLog.push({ method: 'getOne', usedTxAdapter: !!opts?.adapter });
    return { id };
  };
  create = async (
    _a: string,
    _d: string,
    data: Record<string, unknown>,
    _u?: unknown,
    opts?: { adapter?: unknown },
  ): Promise<unknown> => {
    callLog.push({ method: 'create', usedTxAdapter: !!opts?.adapter });
    return { created: true, data };
  };
  update = async (
    _a: string,
    _d: string,
    id: string,
    data: Record<string, unknown>,
    _u?: unknown,
    opts?: { adapter?: unknown },
  ): Promise<unknown> => {
    callLog.push({ method: 'update', usedTxAdapter: !!opts?.adapter });
    return { id, data };
  };
  remove = async (
    _a: string,
    _d: string,
    id: string,
    _u?: unknown,
    opts?: { adapter?: unknown },
  ): Promise<unknown> => {
    callLog.push({ method: 'remove', usedTxAdapter: !!opts?.adapter });
    return { id, deleted: true };
  };
  resolveDataSourceId = async (_appCode: string, datasetCode: string): Promise<string> => {
    return datasetCode === 'ds-users' ? 'ds-A' : 'ds-B';
  };
}
const sqlCallLog: Array<{ sqlCode: string; usedTxAdapter: boolean }> = [];
class FakeCustomSql {
  execute = async (
    sqlCode: string,
    _params: Record<string, unknown>,
    opts?: { adapter?: unknown },
  ): Promise<{ data: unknown }> => {
    sqlCallLog.push({ sqlCode, usedTxAdapter: !!opts?.adapter });
    return { data: { sqlCode, ran: true } };
  };
  resolveDataSourceId = async (sqlCode: string): Promise<string> => {
    // 假约定：'q-A-*' 在 ds-A，'q-B-*' 在 ds-B
    return sqlCode.startsWith('q-B') ? 'ds-B' : 'ds-A';
  };
}

// FakeDataSource：tx 内 openAdapter 返一个能跑 BEGIN/COMMIT/ROLLBACK 的 fake adapter
const adapterLog: string[] = [];
class FakeAdapter {
  id = 'postgres' as const;
  async execute(sql: string): Promise<{ rows: unknown[]; rowCount: number }> {
    adapterLog.push(sql);
    return { rows: [], rowCount: 0 };
  }
  async close(): Promise<void> {
    adapterLog.push('CLOSE');
  }
}
class FakeDataSource {
  openAdapter = async (_id: string): Promise<unknown> => new FakeAdapter();
}

const rt = new BffRuntime(
  new FakeInstantApi() as never,
  new FakeCustomSql() as never,
  new FakeDataSource() as never,
);

// 主进程 PID + secret，用来对比
process.env['ONLY_IN_MAIN'] = 'main-secret-' + Math.random().toString(36).slice(2);
const MAIN_PID = process.pid;
const MAIN_SECRET = process.env['ONLY_IN_MAIN'];

function buildCtx(input: unknown): BffExecutionContext {
  const ctx = rt.buildContext(
    'app-test',
    new Map([
      ['users', 'ds-users'],
      ['orders', 'ds-orders'],
    ]),
    { userId: 'u1', tenantCode: 'demo', username: 'tester' },
    input,
  );
  return ctx;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
    pass++;
  } else {
    console.log(`✗ ${label}${extra ? ` — ${extra}` : ''}`);
    fail++;
  }
}

async function main(): Promise<void> {
// ============ 1. 简单 echo ============
{
  const ctx = buildCtx({ hello: 'world', n: 42 });
  const r = (await rt.run(
    `module.exports = async function(ctx) {
       return { echoed: ctx.input, who: ctx.userInfo.username };
     };`,
    ctx,
  )) as { echoed: { hello: string; n: number }; who: string };
  check(
    'echo',
    r?.echoed?.hello === 'world' && r?.echoed?.n === 42 && r.who === 'tester',
    JSON.stringify(r),
  );
}

// ============ 2. RPC 往返 ============
{
  const ctx = buildCtx({});
  const r = (await rt.run(
    `module.exports = async function(ctx) {
       const a = await ctx.client.models.users.filter({ pageSize: 5 });
       const b = await ctx.client.sql.execute('q1', { x: 1 });
       return { a, b };
     };`,
    ctx,
  )) as { a: { rows: unknown[] }; b: { sqlCode: string; ran: boolean } };
  check(
    'rpc roundtrip',
    r?.a?.rows?.length === 2 && r?.b?.sqlCode === 'q1' && r?.b?.ran === true,
    JSON.stringify(r).slice(0, 100),
  );
}

// ============ 3. 进程隔离：sandbox 内拿 process（应失败 —— vm 没暴露） ============
{
  const ctx = buildCtx({});
  const r = (await rt.run(
    `module.exports = function() {
       try {
         const F = ({}).constructor.constructor;
         const proc = F('return process')();
         return { workerPid: proc && proc.pid, hasProcess: !!proc };
       } catch (e) {
         return { err: e.message };
       }
     };`,
    ctx,
  )) as { workerPid?: number; hasProcess?: boolean; err?: string };
  // sandbox 内 ({}).constructor.constructor 走的是 sandbox 自己的 Function realm，
  // 不是子进程 host realm —— 拿不到 process。pid 应是 undefined / hasProcess=false
  check(
    'sandbox can not see process via inner walk',
    !r.workerPid && !r.hasProcess,
    `workerPid=${r.workerPid} hasProcess=${r.hasProcess}`,
  );
}

// ============ 3b. 真攻击路径：通过 ctx.client.*（host fn）走 ============
//   ctx.client.models.users.filter 是子进程 host realm 的函数（IPC stub）；
//   .constructor.constructor 拿到子进程 host realm 的 Function；
//   F('return process')() 拿到的是 **子进程的 process**，pid 跟主进程不同。
//   即使能拿到 require，子进程没 DB 凭据、没 Prisma 实例、env 里没 JWT_SECRET。
{
  const ctx = buildCtx({});
  const r = (await rt.run(
    `module.exports = function(ctx) {
       try {
         const F = ctx.client.models.users.filter.constructor.constructor;
         const proc = F('return process')();
         return {
           childPid: proc.pid,
           hasJwtSecret: !!proc.env.JWT_SECRET,
           hasEncryptKey: !!(proc.env.ENCRYPTION_KEY || proc.env.SESSION_SECRET),
           hasOnlyInMain: !!proc.env.ONLY_IN_MAIN,
           hasRequire: typeof require,
         };
       } catch (e) {
         return { err: e.message };
       }
     };`,
    ctx,
  )) as {
    childPid: number;
    hasJwtSecret: boolean;
    hasEncryptKey: boolean;
    hasOnlyInMain: boolean;
    hasRequire: string;
  };
  check(
    'child process pid != main pid (real isolation)',
    typeof r.childPid === 'number' && r.childPid !== MAIN_PID,
    `child=${r.childPid} main=${MAIN_PID}`,
  );
  check(
    'child process env: no JWT_SECRET / ENCRYPTION_KEY / ONLY_IN_MAIN',
    !r.hasJwtSecret && !r.hasEncryptKey && !r.hasOnlyInMain,
    `jwt=${r.hasJwtSecret} enc=${r.hasEncryptKey} onlyInMain=${r.hasOnlyInMain}`,
  );
}

// ============ 4. 超时 terminate（用攻击路径拿 worker setTimeout）============
{
  const ctx = buildCtx({});
  const t0 = Date.now();
  let caught: Error | null = null;
  try {
    await rt.run(
      `module.exports = async function(ctx) {
         // 通过攻击路径拿 worker realm 的 setTimeout（vm sandbox 里没暴露）
         const F = ctx.client.models.users.filter.constructor.constructor;
         const setTimeoutHost = F('return setTimeout')();
         await new Promise((r) => setTimeoutHost(r, 30000));
         return 'never';
       };`,
      ctx,
      1500,
    );
  } catch (e) {
    caught = e as Error;
  }
  const elapsed = Date.now() - t0;
  check(
    'timeout terminate',
    caught != null && /timeout/i.test(caught.message) && elapsed < 3000,
    `${elapsed}ms err=${caught?.message ?? 'none'}`,
  );
}

// ============ 5. 用户代码语法错 ============
{
  const ctx = buildCtx({});
  let caught: Error | null = null;
  try {
    await rt.run(`module.exports = function( {{{ broken syntax`, ctx);
  } catch (e) {
    caught = e as Error;
  }
  check(
    'syntax error caught',
    caught != null && /syntax|parse|unexpected/i.test(caught.message),
    caught?.message.slice(0, 80),
  );
}

// ============ 6. 用户代码 throw ============
{
  const ctx = buildCtx({});
  let caught: Error | null = null;
  try {
    await rt.run(`module.exports = function() { throw new Error('boom'); };`, ctx);
  } catch (e) {
    caught = e as Error;
  }
  check('user throw caught', caught != null && /boom/.test(caught.message), caught?.message);
}

// ============ 6b. Pool 复用：连跑 5 次 echo 应明显比第一次冷启动快 ============
{
  const ctx = buildCtx({});
  const t1 = Date.now();
  const r1 = (await rt.run(
    `module.exports = function() { return { ok: true }; };`,
    ctx,
  )) as { ok: boolean };
  const dur1 = Date.now() - t1;

  // 连续跑 5 次（pool 已有 hot worker，应该都很快）
  const durs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await rt.run(`module.exports = function() { return { i: ${i} }; };`, buildCtx({}));
    durs.push(Date.now() - t);
  }
  const avg = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
  check(
    'pool reuse: avg < 50ms',
    r1.ok === true && avg < 50,
    `cold(or hot)=${dur1}ms hot avg=${avg}ms (each: ${durs.join('/')})`,
  );
}

// ============ 6c. tx commit ============
{
  callLog.length = 0;
  adapterLog.length = 0;
  const ctx = buildCtx({});
  await rt.run(
    `module.exports = async function(ctx) {
       await ctx.client.tx(async () => {
         await ctx.client.models.users.create({ name: 'a' });
         await ctx.client.models.users.update('1', { name: 'b' });
       });
       return 'done';
     };`,
    ctx,
  );
  const adapterUsedForBoth = callLog
    .filter((c) => c.method === 'create' || c.method === 'update')
    .every((c) => c.usedTxAdapter);
  const beganAndCommitted =
    adapterLog.includes('BEGIN') && adapterLog.includes('COMMIT') && adapterLog.includes('CLOSE');
  check(
    'tx commit: BEGIN + COMMIT + adapter passed to inner calls',
    adapterUsedForBoth && beganAndCommitted,
    `calls=${JSON.stringify(callLog)} adapter=${adapterLog.join('/')}`,
  );
}

// ============ 6d. tx rollback when fn throws ============
{
  callLog.length = 0;
  adapterLog.length = 0;
  const ctx = buildCtx({});
  let caught: Error | null = null;
  try {
    await rt.run(
      `module.exports = async function(ctx) {
         await ctx.client.tx(async () => {
           await ctx.client.models.users.create({ name: 'a' });
           throw new Error('intentional');
         });
       };`,
      ctx,
    );
  } catch (e) {
    caught = e as Error;
  }
  const rolledBack = adapterLog.includes('BEGIN') && adapterLog.includes('ROLLBACK');
  const noCommit = !adapterLog.includes('COMMIT');
  check(
    'tx rollback on throw',
    caught != null && rolledBack && noCommit,
    `err=${caught?.message} adapter=${adapterLog.join('/')}`,
  );
}

// ============ 6e1. tx 内 sql.execute 也走 tx adapter ============
{
  callLog.length = 0;
  sqlCallLog.length = 0;
  adapterLog.length = 0;
  const ctx = buildCtx({});
  await rt.run(
    `module.exports = async function(ctx) {
       await ctx.client.tx(async () => {
         await ctx.client.models.users.create({ x: 1 });
         await ctx.client.sql.execute('q-A-stats', { y: 2 });
       });
     };`,
    ctx,
  );
  const sqlInTx = sqlCallLog.every((c) => c.usedTxAdapter);
  check(
    'tx: sql.execute also uses tx adapter',
    sqlInTx && adapterLog.includes('COMMIT'),
    `sqlCalls=${JSON.stringify(sqlCallLog)} adapter=${adapterLog.join('/')}`,
  );
}

// ============ 6e2. tx 内 sql.execute + models 跨 dataSource 拒绝 ============
{
  adapterLog.length = 0;
  const ctx = buildCtx({});
  let caught: Error | null = null;
  try {
    await rt.run(
      `module.exports = async function(ctx) {
         await ctx.client.tx(async () => {
           await ctx.client.models.users.create({ x: 1 }); // ds-A
           await ctx.client.sql.execute('q-B-cross', {});  // ds-B → 拒
         });
       };`,
      ctx,
    );
  } catch (e) {
    caught = e as Error;
  }
  check(
    'tx: sql.execute cross-dataSource rejected',
    caught != null && /cross dataSource/i.test(caught.message),
    caught?.message ?? 'no error',
  );
}

// ============ 6e. tx 跨 dataSource 拒绝 ============
{
  callLog.length = 0;
  adapterLog.length = 0;
  const ctx = buildCtx({});
  // FakeInstantApi.resolveDataSourceId: ds-users → ds-A, orders → ds-B
  // tx 内先调 users 后调 orders 会跨库 → 主进程 handleRpc 抛错
  let caught: Error | null = null;
  try {
    await rt.run(
      `module.exports = async function(ctx) {
         await ctx.client.tx(async () => {
           await ctx.client.models.users.create({ x: 1 });
           await ctx.client.models.orders.create({ y: 2 });
         });
       };`,
      ctx,
    );
  } catch (e) {
    caught = e as Error;
  }
  check(
    'tx cross-dataSource rejected',
    caught != null && /cross dataSource/i.test(caught.message),
    caught?.message ?? 'no error',
  );
}

// ============ 7. RPC 调不存在的 model 应被白名单挡 ============
{
  const ctx = buildCtx({});
  let caught: Error | null = null;
  try {
    await rt.run(
      `module.exports = async function(ctx) {
         return await ctx.client.models.users.eval__('whatever');
       };`,
      ctx,
    );
  } catch (e) {
    caught = e as Error;
  }
  check(
    'whitelist rpc',
    caught != null,
    caught?.message.slice(0, 100) ?? 'unexpectedly succeeded',
  );
}

  console.log(`\n${pass} pass, ${fail} fail`);
  console.log(`(MAIN_SECRET=${MAIN_SECRET} —— 仅作打印参考)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
