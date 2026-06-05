// 显式 re-export，不要用 `export *` —— Vite 的 esbuild 预打包对 CJS 的 `__exportStar`
// 静态分析失败，会让前端 named import 报"does not provide an export named X"。
// 新增导出时记得在这里加，否则前端 import 会失败。
export {
  brand,
  type AppCode,
  type BffScriptId,
  type Brand,
  type DatasetCode,
  type RoleId,
  type SqlCode,
  type TenantCode,
  type UserId,
} from './brand';
export {
  KintsugiError,
  forbidden,
  notFound,
  validationFailed,
  type KintsugiErrorCode,
} from './errors';
export { newAppCode, newDatasetCode, newSqlCode, randomString } from './id';
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePage,
  paginate,
  type PageRequest,
  type PageResult,
  type PagedResult,
  type PaginationSpec,
} from './pagination';
export {
  KNOWN_PERMISSIONS,
  PLATFORM_LEVEL_PERMISSIONS,
  STANDARD_ROLES,
  callerCanGrant,
  tierOfGrant,
  type GrantTier,
  type KnownPermission,
  type PermissionKey,
  type RoleSpec,
} from './rbac-roles';
