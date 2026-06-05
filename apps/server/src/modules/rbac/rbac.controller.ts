import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { KintsugiError, callerCanGrant, tierOfGrant } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from './rbac.service';
import { Permission } from './permission.decorator';
import type { JwtPayload } from '../auth/auth.service';

interface ReqWithUser {
  user?: JwtPayload;
  accessKeyCtx?: { appCode: string; tenantCode: string; createdBy: string | null };
}

class CreateRoleDto {
  @IsOptional() @IsString() appCode?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() @IsString({ each: true }) grants!: string[];
}

class AssignRoleDto {
  @IsString() userId!: string;
  @IsString() roleId!: string;
}

/**
 * RBAC 管理面。所有写操作都要 `*:rbac:write`（实际只有 `*:*:*` 的 super admin 通过），
 * 且 tenantCode / 资源归属在 server 端从 JWT 推导，**不接受请求体携带的 tenantCode**——
 * 否则任意已登录用户都能在他人租户里创建 `*:*:*` 角色。
 *
 * accessKey 路径不走这里（HMAC 没有 user 上下文）。
 */
@Controller('rbac')
export class RbacController {
  constructor(
    private readonly svc: RbacService,
    private readonly prisma: PrismaService,
  ) {}

  @Permission('rbac:read')
  @Get('roles')
  listRoles(@Req() req: ReqWithUser, @Query('appCode') appCode?: string) {
    const tenantCode = requireTenant(req);
    return this.svc.listRoles(tenantCode, appCode);
  }

  @Permission('rbac:write')
  @Post('roles')
  async createRole(@Req() req: ReqWithUser, @Body() body: CreateRoleDto) {
    const tenantCode = requireTenant(req);
    if (body.appCode !== undefined) {
      // 防御：appCode 必须属于本租户
      const app = await this.prisma.application.findUnique({
        where: { appCode: body.appCode },
        select: { tenantCode: true },
      });
      if (!app || app.tenantCode !== tenantCode) {
        throw new KintsugiError('NOT_FOUND', `Application ${body.appCode} not found`);
      }
    }
    // 防越权（privilege attenuation）：caller 想授的每条 grant，自己手上必须能覆盖。
    // 这条规则隐含等级 —— tenant-admin 拿不到 *:admin:write，就不能造一个含
    // *:admin:write 的角色，更不可能由此提权成 platform-admin。
    await this.assertCanGrantAll(req.user!.sub, body.grants);
    return this.svc.createRole({
      tenantCode,
      ...(body.appCode !== undefined ? { appCode: body.appCode } : {}),
      name: body.name,
      ...(body.description !== undefined ? { description: body.description } : {}),
      permissions: { grants: body.grants },
    });
  }

  @Permission('rbac:write')
  @Post('assign')
  async assign(@Req() req: ReqWithUser, @Body() body: AssignRoleDto) {
    const tenantCode = requireTenant(req);
    // 双向租户校验：user 与 role 都必须在本租户。
    // assignRole 内部还有一次 user.tenantCode === role.tenantCode 检查，作为 defense-in-depth。
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: body.userId },
        select: { tenantCode: true },
      }),
      this.prisma.role.findUnique({
        where: { id: body.roleId },
        select: { tenantCode: true, permissions: true },
      }),
    ]);
    if (!user || user.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `User ${body.userId} not found`);
    }
    if (!role || role.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `Role ${body.roleId} not found`);
    }
    // 同 createRole：caller 不能把自己手上没有的 grant 通过角色绑定外授。
    // 否则 tenant-admin 直接把 platform-admin 角色绑给自己/任何人 = 提权。
    const targetGrants =
      ((role.permissions as unknown as { grants?: string[] }) ?? {}).grants ?? [];
    await this.assertCanGrantAll(req.user!.sub, targetGrants);
    return this.svc.assignRole(body.userId, body.roleId);
  }

  @Permission('rbac:read')
  @Get('users/:userId/grants')
  async grants(@Req() req: ReqWithUser, @Param('userId') userId: string) {
    const tenantCode = requireTenant(req);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tenantCode: true },
    });
    if (!user || user.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `User ${userId} not found`);
    }
    return this.svc.grantsOfUser(userId);
  }

  /** 列本租户所有用户 + 已绑角色（给"角色管理"UI 用）。
   *  规模假设：单租户 user 数 < 数千，不分页；超规模再加 keyword/page。 */
  @Permission('rbac:read')
  @Get('users')
  async listUsers(@Req() req: ReqWithUser) {
    const tenantCode = requireTenant(req);
    const users = await this.prisma.user.findMany({
      where: { tenantCode },
      select: {
        id: true,
        username: true,
        email: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      roles: u.roles.map((ur) => ur.role),
    }));
  }

  /** 解绑用户角色。 */
  @Permission('rbac:write')
  @Delete('assign')
  async unassign(@Req() req: ReqWithUser, @Body() body: AssignRoleDto) {
    const tenantCode = requireTenant(req);
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: body.userId }, select: { tenantCode: true } }),
      this.prisma.role.findUnique({ where: { id: body.roleId }, select: { tenantCode: true } }),
    ]);
    if (!user || user.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `User ${body.userId} not found`);
    }
    if (!role || role.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `Role ${body.roleId} not found`);
    }
    await this.prisma.userRole.deleteMany({
      where: { userId: body.userId, roleId: body.roleId },
    });
    return { ok: true };
  }

  /**
   * Privilege Attenuation 守卫：caller 想要授出的每条 grant，自己手上的 grants 必须能覆盖
   * （含通配符匹配）。否则抛 FORBIDDEN，错误信息里点名第一条越权 grant + 它的 tier。
   *
   * 用在 createRole / assignRole 两处。任何"通过 RBAC 间接授权"的新接口都得过这个闸。
   */
  private async assertCanGrantAll(callerUserId: string, requested: string[]): Promise<void> {
    const callerGrants = await this.svc.grantsOfUser(callerUserId);
    for (const g of requested) {
      if (!callerCanGrant(callerGrants, g)) {
        throw new KintsugiError(
          'FORBIDDEN',
          `cannot grant '${g}' (tier=${tierOfGrant(g)}): caller does not hold this permission`,
          { grant: g, tier: tierOfGrant(g) },
        );
      }
    }
  }
}

function requireTenant(req: ReqWithUser): string {
  const t = req.user?.tenantCode;
  if (!t) {
    // accessKey 路径走不到 RBAC 管理面；这里保险起见直接拒
    throw new KintsugiError('FORBIDDEN', 'rbac requires authenticated user context');
  }
  return t;
}
