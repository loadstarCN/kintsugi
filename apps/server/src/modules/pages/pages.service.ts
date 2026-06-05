import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LlmProvider } from '@kintsugi/llm';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER } from '../../llm/llm.module';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';
import type { DoJson } from '../dataset/do';
import { pageGeneratedCounter } from '../../common/metrics';
import {
  PAGE_GEN_SYSTEM,
  buildPageGenUserMessage,
  type PageGenResult,
  type PageGenSchemaInput,
} from './prompts';

export interface PageSummary {
  id: string;
  appCode: string;
  name: string;
  type: string;
  routePath: string;
  status: string;
  updatedAt: Date;
}

@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** appCode 归属 tenant 校验（tenantCode=null 走 accessKey，已被 TenantGuard 卡死 appCode）。 */
  private async assertAppOwned(appCode: string, tenantCode: string | null): Promise<void> {
    if (tenantCode === null) return;
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: { tenantCode: true },
    });
    if (!app || app.tenantCode !== tenantCode) {
      throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    }
  }

  /** 由 page.id 反查 appCode 后做归属校验（用于 :id 路由）；不存在或跨租户都伪装成 NOT_FOUND。*/
  private async assertPageOwned(pageId: string, tenantCode: string | null): Promise<string> {
    const r = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: { appCode: true },
    });
    if (!r) throw new KintsugiError('NOT_FOUND', `Page ${pageId} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    return r.appCode;
  }

  async list(
    appCode: string,
    pageReq: PageRequest = {},
    tenantCode: string | null = null,
  ): Promise<PagedResult<PageSummary>> {
    await this.assertAppOwned(appCode, tenantCode);
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const kw = pageReq.keyword?.trim();
    const where = {
      appCode,
      ...(kw ? { name: { contains: kw, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.page.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
      this.prisma.page.count({ where }),
    ]);
    const data = rows.map((r) => ({
      id: r.id,
      appCode: r.appCode,
      name: r.name,
      type: String(r.type),
      routePath: r.routePath,
      status: r.status,
      updatedAt: r.updatedAt,
    }));
    return { data, total, page, pageSize };
  }

  async get(
    id: string,
    tenantCode: string | null = null,
  ): Promise<{
    id: string;
    appCode: string;
    name: string;
    type: string;
    routePath: string;
    configJson: unknown;
    status: string;
    sourceFiles: Record<string, string> | null;
    publishedVersion: number | null;
  }> {
    const r = await this.prisma.page.findUnique({
      where: { id },
      include: { reactSubApp: true },
    });
    if (!r) throw new KintsugiError('NOT_FOUND', `Page ${id} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    return {
      id: r.id,
      appCode: r.appCode,
      name: r.name,
      type: String(r.type),
      routePath: r.routePath,
      configJson: r.configJson,
      status: r.status,
      sourceFiles: (r.reactSubApp?.sourceFiles as unknown as Record<string, string> | null) ?? null,
      publishedVersion: r.reactSubApp?.publishedVersion ?? null,
    };
  }

  async saveSource(
    pageId: string,
    sourceFiles: Record<string, string>,
    tenantCode: string | null = null,
  ): Promise<{ version: number }> {
    await this.assertPageOwned(pageId, tenantCode);
    // 防 LLM 输出（或恶意调用）撑爆 Postgres JSON 列：1MB 已经远大于正常单页源码
    const PAGE_SOURCE_MAX = Number(process.env['PAGE_SOURCE_MAX_BYTES'] ?? 1_000_000);
    const serialized = JSON.stringify(sourceFiles);
    if (serialized.length > PAGE_SOURCE_MAX) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        `sourceFiles too large: ${serialized.length} bytes (limit ${PAGE_SOURCE_MAX})`,
      );
    }
    const r = await this.prisma.reactSubApp.upsert({
      where: { pageId },
      create: {
        pageId,
        sourceFiles: sourceFiles as object,
        publishedVersion: null,
      },
      update: { sourceFiles: sourceFiles as object },
      select: { publishedVersion: true },
    });
    return { version: r.publishedVersion ?? 0 };
  }

  async publish(
    pageId: string,
    tenantCode: string | null = null,
  ): Promise<{ version: number }> {
    await this.assertPageOwned(pageId, tenantCode);
    const current = await this.prisma.reactSubApp.findUnique({ where: { pageId } });
    if (!current) throw new KintsugiError('NOT_FOUND', 'no source yet');
    const next = (current.publishedVersion ?? 0) + 1;
    // 包成事务：reactSubApp.publishedVersion 和 page.status 必须同进同退，
    // 中间炸了页面 status 还是 draft 但 version 已经 bump 是脏状态。
    await this.prisma.$transaction([
      this.prisma.reactSubApp.update({
        where: { pageId },
        data: { publishedVersion: next },
      }),
      this.prisma.page.update({
        where: { id: pageId },
        data: { status: 'published', publishedAt: new Date() },
      }),
    ]);
    return { version: next };
  }

  async delete(
    pageId: string,
    tenantCode: string | null = null,
  ): Promise<{ ok: true }> {
    await this.assertPageOwned(pageId, tenantCode);
    await this.prisma.reactSubApp.deleteMany({ where: { pageId } });
    await this.prisma.page.delete({ where: { id: pageId } });
    return { ok: true };
  }

  /**
   * Text-to-Page：把自然语言 + 选定的 datasetCodes → LLM 生成 React 子应用源码 → 写入 Page + ReactSubApp
   */
  async generate(
    args: {
      appCode: string;
      prompt: string;
      datasetCodes?: string[];
      name?: string;
      routePath?: string;
      /** 多模态：截图 / 原型图 URL（可选）；vision 模型才能消费。 */
      imageUrls?: string[];
    },
    tenantCode: string | null = null,
  ): Promise<{ pageId: string; description: string; files: Record<string, string> }> {
    await this.assertAppOwned(args.appCode, tenantCode);
    const { parsed, datasets } = await this.runPageGen({
      appCode: args.appCode,
      prompt: args.prompt,
      datasetCodes: args.datasetCodes,
      ...(args.imageUrls ? { imageUrls: args.imageUrls } : {}),
    });

    const name = args.name ?? (slugify(args.prompt).slice(0, 40) || 'ai-page');
    const routePath = args.routePath ?? `/ai/${name}-${Date.now().toString(36)}`;

    const page = await this.prisma.page.create({
      data: {
        appCode: args.appCode,
        name,
        type: 'ReactSubApp',
        routePath,
        configJson: {
          description: parsed.description,
          prompt: args.prompt,
          datasetCodes: datasets.map((d) => d.datasetCode),
        } as object,
        status: 'draft',
      },
    });
    await this.prisma.reactSubApp.create({
      data: {
        pageId: page.id,
        sourceFiles: parsed.files as object,
      },
    });
    pageGeneratedCounter.add(1, { app: args.appCode, outcome: 'ok' });
    return { pageId: page.id, description: parsed.description, files: parsed.files };
  }

  /**
   * 在原 page 上用同一段 prompt + datasetCodes 重新跑一次 LLM，覆盖 sourceFiles。
   * 用于 prompt 规范升级后批量回刷已有页面（保留 page.id / routePath / publishedVersion 计数）。
   */
  async regenerate(
    pageId: string,
    override?: { prompt?: string; datasetCodes?: string[] },
    tenantCode: string | null = null,
  ): Promise<{ pageId: string; description: string; files: Record<string, string> }> {
    const r = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!r) throw new KintsugiError('NOT_FOUND', `Page ${pageId} not found`);
    await this.assertAppOwned(r.appCode, tenantCode);
    const cfg = (r.configJson as { prompt?: string; datasetCodes?: string[] } | null) ?? null;
    const effectivePrompt = override?.prompt ?? cfg?.prompt;
    const effectiveDatasetCodes = override?.datasetCodes ?? cfg?.datasetCodes;
    if (!effectivePrompt) {
      throw new KintsugiError(
        'VALIDATION_FAILED',
        'PROMPT_REQUIRED: 该页面未保存原始 prompt（旧版本生成）。请在重新生成时提供 prompt 与 datasetCodes。',
      );
    }

    const { parsed, datasets } = await this.runPageGen({
      appCode: r.appCode,
      prompt: effectivePrompt,
      datasetCodes: effectiveDatasetCodes,
    });

    await this.prisma.reactSubApp.upsert({
      where: { pageId },
      create: { pageId, sourceFiles: parsed.files as object, publishedVersion: null },
      update: { sourceFiles: parsed.files as object },
    });
    await this.prisma.page.update({
      where: { id: pageId },
      data: {
        configJson: {
          description: parsed.description,
          prompt: effectivePrompt,
          datasetCodes: datasets.map((d) => d.datasetCode),
        } as object,
      },
    });
    return { pageId, description: parsed.description, files: parsed.files };
  }

  /**
   * 共享路径：拿 datasets → 拼 prompt → 调 LLM → 解析 + 校验。
   * 失败抛 KintsugiError，调用方负责后续落库。
   */
  private async runPageGen(args: {
    appCode: string;
    prompt: string;
    datasetCodes?: string[];
    imageUrls?: string[];
  }): Promise<{
    parsed: PageGenResult;
    datasets: Array<{ datasetCode: string; tableName: string; alias: string; doJson: unknown }>;
  }> {
    const datasets = await this.prisma.dataset.findMany({
      where: {
        appCode: args.appCode,
        isDeleted: false,
        ...(args.datasetCodes?.length ? { datasetCode: { in: args.datasetCodes } } : {}),
      },
      take: 10,
    });
    if (datasets.length === 0) {
      throw new KintsugiError('VALIDATION_FAILED', 'no datasets to reference');
    }

    const input: PageGenSchemaInput = {
      prompt: args.prompt,
      datasets: datasets.map((d) => ({
        datasetCode: d.datasetCode,
        tableName: d.tableName,
        alias: d.alias,
        doJson: d.doJson as unknown as DoJson,
      })),
    };

    // 默认走纯文本路径；如果提供了 imageUrls 则用 multimodal content parts。
    // 注：消费方必须是 vision 模型（DeepSeek-VL / GPT-4o / Qwen-VL 等）；
    // 否则 LLM 会返回 400。生产部署应在 LLM_MODEL 上配 vision 型号。
    const userText = buildPageGenUserMessage(input);
    const userContent: string | Array<
      { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
    > =
      args.imageUrls && args.imageUrls.length > 0
        ? [
            { type: 'text', text: userText },
            ...args.imageUrls.map(
              (u) =>
                ({
                  type: 'image_url',
                  image_url: { url: u, detail: 'high' },
                }) as { type: 'image_url'; image_url: { url: string; detail: 'high' } },
            ),
          ]
        : userText;

    const resp = await this.llm.complete({
      responseFormatJson: true,
      temperature: 0.2,
      timeoutMs: 180_000,
      messages: [
        { role: 'system', content: PAGE_GEN_SYSTEM },
        { role: 'user', content: userContent },
      ],
    });

    if (!resp.content || !resp.content.trim()) {
      throw new KintsugiError('LLM_UPSTREAM_ERROR', 'empty LLM response');
    }
    const raw = resp.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed: PageGenResult;
    try {
      parsed = JSON.parse(raw) as PageGenResult;
    } catch (err) {
      throw new KintsugiError('LLM_UPSTREAM_ERROR', `LLM non-JSON: ${(err as Error).message}`);
    }
    if (!parsed.files || !parsed.files['src/app/index.jsx']) {
      throw new KintsugiError('LLM_UPSTREAM_ERROR', 'LLM did not produce src/app/index.jsx');
    }
    return { parsed, datasets };
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '');
}
