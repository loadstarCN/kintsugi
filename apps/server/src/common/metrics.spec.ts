/**
 * 验证 metrics 入口能加载，且在 OTEL 没启动时调用 .add() / .record() 不抛错。
 *
 * 不连真 collector；OTel API 默认 noop provider 会兜住，业务代码的 .add() 调用
 * 不会因为 OTEL_ENABLED=false 而崩溃。这正是 metrics.ts 的设计前提。
 */

import { describe, expect, it } from 'vitest';
import {
  rateLimitHitCounter,
  auditWriteFailCounter,
  llmCallCounter,
  llmTokenCounter,
  bffExecDuration,
  dbConnInFlight,
} from './metrics';

describe('metrics module', () => {
  it('exports all expected counters / histogram / updown', () => {
    expect(typeof rateLimitHitCounter.add).toBe('function');
    expect(typeof auditWriteFailCounter.add).toBe('function');
    expect(typeof llmCallCounter.add).toBe('function');
    expect(typeof llmTokenCounter.add).toBe('function');
    expect(typeof bffExecDuration.record).toBe('function');
    expect(typeof dbConnInFlight.add).toBe('function');
  });

  it('add()/record() are noop-safe when no MeterProvider is registered', () => {
    expect(() => rateLimitHitCounter.add(1, { scope: 'minute', key_kind: 'app' })).not.toThrow();
    expect(() => auditWriteFailCounter.add(1, { tenant: 't1' })).not.toThrow();
    expect(() => llmCallCounter.add(1, { provider: 'deepseek', outcome: 'ok' })).not.toThrow();
    expect(() => llmTokenCounter.add(123, { provider: 'deepseek', kind: 'prompt' })).not.toThrow();
    expect(() => bffExecDuration.record(45, { app: 'app-x', scriptName: 'foo', outcome: 'ok' })).not.toThrow();
    expect(() => dbConnInFlight.add(1, { dialect: 'postgres' })).not.toThrow();
    expect(() => dbConnInFlight.add(-1, { dialect: 'postgres' })).not.toThrow();
  });
});
