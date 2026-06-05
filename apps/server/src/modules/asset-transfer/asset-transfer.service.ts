import { Injectable, Logger } from '@nestjs/common';
import JSZip from 'jszip';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError } from '@kintsugi/shared';

export interface AppBundle {
  version: 1;
  exportedAt: string;
  app: {
    appCode: string;
    name: string;
    description: string | null;
    environment: string;
  };
  datasets: Array<{
    datasetCode: string;
    tableName: string;
    alias: string;
    schemaName: string | null;
    doJson: unknown;
  }>;
  pages: Array<{
    name: string;
    type: string;
    routePath: string;
    configJson: unknown;
    status: string;
    reactSubApp?: {
      sourceFiles: unknown;
      publishedVersion: number | null;
    };
  }>;
  menus: Array<{ tree: unknown }>;
  bff: Array<{ scriptName: string; type: string; boundDataset: string | null; code: string }>;
  sql: Array<{
    sqlName: string;
    content: string;
    paramsSchema: unknown;
  }>;
  roles: Array<{
    name: string;
    description: string | null;
    permissions: unknown;
  }>;
}

@Injectable()
export class AssetTransferService {
  private readonly logger = new Logger(AssetTransferService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportBundle(
    appCode: string,
    tenantCode: string | null,
  ): Promise<{ zip: Buffer; filename: string }> {
    const app = await this.prisma.application.findUnique({ where: { appCode } });
    if (!app) throw new KintsugiError('NOT_FOUND', `App ${appCode} not found`);
    // 之前完全靠 TenantGuard 卡 appCode；service 层无防御。这里加一道：
    // 跨租户访问 = NOT_FOUND（不暴露目标存在）。tenantCode=null（access-key
    // 路径）放行——上游 TenantGuard 已经按 accessKey.appCode 限定。
    if (tenantCode !== null && app.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `App ${appCode} not found`);
    }

    const [datasets, pages, menus, bff, sql, roles] = await Promise.all([
      this.prisma.dataset.findMany({ where: { appCode, isDeleted: false } }),
      this.prisma.page.findMany({ where: { appCode } }),
      this.prisma.menu.findMany({ where: { appCode } }),
      this.prisma.bffScript.findMany({ where: { appCode } }),
      this.prisma.customSql.findMany({ where: { appCode } }),
      this.prisma.role.findMany({ where: { appCode } }),
    ]);

    // reactSubApp 只能按本 app 的 pageIds 拉，否则会跨租户泄漏其它 app 的源码
    const reactSubApps = pages.length
      ? await this.prisma.reactSubApp.findMany({
          where: { pageId: { in: pages.map((p) => p.id) } },
        })
      : [];

    const subAppById = new Map(reactSubApps.map((r) => [r.pageId, r]));

    const bundle: AppBundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: {
        appCode: app.appCode,
        name: app.name,
        description: app.description,
        environment: String(app.environment),
      },
      datasets: datasets.map((d) => ({
        datasetCode: d.datasetCode,
        tableName: d.tableName,
        alias: d.alias,
        schemaName: d.schemaName,
        doJson: d.doJson,
      })),
      pages: pages.map((p) => {
        const sub = subAppById.get(p.id);
        const base: AppBundle['pages'][number] = {
          name: p.name,
          type: String(p.type),
          routePath: p.routePath,
          configJson: p.configJson,
          status: p.status,
        };
        if (sub) {
          base.reactSubApp = {
            sourceFiles: sub.sourceFiles,
            publishedVersion: sub.publishedVersion,
          };
        }
        return base;
      }),
      menus: menus.map((m) => ({ tree: m.tree })),
      bff: bff.map((b) => ({
        scriptName: b.scriptName,
        type: String(b.type),
        boundDataset: b.boundDataset,
        code: b.code,
      })),
      sql: sql.map((s) => ({
        sqlName: s.sqlName,
        content: s.content,
        paramsSchema: s.paramsSchema,
      })),
      roles: roles.map((r) => ({
        name: r.name,
        description: r.description,
        permissions: r.permissions,
      })),
    };

