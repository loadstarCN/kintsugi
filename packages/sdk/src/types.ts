/**
 * Instant API 契约类型 —— 从 server 的 platform OpenAPI spec 派生。
 *
 * `generated/api-types.ts` 是 `pnpm --filter @kintsugi/sdk gen` 的产物（手动 / prebuild）；
 * 这里只保留同名的 stable alias 让 SDK 公开接口不变，同时确保 server 改字段时
 * 这边类型自动跟着变（不再有手写漂移）。
 */

import type { components, paths } from './generated/api-types';

type Schemas = components['schemas'];

// ---- 直接暴露生成产物，供高级用户用 ----
export type { paths, components };
export type ApiSchemas = Schemas;

// ---- Instant API ----
export type FilterClause = NonNullable<Schemas['FilterRequest']['where']>[number];
export type FilterOp = FilterClause['op'];
export type SortOrder = NonNullable<Schemas['FilterRequest']['orderBy']>[number];
export type FilterRequest = Schemas['FilterRequest'];

export interface FilterResult<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AggregateRequest {
  where?: FilterClause[];
  groupBy?: string[];
  metrics: Array<{
    op: 'count' | 'sum' | 'avg' | 'min' | 'max';
    field?: string;
    alias: string;
  }>;
  limit?: number;
}

export interface AggregateResult<T = Record<string, unknown>> {
  data: T[];
}

// ---- Chats / SQL / BFF ----
export type ChatsAskRequest = Schemas['ChatsAskRequest'];
export type ChatsAskResult = Schemas['ChatsAskResponse'];

export interface BffExecRequest {
  /** app 级 scriptName，ENDPOINT 类型。 */
  scriptName: string;
  payload?: unknown;
}

export interface SqlExecRequest {
  /** 已保存的 sqlCode */
  sqlCode: string;
  params?: Record<string, unknown>;
  /** 默认 human；AI 场景传 'ai' */
  actor?: 'human' | 'ai';
  sqlSafe?: boolean;
}

export type SqlExecResult<T = Record<string, unknown>> =
  Omit<Schemas['SqlExecuteResponse'], 'data'> & { data: T[] | null };

// ---- Auth ----
export type LoginRequest = Schemas['LoginRequest'];
export type LoginResponse = Schemas['LoginResponse'];
export type RegisterRequest = Schemas['RegisterRequest'];
export type Me = Schemas['Me'];

// ---- AccessKey ----
export type AccessKeyPublic = Schemas['AccessKeyPublic'];
export type AccessKeyCreateRequest = Schemas['AccessKeyCreateRequest'];
export type AccessKeyCreateResponse = Schemas['AccessKeyCreateResponse'];
export type AccessKeyRotateResponse = Schemas['AccessKeyRotateResponse'];

// ---- Audit ----
export type AuditEntry = Schemas['AuditEntry'];
