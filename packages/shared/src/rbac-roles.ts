/**
 * Kintsugi 角色与权限的单一事实源（single source of truth）。
 *
 * 这里同时定义：
 *   1. 后端实际使用的所有 @Permission 资源（KNOWN_PERMISSIONS）
 *   2. 标准预置角色（STANDARD_ROLES）—— bootstrap-demo 用来 seed，前端帮助页用来渲染矩阵
 *
 * 修改流程：在 controller 上加一个新的 @Permission(...) 时，**必须**：
 *   - 把对应 resource:action 加进 KNOWN_PERMISSIONS
 *   - 评估该权限属于平台级 or 租户级，加进相应角色的 grants
 *   - 跑 `pnpm --filter @kintsugi/server bootstrap:demo` 让 demo 租户的 role grants 同步
 *
 * 启动时 server 会拿 KNOWN_PERMISSIONS 做 sanity check（见 rbac.bootstrap.ts），
 * 实际代码里 @Permission 用了表里没有的 key 会打 warning。
 */

/** 资源:动作字面量（不含 `<app>:` 前缀；前缀在 PermissionGuard 里拼）。 */
export type PermissionKey = `${string}:${string}`;

/** 后端实际声明过的所有 @Permission resource:action。 */
export const KNOWN_PERMISSIONS = [
  // 平台级（跨租户运营）
  'admin:read', // trial 申请列表（GET /api/admin/trials）+ billing 升级请求列表
  'admin:write', // trial 审批（approve/reject）+ billing 升级审批

  // 租户级 - 顶层组织
  'application:write', // 在自己租户里新建 / 删 application

  // 租户级 - 建模 / 扩展
  'datasource:write', // 建数据源 / 编辑 / 删除 / 测试 / 触发扫描
  'dataset:read',
  'dataset:write', // 改 DO / 业务名 / 字段角色
  'page:write', // AI 生成页 / 重新生成 / 保存源码 / 发布
  'sql:write', // Custom SQL CRUD
  'sql:exec', // Custom SQL 执行
  'bff:write', // BFF 脚本 CRUD
  'bff:exec', // BFF 脚本调用

  // 租户级 - 运维 / 审计
  'asset:read', // 资产导出（zip 下载）
  'asset:write', // 资产导入
  'audit:read', // 审计日志查询 / 导出
  'webhook:read', // 看 webhook 订阅 / 投递历史
  'webhook:write', // 创建 / 启用切换 / 删除 webhook
  'accessKey:read', // 看 API key 列表
  'accessKey:write', // 创建 / 旋转 / 删除 API key

  // 租户级 - RBAC 自管
  'rbac:read', // 看角色列表
  'rbac:write', // 建角色 / 绑用户
] as const satisfies ReadonlyArray<PermissionKey>;

export type KnownPermission = (typeof KNOWN_PERMISSIONS)[number];

/** 平台级 grants —— 持有这些就能跨租户操作（仅 platform-admin 应该有）。 */
export const PLATFORM_LEVEL_PERMISSIONS = ['admin:read', 'admin:write'] as const satisfies ReadonlyArray<KnownPermission>;

/** 权限等级（grant 的 tier）。
 *  - platform：跨租户运营（仅 platform-admin 持有）
 *  - tenant：本租户内自管
 *  规则：caller 自己手上的 grants 必须能覆盖（含通配符匹配）他要授的每条 grant，
 *        否则不允许建 / 绑该角色。这条规则隐含 "等级不可越级"。
 */
export type GrantTier = 'platform' | 'tenant';

/** 给定 `<app>:resource:action` 字符串，返回它的 tier。
 *  规则：grant 通过通配符匹配能覆盖到任何 PLATFORM_LEVEL_PERMISSIONS → platform；否则 tenant。
 *  这样 `*:*:*` 因为能覆盖 `admin:write` 也归 platform。 */
export function tierOfGrant(grant: string): GrantTier {
  const parts = grant.split(':');
  if (parts.length !== 3) return 'tenant';
  const [, gRes, gAct] = parts;
  for (const platKey of PLATFORM_LEVEL_PERMISSIONS) {
    const [pRes, pAct] = platKey.split(':');
    const resMatch = gRes === '*' || gRes === pRes;
    const actMatch = gAct === '*' || gAct === pAct;
    if (resMatch && actMatch) return 'platform';
  }
  return 'tenant';
}

/** 简单的 grant 通配符匹配（与 rbac.service.ts 的 userHasPermission 规则一致）。
 *  caller 的 grants 是否覆盖目标 grant：包含 `*:*:*` / 严格相等 / 任一段为通配。 */
export function callerCanGrant(callerGrants: ReadonlyArray<string>, target: string): boolean {
  if (callerGrants.includes('*:*:*')) return true;
  if (callerGrants.includes(target)) return true;
  const [a, r, c] = target.split(':');
  if (!a || !r || !c) return false;
  const variants = [
    `*:${r}:${c}`,
    `${a}:*:${c}`,
    `${a}:${r}:*`,
    `*:*:${c}`,
    `${a}:*:*`,
    `*:${r}:*`,
  ];
  return variants.some((v) => callerGrants.includes(v));
}

export interface RoleSpec {
  name: string;
  description: string;
  /** `<app>:resource:action`；用 `*` 当 wildcard。 */
  grants: string[];
}

const TENANT_LEVEL_GRANTS: ReadonlyArray<string> = KNOWN_PERMISSIONS
  .filter((k) => !(PLATFORM_LEVEL_PERMISSIONS as readonly string[]).includes(k))
  .map((k) => `*:${k}`);

/**
 * 平台级角色 (`*:*:*`，含 admin:read/write 用于跨租户 trial 审批等) 的预制 grants。
 *
 * **不**列入 STANDARD_ROLES —— Role 必须挂某个 tenantCode，把它实例化到普通租户里
 * 等于让该租户的 admin 看到一个含平台权限的角色（即便绑不上，曝露本身就是设计味道）。
 * 平台运营场景需要时由 root 单独 SQL 建到平台方专属租户，不走 bootstrap-demo。
 */
export const PLATFORM_ADMIN_GRANTS: ReadonlyArray<string> = ['*:*:*'];

export const STANDARD_ROLES: ReadonlyArray<RoleSpec> = [
  {
    // 租户超管：本租户内全部 grants，**不含 admin**（不能审批别家 trial）。
    // 列举每条 grant 而不是 *:*:*，让"什么是租户级权限"成为可读的契约。
    name: 'tenant-admin',
    description:
      'Tenant-level super admin (full grants in this tenant; explicitly excludes platform admin).',
    grants: [...TENANT_LEVEL_GRANTS],
  },
  {
    name: 'developer',
    description:
      'Modeler + extension developer (datasource / dataset / page / SQL / BFF / API key).',
    grants: [
      '*:datasource:write',
      '*:dataset:write',
      '*:page:write',
      '*:sql:write',
      '*:sql:exec',
      '*:bff:write',
      '*:bff:exec',
      '*:accessKey:read',
      '*:accessKey:write',
    ],
  },
  {
    name: 'operator',
    description:
      'Ops + auditor (audit log, webhook, asset transfer, API key inspection).',
    grants: [
      '*:asset:read',
      '*:asset:write',
      '*:audit:read',
      '*:webhook:read',
      '*:webhook:write',
      '*:accessKey:read',
    ],
  },
];
