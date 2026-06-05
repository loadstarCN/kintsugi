import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError } from '@kintsugi/shared';

/**
 * 极简 RBAC。
 * Permission key 粒度：`<app|*>:<resource>:<action>`
 *   e.g. 'app-demo0001:dataset:write', 'app-demo0001:sql:exec', '*:tenant:admin'
 *
 * Role.permissions JSON 结构：
 *   { "grants": ["app-demo0001:dataset:write", ...] }
 *
 * 特殊：`*:*:*` 代表租户超级管理员。
 */

const SUPER = '*:*:*';

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async grantsOfUser(userId: string): Promise<string[]> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    if (!u) return [];
    const grants = new Set<string>();
    for (const ur of u.roles) {
      const permissions = (ur.role.permissions as unknown as { grants?: string[] }) ?? {};
      for (const g of permissions.grants ?? []) grants.add(g);
    }
    return [...grants];
  }

  async userHasPermission(userId: string, key: string): Promise<boolean> {
    const grants = await this.grantsOfUser(userId);
    if (grants.includes(SUPER)) return true;
    if (grants.includes(key)) return true;
    // wildcard expansion
    const [app, res, act] = key.split(':');
    const variants = [
      `*:${res}:${act}`,
      `${app}:*:${act}`,
      `${app}:${res}:*`,
      `*:*:${act}`,
      `${app}:*:*`,
      `*:${res}:*`,
    ];
    return variants.some((v) => grants.includes(v));
  }

  async createRole(input: {
    tenantCode: string;
    appCode?: string;
    name: string;
    description?: string;
    permissions: { grants: string[] };
  }): Promise<{ id: string }> {
    return this.prisma.role.create({
      data: {
        tenantCode: input.tenantCode,
        appCode: input.appCode ?? null,
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
      },
      select: { id: true },
    });
  }

  async assignRole(userId: string, roleId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new KintsugiError('NOT_FOUND', `User ${userId} not found`);
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new KintsugiError('NOT_FOUND', `Role ${roleId} not found`);
    if (role.tenantCode !== user.tenantCode) {
      throw new KintsugiError('TENANT_ISOLATION_VIOLATED', 'cross-tenant role assignment refused');
    }
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
    return { ok: true };
  }

  async listRoles(tenantCode: string, appCode?: string): Promise<unknown[]> {
    return this.prisma.role.findMany({
      where: { tenantCode, ...(appCode ? { appCode } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
