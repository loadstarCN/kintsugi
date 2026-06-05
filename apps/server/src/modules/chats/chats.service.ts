import { Injectable, Logger } from '@nestjs/common';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmGateway } from '../../llm/llm-gateway.service';
import { DataSourceService } from '../datasource/datasource.service';
import { chatAskCounter } from '../../common/metrics';
import { guardChatsSql } from './sql-guard';
import type { DoJson } from '../dataset/do';

const CHATS_SYSTEM = `你是一个 SQL 助手。
- 你会拿到多张表的 DO 元数据（表名、字段、中文业务含义）。
- 你的任务：把用户的自然语言问题翻译成 1 条 **只读** SQL（SELECT ... ，不允许 INSERT/UPDATE/DELETE/DDL）。
- 只用提供的表和字段。不许编造字段名。
- 不加 semicolon。最多返回前 200 行（自行加 LIMIT 200）。
- 目标方言：{dialect}。
- 输出必须是合法 JSON：{"sql": "...", "explanation": "中文说明"}。不要 markdown 围栏。`;

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ds: DataSourceService,
    private readonly llm: LlmGateway,
  ) {}

  async ask(args: {
    appCode: string;
    question: string;
    maxTables?: number;
    /** 调用方传入的 user 上下文，用于 PG RLS GUC 注入。无则跳过。 */
    user?: { tenantCode?: string | null; userId?: string | null; deptIds?: string[] };
  }): Promise<{
    sql: string;
    explanation: string;
    data: Array<Record<string, unknown>>;
    rowCount: number;
  }> {
    const labels = {
      app: args.appCode,
      ...(args.user?.tenantCode ? { tenant: args.user.tenantCode } : {}),
    };
    const datasets = await this.prisma.dataset.findMany({
      where: { appCode: args.appCode, isDeleted: false },
      select: { datasetCode: true, tableName: true, alias: true, doJson: true, dataSourceId: true, schemaName: true },
      take: args.maxTables ?? 40,
    });
    if (datasets.length === 0) {
      throw new KintsugiError('VALIDATION_FAILED', 'no datasets for app');
    }

    const dataSourceId = datasets[0]!.dataSourceId;
    const adapter = await this.ds.openAdapter(dataSourceId, args.user
      ? {
          tenantCode: args.user.tenantCode ?? null,
          userId: args.user.userId ?? null,
          deptIds: args.user.deptIds ?? [],
        }
      : undefined);
    try {
      const doSummary = datasets.map((d) => {
        const doJ = d.doJson as unknown as DoJson;
        return {
          table: d.tableName,
          alias: d.alias,
          columns: doJ.fields
            .filter((f) => !f.deprecated)
            .map((f) => ({
              name: f.name,
              type: f.logicalType,
              description: f.businessName,
            })),
          primaryKey: doJ.primaryKey,
        };
      });

      const resp = await this.llm.complete(
        args.user?.tenantCode ?? null,
        'chat',
        {
        responseFormatJson: true,
        temperature: 0,
        timeoutMs: 60_000,
        messages: [
          { role: 'system', content: CHATS_SYSTEM.replace('{dialect}', adapter.id) },
          {
            role: 'user',
            content: [
              '## 数据集',
              JSON.stringify(doSummary),
              '',
              '## 问题',
              args.question,
            ].join('\n'),
          },
        ],
        },
      );
      if (!resp.content || !resp.content.trim()) {
        throw new KintsugiError('LLM_UPSTREAM_ERROR', 'empty LLM response');
      }
      const raw = resp.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let parsed: { sql: string; explanation: string };
      try {
        parsed = JSON.parse(raw) as { sql: string; explanation: string };
      } catch (err) {
        throw new KintsugiError('LLM_UPSTREAM_ERROR', `LLM non-JSON: ${(err as Error).message}`);
      }
      if (!parsed.sql || typeof parsed.sql !== 'string') {
        throw new KintsugiError('LLM_UPSTREAM_ERROR', 'LLM did not produce SQL');
      }
      // 防御纵深 SQL guard：拒多 statement / 必须 SELECT 开头。
      // 主防御仍是 adapter.runReadonly 走 PG READ ONLY 事务（DB 层强制）。
      const cleanSql = guardChatsSql(parsed.sql);

      // 服务端兜底 LIMIT：prompt 要求 LLM 自加 LIMIT 200，但不可靠；
      // 用 derived table 包一层做硬上限。攻击者无法绕过（外层 LIMIT 永远生效）。
      // 原 SQL 自带 LIMIT 时取 min（先执行内层 LIMIT，外层再 cap）。
      const MAX_ROWS = Number(process.env['CHATS_MAX_ROWS'] ?? 200);
      const wrapped = `select * from (${cleanSql}) as __k_lim limit ${MAX_ROWS}`;

      const rows = await adapter.runReadonly<Record<string, unknown>>(wrapped);
      chatAskCounter.add(1, { ...labels, outcome: 'ok' });
      return {
        sql: parsed.sql,
        explanation: parsed.explanation ?? '',
        data: rows,
        rowCount: rows.length,
      };
    } catch (err) {
      chatAskCounter.add(1, { ...labels, outcome: 'error' });
      throw err;
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }
}
