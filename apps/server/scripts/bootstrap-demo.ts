/**
 * 一次性 dev bootstrap：建一个 demo tenant + 应用 + 标准角色集 + alice 管理员。
 * 跑法：pnpm --filter @kintsugi/server bootstrap:demo
 *
 * 角色契约来自 packages/shared 的 STANDARD_ROLES（单一事实源）；改角色时改那里。
 *
 * 幂等：
 *   - tenant / application / role 已存在就 reuse；role grants 漂移会被拉回。
 *   - alice 已存在不重置密码；缺角色绑定才补。
 *   - aiCredits 余额低于 INITIAL_AI_CREDITS 才补到该额度。
 */
import { PrismaClient } from '@prisma/client';
import { STANDARD_ROLES } from '@kintsugi/shared';
import * as bcrypt from 'bcryptjs';

const TENANT_CODE = 'demo';
const APP_CODE = 'app-demo0001';
const ADMIN_USERNAME = 'alice';
const ADMIN_EMAIL = 'alice@demo.com';
const ADMIN_DEFAULT_PASSWORD = 'alice123456';
/** 给 demo 租户的 LLM 起步额度（人民币，元）。低于此值才补到此值；
 *  已经超过此值（充过钱 / 已消费但仍 > 阈值）的租户不动。 */
const INITIAL_AI_CREDITS = 1000;
/** alice 默认绑的角色名（来自 STANDARD_ROLES）。 */
const ADMIN_ROLE_NAME = 'tenant-admin';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.upsert({
      where: { tenantCode: TENANT_CODE },
      update: {},
      create: {
        tenantCode: TENANT_CODE,
        tenantName: 'Demo Tenant',
        edition: 'PRO',
        aiCredits: INITIAL_AI_CREDITS,
      },
    });
    console.log('tenant:', tenant.tenantCode);

    // 已存在的 demo 租户：余额低于起步额度才补到起步额度
    // （updateMany + 条件 where 一次查改原子完成，不踩并发竞态）
    const topUp = await prisma.tenant.updateMany({
      where: { tenantCode: TENANT_CODE, aiCredits: { lt: INITIAL_AI_CREDITS } },
      data: { aiCredits: INITIAL_AI_CREDITS },
    });
    if (topUp.count > 0) {
      console.log(`aiCredits: topped up to ${INITIAL_AI_CREDITS}`);
    }

    const app = await prisma.application.upsert({
      where: { appCode: APP_CODE },
      update: {},
      create: {
        appCode: APP_CODE,
        tenantCode: tenant.tenantCode,
        name: 'Goods Demo App',
        description: 'Smoke-test target for DBAgent',
        environment: 'development',
      },
    });
    console.log('application:', app.appCode);

    // 标准角色集：tenant-level（appCode=null），跨租户内所有 app 生效。
    // Role 没有 (tenantCode,name) unique 索引（schema 用 (tenantCode,appCode,name)
    // 三元 unique），所以不能走 upsert，只能 findFirst + create/update。
    // 一次性历史清理：早期 STANDARD_ROLES 含 platform-admin（跨租户角色，但
    // 物理上挂在 demo 租户里），曝露给租户管理员看着不合理。现在已从 STANDARD_ROLES
    // 移除；这里把存量给删掉。要在普通租户绑过它的极少数情况会失去那个角色绑定。
    const legacyToPurge = ['platform-admin', 'qa-superuser'];
    const purged = await prisma.role.findMany({
      where: { tenantCode: tenant.tenantCode, name: { in: legacyToPurge } },
      select: { id: true, name: true },
    });
    for (const r of purged) {
      await prisma.userRole.deleteMany({ where: { roleId: r.id } });
      await prisma.role.delete({ where: { id: r.id } });
      console.log(`role: ${r.name} (purged legacy)`);
    }

    const rolesByName = new Map<string, { id: string }>();
    for (const spec of STANDARD_ROLES) {
      let role = await prisma.role.findFirst({
        where: { tenantCode: tenant.tenantCode, appCode: null, name: spec.name },
      });
      if (!role) {
        role = await prisma.role.create({
          data: {
            tenantCode: tenant.tenantCode,
            appCode: null,
            name: spec.name,
            description: spec.description,
            permissions: { grants: spec.grants },
          },
        });
        console.log(`role: ${role.name} (created, ${spec.grants.length} grants)`);
      } else {
        const current = (role.permissions as unknown as { grants?: string[] }) ?? {};
        const sameSet =
          (current.grants ?? []).length === spec.grants.length &&
          spec.grants.every((g) => current.grants?.includes(g));
        const sameDesc = (role.description ?? '') === spec.description;
        if (!sameSet || !sameDesc) {
          role = await prisma.role.update({
            where: { id: role.id },
            data: {
              permissions: { grants: spec.grants },
              description: spec.description,
            },
          });
          const what = !sameSet
            ? `grants synced to ${spec.grants.length}${!sameDesc ? ' + description' : ''}`
            : 'description synced';
          console.log(`role: ${role.name} (${what})`);
        } else {
          console.log(`role: ${role.name} (reused)`);
        }
      }
      rolesByName.set(spec.name, { id: role.id });
    }

    const adminRole = rolesByName.get(ADMIN_ROLE_NAME);
    if (!adminRole) {
      throw new Error(`${ADMIN_ROLE_NAME} role missing — bootstrap inconsistent`);
    }

    // alice 默认管理员；只在新建时设密码，存量记录的 passwordHash 不动
    let admin = await prisma.user.findUnique({
      where: { tenantCode_username: { tenantCode: tenant.tenantCode, username: ADMIN_USERNAME } },
    });
    if (!admin) {
      admin = await prisma.user.create({
        data: {
          tenantCode: tenant.tenantCode,
          username: ADMIN_USERNAME,
          email: ADMIN_EMAIL,
          passwordHash: await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10),
        },
      });
      console.log(`user: ${admin.username} (created, default password = ${ADMIN_DEFAULT_PASSWORD})`);
    } else {
      console.log('user:', admin.username, '(reused)');
    }

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
      create: { userId: admin.id, roleId: adminRole.id },
      update: {},
    });
    console.log(`bound: ${admin.username} -> ${ADMIN_ROLE_NAME}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
