import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'kintsugi:permission';

/**
 * 在 controller method 上声明所需 permission（resource:action）。
 *
 * 运行时 PermissionGuard 会拼上 appCode 形成完整 key（`<appCode>:resource:action`），
 * 然后查 RbacService.userHasPermission 校验当前 user.roles 的 grants 是否覆盖。
 *
 * 没有 appCode 上下文（list/create application 等全局接口）时 appCode 自动用 `*`，
 * 所以这种端点只能被持 `*:resource:action` 或 `*:*:*` 的 super admin 通过。
 *
 * Access key 路径（HMAC）已经被 TenantGuard 卡死 ctx.appCode 必须等于请求 appCode，
 * 这里默认放行；如需对 access key 也走 RBAC，要扩 access key schema 加 grants 字段。
 *
 * 例：
 *   @Permission('dataset:write')
 *   @Patch(':datasetCode/do')
 *   updateDoJson(...) { ... }
 *
 * Wildcards 由 RbacService.userHasPermission 内部展开（`*:dataset:*` 等）。
 */
export const Permission = (...keys: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSION_KEY, keys);
