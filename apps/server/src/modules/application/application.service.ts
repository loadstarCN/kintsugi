import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { KintsugiError, paginate, type PageRequest, type PagedResult } from '@kintsugi/shared';

export interface ApplicationSummary {
  appCode: string;
  tenantCode: string;
  name: string;
  description: string | null;
  environment: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantCode?: string,
    pageReq: PageRequest = {},
  ): Promise<PagedResult<ApplicationSummary>> {
    const { take, skip, page, pageSize } = paginate(pageReq, { defaultPageSize: 50 });
    const where = tenantCode ? { tenantCode } : {};
    const [data, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take,
        skip,
        select: {
          appCode: true,
          tenantCode: true,
          name: true,
          description: true,
          environment: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.application.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async get(appCode: string): Promise<ApplicationSummary> {
    const app = await this.prisma.application.findUnique({
      where: { appCode },
      select: {
        appCode: true,
        tenantCode: true,
        name: true,
        description: true,
        environment: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!app) throw new KintsugiError('NOT_FOUND', `Application ${appCode} not found`);
    return app;
  }

  /**
   * 创建 application。
   * tenantCode 必须由调用方传入（来自 JWT，不能从 body 取）—— 防止跨租户创建。
   */
  async create(input: {
    tenantCode: string;
    appCode: string;
    name: string;
    description?: string;
    environment?: 'production' | 'daily' | 'development';
  }): Promise<ApplicationSummary> {
    try {
      return await this.prisma.application.create({
        data: {
          appCode: input.appCode,
          tenantCode: input.tenantCode,
          name: input.name,
          description: input.description ?? null,
          environment: input.environment ?? 'development',
        },
        select: {
          appCode: true,
          tenantCode: true,
          name: true,
          description: true,
          environment: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new KintsugiError('CONFLICT', `appCode '${input.appCode}' already exists`);
      }
      throw err;
    }
  }
}
