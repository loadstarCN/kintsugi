import { Inject, Injectable } from '@nestjs/common';
import type { LlmProvider } from '@kintsugi/llm';
import { KintsugiError } from '@kintsugi/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER } from '../../llm/llm.module';
import { DataSourceService } from '../datasource/datasource.service';
import { guardChatsSql } from '../chats/sql-guard';
import type { DoJson } from '../dataset/do';

const REPORT_SYSTEM = `你是一个数据分析助手。
输入：用户自然语言问题 + 若干 Dataset DO 元数据。
输出**一条**合法 JSON，形如：
{
  "sql": "SELECT ... FROM ...（仅 SELECT，不能 INSERT/UPDATE/DELETE/DDL，自带 LIMIT 500）",
  "explanation": "中文解释一两句",
  "chart": {
    "type": "bar" | "line" | "pie" | "funnel" | "scatter" | "table",
    "xField": "作为 x 轴的字段名（type=pie 时是 nameField）",
    "yField": "作为 y 轴的字段名（type=pie 时是 valueField）",
    "seriesField": "可选，多系列拆分字段"
  }
}

约束：
 - 只用给的表和字段，不要编造。
 - 目标方言：{dialect}。
 - SQL 末尾必须自带 LIMIT 500（除非问题明确要求更少）。
 - 不要 markdown 围栏。`;

export interface ReportResult {
  sql: string;
  explanation: string;
  chart: {
    type: 'bar' | 'line' | 'pie' | 'funnel' | 'scatter' | 'table';
    xField: string;
    yField: string;
    seriesField?: string;
  };
  data: Array<Record<string, unknown>>;
  rowCount: number;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ds: DataSourceService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async ask(input: { appCode: string; question: string; maxTables?: number }): Promise<ReportResult> {
    const datasets = await this.prisma.dataset.findMany({
      where: { appCode: input.appCode, isDeleted: false },
      take: input.maxTables ?? 30,
    });
    if (datasets.length === 0) {
      throw new KintsugiError('VALIDATION_FAILED', 'no datasets for app');
    }
    const dataSourceId = datasets[0]!.dataSourceId;
    const adapter = await this.ds.openAdapter(dataSourceId);
    try {
      const docs = datasets.map((d) => {
        const doJ = d.doJson as unknown as DoJson;
        return {
          table: d.tableName,
          alias: d.alias,
          columns: doJ.fields
            .filter((f) => !f.deprecated)
            .map((f) => ({ name: f.name, type: f.logicalType, description: f.businessName })),
        };
      });
      const resp = await this.llm.complete({
        responseFormatJson: true,
        temperature: 0,
        timeoutMs: 60_000,
        messages: [
          { role: 'system', content: REPORT_SYSTEM.replace('{dialect}', adapter.id) },
          {
            role: 'user',
            content: ['## 数据集', JSON.stringify(docs), '', '## 问题', input.question].join('\n'),
          },
        ],
      });
      if (!resp.content || !resp.content.trim()) {
        throw new KintsugiError('LLM_UPSTREAM_ERROR', 'empty LLM response');
      }
      const raw = resp.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let parsed: Omit<ReportResult, 'data' | 'rowCount'>;
      try {
        parsed = JSON.parse(raw) as Omit<ReportResult, 'data' | 'rowCount'>;
      } catch (err) {
        throw new KintsugiError('LLM_UPSTREAM_ERROR', `LLM non-JSON: ${(err as Error).message}`);
      }
      if (!parsed.sql) throw new KintsugiError('LLM_UPSTREAM_ERROR', 'LLM produced no SQL');
      // 防御纵深：sql-guard（拒多 statement / 必须 SELECT 开头，
      // 不再用 \b\w\b 关键字 regex 误伤 inserted_at / dropdowns 等列名）。
      // 主防御仍是 adapter.runReadonly 走 PG READ ONLY 事务。
      const cleanSql = guardChatsSql(parsed.sql);

      // 兜底 LIMIT，跟 ChatsService 一致 —— LLM 忘加 / 行数失控时不让结果集失控
      const MAX_ROWS = Number(process.env['REPORTS_MAX_ROWS'] ?? 1000);
      const wrapped = `select * from (${cleanSql}) as __k_lim limit ${MAX_ROWS}`;
      const rows = await adapter.runReadonly<Record<string, unknown>>(wrapped);
      return {
        ...parsed,
        data: rows,
        rowCount: rows.length,
      };
    } finally {
      await adapter.close().catch(() => undefined);
    }
  }
}
