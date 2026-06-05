/**
 * WebhookService 重试 + DLQ 行为。
 *
 * 不连真 RDS；mock Prisma 的 webhookSub / webhookDelivery；mock fetch。
 * 重点验证：
 *  - 成功 → status=success，attempts++
 *  - 失败 → attempts++，nextAttemptAt 走退避序列
 *  - 第 5 次失败 → status=dead_lettered
 *  - 订阅 disabled → 直接 DLQ
 *  - 退避时间随 attempts 递增
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { WebhookService } from './webhook.service';

interface MockSub {
  id: string;
  url: string;
  secretCipher: string;
  enabled: boolean;
}

interface MockDelivery {
  id: string;
  subId: string;
  event: string;
  status: 'pending' | 'success' | 'dead_lettered';
  attempts: number;
  nextAttemptAt: Date | null;
  payloadJson: object;
  lastHttpStatus: number | null;
  lastResponse: string | null;
  lastErrorMsg: string | null;
  lastDurationMs: number | null;
  sub: { url: string; secretCipher: string; enabled: boolean };
}

const ENC_KEY = 'test-encryption-key-32-bytes-min-XXXXXX';

function makePrisma(state: {
  subs?: MockSub[];
  deliveries?: MockDelivery[];
}) {
  const subs = state.subs ?? [];
  const deliveries = state.deliveries ?? [];
  return {
    webhookSub: {
      findMany: vi.fn().mockImplementation(async () => subs.filter((s) => s.enabled)),
      create: vi.fn().mockImplementation(async ({ data }: { data: MockSub }) => {
        const id = `sub-${subs.length + 1}`;
        subs.push({ ...data, id, enabled: true });
        return { id };
      }),
    },
    webhookDelivery: {
      findMany: vi.fn().mockImplementation(
        async ({ where, take }: { where?: { status?: string; nextAttemptAt?: { lte: Date } }; take?: number }) => {
          const now = Date.now();
          const due = deliveries
            .filter((d) =>
              (!where?.status || d.status === where.status) &&
              (!where?.nextAttemptAt?.lte || (d.nextAttemptAt && d.nextAttemptAt.getTime() <= now)),
            )
            .slice(0, take ?? 1000);
          return due.map((d) => ({ id: d.id }));
        },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Partial<MockDelivery> }) => {
        const id = `dlv-${deliveries.length + 1}`;
        const sub = subs.find((s) => s.id === data.subId);
        if (!sub) throw new Error('sub not found');
        const d: MockDelivery = {
          id,
          subId: data.subId!,
          event: data.event!,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: data.nextAttemptAt ?? null,
          payloadJson: data.payloadJson ?? {},
          lastHttpStatus: null,
          lastResponse: null,
          lastErrorMsg: null,
          lastDurationMs: null,
          sub: { url: sub.url, secretCipher: sub.secretCipher, enabled: sub.enabled },
        };
        deliveries.push(d);
        return { id };
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        const found = deliveries.find((d) => d.id === where.id);
        if (!found) return null;
        // 真 DB 返回的是行快照，不是 live reference。这里浅拷贝模拟，
        // 否则两个并发 deliverOnce 共享同一对象，A 的 updateMany 写完
        // B 才读 d.nextAttemptAt 会看到已被 mutate 的值（race window 假阴）。
        return { ...found, sub: { ...found.sub } };
      }),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string; attempts?: number }; data: Partial<MockDelivery> }) => {
          const d = deliveries.find((x) => x.id === where.id);
          if (!d) throw new Error('not found');
          if (where.attempts !== undefined && d.attempts !== where.attempts) {
            // 乐观锁失败
            const err = new Error('P2025') as Error & { code: string };
            err.code = 'P2025';
            throw err;
          }
          Object.assign(d, data);
          return d;
        },
      ),
      updateMany: vi.fn().mockImplementation(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string; nextAttemptAt?: Date | null };
          data: Partial<MockDelivery>;
        }) => {
          const d = deliveries.find((x) => x.id === where.id);
          if (!d) return { count: 0 };
          if (where.status !== undefined && d.status !== where.status) return { count: 0 };
          if (where.nextAttemptAt !== undefined) {
            const want = where.nextAttemptAt?.getTime() ?? null;
            const got = d.nextAttemptAt?.getTime() ?? null;
            if (want !== got) return { count: 0 };
          }
          Object.assign(d, data);
          return { count: 1 };
        },
      ),
    },
    _state: { subs, deliveries },
  };
}

const fetchMock = vi.fn();
const ORIGINAL_FETCH = globalThis.fetch;

describe('WebhookService retry + DLQ', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = ENC_KEY;
    // 测试用的假 hostname (hook.example) 不可解析，会被 SSRF guard 直接拒；
    // 这里 bypass。生产路径走真 host 仍然受保护。
    process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'] = 'true';
    fetchMock.mockReset();
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    delete process.env['KINTSUGI_ALLOW_PRIVATE_HOSTS'];
    (globalThis as { fetch: typeof fetch }).fetch = ORIGINAL_FETCH;
  });

  async function setupOneSub() {
    const { encrypt } = await import('../../common/crypto');
    const subs: MockSub[] = [
      { id: 'sub-1', url: 'https://hook.example/x', secretCipher: encrypt('whs_test'), enabled: true },
    ];
    const prisma = makePrisma({ subs });
    const svc = new WebhookService(prisma as never);
    return { svc, prisma };
  }

  it('success on first try → status=success, attempts=1', async () => {
    const { svc, prisma } = await setupOneSub();
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await svc.dispatch('app-x', 'dataset.created', { hello: 'world' });
    // 等微任务把 deliverOnce 跑完
    await new Promise((r) => setTimeout(r, 30));
    const d = prisma._state.deliveries[0]!;
    expect(d.status).toBe('success');
    expect(d.attempts).toBe(1);
    expect(d.lastHttpStatus).toBe(200);
    expect(d.nextAttemptAt).toBeNull();
  });

  it('sends X-Kintsugi-Delivery-Id header for receiver-side dedup', async () => {
    const { svc, prisma } = await setupOneSub();
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await svc.dispatch('app-x', 'dataset.created', { hello: 'world' });
    await new Promise((r) => setTimeout(r, 30));
    const call = fetchMock.mock.calls[0]!;
    const init = call[1] as { headers: Record<string, string> };
    expect(init.headers['X-Kintsugi-Delivery-Id']).toBeDefined();
    expect(init.headers['X-Kintsugi-Delivery-Id']).toBe(prisma._state.deliveries[0]!.id);
  });

  it('5xx fails → schedules retry with growing backoff', async () => {
    const { svc, prisma } = await setupOneSub();
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }));
    await svc.dispatch('app-x', 'dataset.updated', {});
    await new Promise((r) => setTimeout(r, 30));
    const d = prisma._state.deliveries[0]!;
    expect(d.status).toBe('pending');
    expect(d.attempts).toBe(1);
    expect(d.nextAttemptAt).toBeInstanceOf(Date);
    // attempts=1 失败 → 退避 1m (60_000ms)
    const delta = (d.nextAttemptAt as Date).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThan(70_000);
  });

  it('5 failures → dead_lettered', async () => {
    const { svc, prisma } = await setupOneSub();
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await svc.dispatch('app-x', 'dataset.deleted', {});
    await new Promise((r) => setTimeout(r, 20)); // attempt 1

    // 把 nextAttemptAt 拨到过去模拟 scheduler 唤醒
    const d = prisma._state.deliveries[0]!;
    for (let i = 0; i < 4; i++) {
      d.nextAttemptAt = new Date(Date.now() - 1000);
      await svc.retryPending();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(d.status).toBe('dead_lettered');
    expect(d.attempts).toBe(5);
  });

  it('subscription disabled mid-flight → DLQ on next deliver', async () => {
    const { svc, prisma } = await setupOneSub();
    // 第一次成功不可触发；fetch 设为永不调用
    fetchMock.mockRejectedValue(new Error('network'));
    await svc.dispatch('app-x', 'dataset.deleted', {});
    await new Promise((r) => setTimeout(r, 20));

    // 关闭订阅，模拟管理员撤销
    const d = prisma._state.deliveries[0]!;
    d.sub.enabled = false;
    d.nextAttemptAt = new Date(Date.now() - 1000);
    await svc.retryPending();
    await new Promise((r) => setTimeout(r, 20));
    expect(d.status).toBe('dead_lettered');
  });

  it('retryPending picks only due rows', async () => {
    const { svc, prisma } = await setupOneSub();
    // 写一条成功 + 一条 due pending + 一条未到时间的 pending
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await svc.dispatch('app-x', 'a', {});
    await new Promise((r) => setTimeout(r, 20));
    // 第一条 success
    expect(prisma._state.deliveries[0]!.status).toBe('success');

    // 加一条已 pending 但 nextAttemptAt 在未来的
    prisma._state.deliveries.push({
      id: 'dlv-fut',
      subId: 'sub-1',
      event: 'a',
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60 * 60_000),
      payloadJson: {},
      lastHttpStatus: 500,
      lastResponse: null,
      lastErrorMsg: 'old',
      lastDurationMs: 100,
      sub: prisma._state.subs[0]! as never,
    });
    // 加一条 due
    prisma._state.deliveries.push({
      id: 'dlv-due',
      subId: 'sub-1',
      event: 'a',
      status: 'pending',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() - 1000),
      payloadJson: {},
      lastHttpStatus: 500,
      lastResponse: null,
      lastErrorMsg: 'old',
      lastDurationMs: 100,
      sub: prisma._state.subs[0]! as never,
    });
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    const r = await svc.retryPending();
    await new Promise((rr) => setTimeout(rr, 20));
    expect(r.retried).toBe(1);
    expect(prisma._state.deliveries.find((d) => d.id === 'dlv-due')!.status).toBe('success');
    expect(prisma._state.deliveries.find((d) => d.id === 'dlv-fut')!.status).toBe('pending');
  });

  it('两个实例并发 deliverOnce 同一条 → claim 让第二次 fetch 不发出', async () => {
    const { svc, prisma } = await setupOneSub();
    prisma._state.deliveries.push({
      id: 'dlv-race',
      subId: 'sub-1',
      event: 'race-test',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(Date.now() - 1000),
      payloadJson: { x: 1 },
      lastHttpStatus: null,
      lastResponse: null,
      lastErrorMsg: null,
      lastDurationMs: null,
      sub: prisma._state.subs[0]! as never,
    });
    // fetch 慢一点，模拟 instance B 在 A 还没回来前进 deliverOnce
    fetchMock.mockImplementation(
      () => new Promise((r) => setTimeout(() => r(new Response('ok', { status: 200 })), 50)),
    );
    // svc.retryPending 内部串行；这里**手动并发**调 private deliverOnce 两次模拟双实例
    const deliverOnce = (svc as unknown as { deliverOnce: (id: string) => Promise<unknown> }).deliverOnce.bind(svc);
    await Promise.all([deliverOnce('dlv-race'), deliverOnce('dlv-race')]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 关键：第二次被 claim 拦掉
  });
});
