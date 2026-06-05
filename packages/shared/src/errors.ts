/**
 * Platform-wide error taxonomy.
 * Keep error codes stable — they cross API boundaries and get logged.
 */

export type KintsugiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'BLOCKED_BY_CONCURRENT_EDIT' // 源自原产品 "blocked: true" 协作冲突
  | 'TENANT_ISOLATION_VIOLATED'
  | 'RATE_LIMITED'
  | 'DATASOURCE_UNREACHABLE'
  | 'DATASOURCE_DIALECT_UNSUPPORTED'
  | 'LLM_UPSTREAM_ERROR'
  | 'INSUFFICIENT_CREDIT'
  | 'QUOTA_EXCEEDED'
  | 'INTERNAL';

export class KintsugiError extends Error {
  constructor(
    public readonly code: KintsugiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'KintsugiError';
  }
}

export const notFound = (resource: string, id?: string) =>
  new KintsugiError('NOT_FOUND', id ? `${resource} '${id}' not found` : `${resource} not found`);

export const forbidden = (reason = 'Access denied') => new KintsugiError('FORBIDDEN', reason);

export const validationFailed = (issues: unknown) =>
  new KintsugiError('VALIDATION_FAILED', 'Validation failed', issues);