    const zip = new JSZip();
    zip.file('bundle.json', JSON.stringify(bundle, null, 2));
    // 把 BFF code / SQL content 单独导出成文件，方便审计/diff
    for (const b of bundle.bff) {
      zip.file(`bff/${sanitize(b.scriptName)}.js`, b.code);
    }
    for (const s of bundle.sql) {
      zip.file(`sql/${sanitize(s.sqlName)}.sql`, s.content);
    }
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
    return { zip: buf, filename: `${appCode}-bundle-${Date.now()}.zip` };
  }

  async importBundle(
    targetAppCode: string,
    zipBuf: Buffer,
    opts: { overwrite?: boolean } = {},
    tenantCode: string | null = null,
  ): Promise<{ imported: Record<string, number>; warnings: string[] }> {
    // zip 大小早期拒绝（body parser 已限 4MB；这里再兜一道，避免 zip bomb）
    const MAX_ZIP_BYTES = Number(process.env['ASSET_IMPORT_MAX_BYTES'] ?? 4 * 1024 * 1024);
    if (zipBuf.byteLength > MAX_ZIP_BYTES) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `bundle zip exceeds max ${MAX_ZIP_BYTES} bytes (got ${zipBuf.byteLength})`,
      );
    }

    const zip = await JSZip.loadAsync(zipBuf);
    const bundleFile = zip.file('bundle.json');
    if (!bundleFile) throw new KintsugiError('VALIDATION_FAILED', 'bundle.json missing in zip');
    // 解压后 bundle.json 也要看大小，防 zip bomb 解压后膨胀
    const bundleJson = await bundleFile.async('string');
    if (bundleJson.length > 16 * 1024 * 1024) {
      throw new KintsugiError('VALIDATION_FAILED', 'bundle.json too large after decompression');
    }
    // reviver 拒 __proto__ / constructor / prototype 键，防 JSON 反序列化原型污染
    const bundle = JSON.parse(bundleJson, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    }) as AppBundle;
    if (bundle.version !== 1) {
      throw new KintsugiError('VALIDATION_FAILED', `unsupported bundle version ${bundle.version}`);
    }

    const app = await this.prisma.application.findUnique({ where: { appCode: targetAppCode } });
    if (!app) throw new KintsugiError('NOT_FOUND', `target app ${targetAppCode} not found`);
    if (tenantCode !== null && app.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `target app ${targetAppCode} not found`);
    }

    // 整段 import 包在事务里：任一段失败整体回滚，避免半残数据
    return this.prisma.$transaction(
      async (tx) => {
        const warnings: string[] = [];
        const imported: Record<string, number> = {
          datasets: 0,
          pages: 0,
          menus: 0,
          bff: 0,
          sql: 0,
          roles: 0,
        };

        // datasets（按 tableName upsert，datasetCode 可能冲突则重新生成）
        for (const d of bundle.datasets) {
          const exists = await tx.dataset.findFirst({
            where: { appCode: targetAppCode, tableName: d.tableName },
          });
          if (exists && !opts.overwrite) {
            warnings.push(`skip dataset ${d.tableName} (exists)`);
            continue;
          }
          // 注意：dataSourceId 是目标环境特有，import 时无法自动跨环境映射；需调用方后处理。
          if (exists) {
            await tx.dataset.update({
              where: { datasetCode: exists.datasetCode },
              data: {
                alias: d.alias,
                doJson: d.doJson as object,
                schemaName: d.schemaName,
                version: { increment: 1 },
              },
            });
          } else {
            warnings.push(
              `dataset ${d.tableName}: no dataSourceId set; link manually in target env`,
            );
            continue;
          }
          imported['datasets'] = (imported['datasets'] ?? 0) + 1;
        }

        // BFF
        for (const b of bundle.bff) {
          const ex = await tx.bffScript.findFirst({
            where: { appCode: targetAppCode, scriptName: b.scriptName },
          });
          if (ex && !opts.overwrite) {
            warnings.push(`skip bff ${b.scriptName} (exists)`);
            continue;
          }
          if (ex) {
            await tx.bffScript.update({
              where: { id: ex.id },
              data: {
                type: b.type as never,
                boundDataset: b.boundDataset,
                code: b.code,
                version: { increment: 1 },
                lastSubmittedAt: new Date(),
              },
            });
          } else {
            await tx.bffScript.create({
              data: {
                appCode: targetAppCode,
                scriptName: b.scriptName,
                type: b.type as never,
                boundDataset: b.boundDataset,
                code: b.code,
              },
            });
          }
          imported['bff'] = (imported['bff'] ?? 0) + 1;
        }

        // SQL
        for (const s of bundle.sql) {
          const ex = await tx.customSql.findFirst({
            where: { appCode: targetAppCode, sqlName: s.sqlName },
          });
          if (ex && !opts.overwrite) {
            warnings.push(`skip sql ${s.sqlName} (exists)`);
            continue;
          }
          if (ex) {
            await tx.customSql.update({
              where: { sqlCode: ex.sqlCode },
              data: {
                content: s.content,
                paramsSchema: (s.paramsSchema ?? undefined) as object | undefined,
                lastSubmittedAt: new Date(),
              },
            });
          } else {
            warnings.push(`sql ${s.sqlName}: requires dataSourceId; link manually`);
          }
          imported['sql'] = (imported['sql'] ?? 0) + 1;
        }

        // Roles
        for (const r of bundle.roles) {
          const ex = await tx.role.findFirst({
            where: { tenantCode: app.tenantCode, appCode: targetAppCode, name: r.name },
          });
          if (ex && !opts.overwrite) {
            warnings.push(`skip role ${r.name} (exists)`);
            continue;
          }
          if (ex) {
            await tx.role.update({
              where: { id: ex.id },
              data: {
                description: r.description,
                permissions: r.permissions as object,
              },
            });
          } else {
            await tx.role.create({
              data: {
                tenantCode: app.tenantCode,
                appCode: targetAppCode,
                name: r.name,
                description: r.description,
                permissions: r.permissions as object,
              },
            });
          }
          imported['roles'] = (imported['roles'] ?? 0) + 1;
        }

        // Pages + Menus
        for (const p of bundle.pages) {
          const ex = await tx.page.findFirst({
            where: { appCode: targetAppCode, routePath: p.routePath },
          });
          if (ex && !opts.overwrite) {
            warnings.push(`skip page ${p.routePath} (exists)`);
            continue;
          }
          const pageData = {
            appCode: targetAppCode,
            name: p.name,
            type: p.type as never,
            routePath: p.routePath,
            configJson: p.configJson as object,
            status: p.status,
          };
          let pageId: string;
          if (ex) {
            await tx.page.update({ where: { id: ex.id }, data: pageData });
            pageId = ex.id;
          } else {
            const created = await tx.page.create({ data: pageData });
            pageId = created.id;
          }
          if (p.reactSubApp) {
            await tx.reactSubApp.upsert({
              where: { pageId },
              create: {
                pageId,
                sourceFiles: p.reactSubApp.sourceFiles as object,
                publishedVersion: p.reactSubApp.publishedVersion,
              },
              update: {
                sourceFiles: p.reactSubApp.sourceFiles as object,
                publishedVersion: p.reactSubApp.publishedVersion,
              },
            });
          }
          imported['pages'] = (imported['pages'] ?? 0) + 1;
        }

        for (const m of bundle.menus) {
          await tx.menu.upsert({
            where: { appCode: targetAppCode },
            create: { appCode: targetAppCode, tree: m.tree as object },
            update: { tree: m.tree as object },
          });
          imported['menus'] = (imported['menus'] ?? 0) + 1;
        }

        return { imported, warnings };
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_\-.]/g, '_');
}
