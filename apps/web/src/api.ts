/** 小而稳的 fetch 封装：全走 `/api/*`，统一 JSON 与错误冒泡。 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

/** 401 自动登出：服务端的 httpOnly cookie 已被 logout 清掉，前端只需跳到登录页。
 *  模块级 guard 防止短时间内多次 reload。*/
let authBootedOnce = false;
function handleUnauthorized() {
  if (authBootedOnce) return;
  authBootedOnce = true;
  // window 全量 reload —— AuthProvider 重新跑 /api/auth/me，拿不到就跳 /login
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 鉴权走 httpOnly cookie，浏览器自动携带（同源）。
  // 不再读 localStorage 也不再注入 Authorization header —— XSS 拿不到 token。
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = await parseBody(res);
  if (!res.ok) {
    // 401：token 失效，清掉并跳登录
    if (res.status === 401) {
      handleUnauthorized();
    }
    // 提取后端给的 message
    const backendMsg =
      typeof body === 'object' && body !== null && 'message' in (body as Record<string, unknown>)
        ? String((body as { message: unknown }).message)
        : null;
    // 5xx：不把后端 stack / SQL / 内部错误回显到 UI，统一吞成"服务器开小差了"。
    // 原始 body 仍挂在 ApiError.body 上方便控制台调试。
    let userMsg: string;
    if (res.status >= 500) {
      userMsg = '服务器开小差了，请稍后重试';
      if (backendMsg && typeof console !== 'undefined') {
        console.warn(`[api] ${res.status} ${path}: ${backendMsg}`);
      }
    } else {
      userMsg = backendMsg ?? `HTTP ${res.status}`;
    }
    throw new ApiError(userMsg, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, json?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: json ? JSON.stringify(json) : undefined }),
  patch: <T>(path: string, json?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: json ? JSON.stringify(json) : undefined }),
  put: <T>(path: string, json?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: json ? JSON.stringify(json) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

// ---- 与后端契约保持一致的响应类型 ----

export interface ApplicationSummary {
  appCode: string;
  tenantCode: string;
  name: string;
  description: string | null;
  environment: string;
  createdAt: string;
  updatedAt: string;
}

export type DialectId = 'postgres' | 'mysql' | 'mssql' | 'oracle' | 'sqlite' | 'mariadb' | 'tidb';

export interface DataSourcePublic {
  id: string;
  appCode: string;
  dialect: DialectId;
  displayName: string;
  host: string;
  port: number;
  database: string;
  schema: string | null;
  username: string;
  sslMode: string | null;
  createdAt: string;
  updatedAt: string;
  lastScanAt: string | null;
  lastScanStatus: 'pending' | 'scanning' | 'succeeded' | 'failed';
}

export interface ScanJobSummary {
  id: string;
  status: 'pending' | 'scanning' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  tokensUsed: number | null;
  errorMessage: string | null;
}

export interface ScanJobDetail extends ScanJobSummary {
  dataSourceId: string;
  rawSnapshot: unknown;
  inferredModel: unknown;
}

export interface DatasetSummary {
  datasetCode: string;
  appCode: string;
  dataSourceId: string;
  tableName: string;
  alias: string;
  version: number;
  updatedAt: string;
}

export type DoFieldRole =
  | 'primaryKey'
  | 'createdAt'
  | 'updatedAt'
  | 'softDelete'
  | 'tenantCode'
  | 'userId'
  | 'version'
  | 'foreignKey'
  | 'unknown';

export interface DoField {
  name: string;
  businessName: string;
  nativeType: string;
  logicalType: string;
  nullable: boolean;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  primaryKeyOrder?: number;
  role?: DoFieldRole;
  enumValues?: string[];
  searchable?: boolean;
  deprecated?: boolean;
  displayFormat?: string;
  comment?: string;
}

export interface DoRelation {
  fromColumns: string[];
  toTable: string;
  toColumns: string[];
  cardinality: 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';
  confidence: number;
  source: 'declared_fk' | 'llm_accept' | 'llm_modify' | 'user_added';
  reason?: string;
}

export interface DoJson {
  version: 1;
  tableName: string;
  alias: string;
  description?: string;
  primaryKey: string[];
  softDeleteField?: string;
  versionField?: string;
  tenantField?: string;
  userField?: string;
  createdAtField?: string;
  updatedAtField?: string;
  fields: DoField[];
  relations: DoRelation[];
}

export interface DatasetDetail {
  datasetCode: string;
  appCode: string;
  dataSourceId: string;
  tableName: string;
  alias: string;
  schemaName: string | null;
  version: number;
  doJson: DoJson;
  updatedAt: string;
}

export type FilterOp =
  | 'eq' | 'ne'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'like' | 'notLike'
  | 'in' | 'notIn'
  | 'isNull' | 'isNotNull'
  | 'between';

export interface FilterRequest {
  where?: Array<{ field: string; op: FilterOp; value?: unknown }>;
  orderBy?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
  page?: number;
  pageSize?: number;
  select?: string[];
  includeDeleted?: boolean;
}

export interface FilterResponse {
  data: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
}

// ---- 通用分页结果 ----

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageRequest {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export function buildPageQuery(extra: Record<string, string | undefined>, p: PageRequest): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  if (p.page) params.set('page', String(p.page));
  if (p.pageSize) params.set('pageSize', String(p.pageSize));
  if (p.keyword) params.set('keyword', p.keyword);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---- Custom SQL / BFF / AssetTransfer 类型 ----

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CustomSqlSummary {
  sqlCode: string;
  appCode: string;
  dataSourceId: string;
  sqlName: string;
  content: string;
  paramsSchema: unknown;
  lastSubmitter: string | null;
  lastSubmittedAt: string;
  createdAt: string;
}

export interface SqlValidateResult {
  riskLevel: RiskLevel;
  placeholders: string[];
}

export interface SqlExecuteResult {
  data: unknown;
  rowCount: number;
  riskLevel: RiskLevel;
  error?: string;
}

export type BffScriptType = 'BEFORE_HOOK' | 'AFTER_HOOK' | 'ENDPOINT' | 'PUBLIC_FUNCTION';

export interface BffScriptSummary {
  id: string;
  appCode: string;
  scriptName: string;
  type: BffScriptType;
  boundDataset: string | null;
  version: number;
  lastSubmitter: string | null;
  lastSubmittedAt: string;
  createdAt: string;
}

export interface AssetImportResult {
  imported: Record<string, number>;
  warnings: string[];
}

export interface CreateDataSourceInput {
  appCode: string;
  dialect: DialectId;
  displayName: string;
  host: string;
  port: number;
  database: string;
  schema?: string;
  username: string;
  password: string;
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}

/** 编辑数据源：appCode / dialect 不允许改；password 留空不动密文。 */
export interface UpdateDataSourceInput {
  displayName?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  username?: string;
  password?: string;
  sslMode?: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}
