import { Injectable } from '@nestjs/common';
import { DatasetService } from '../dataset/dataset.service';
import type { DoField, DoJson } from '../dataset/do';

/**
 * 按 Application 下的所有 Dataset 生成 OpenAPI 3.0.3 规范。
 * 每个 dataset 对应 5-7 个 Instant API 端点。
 */
@Injectable()
export class OpenapiService {
  constructor(private readonly datasetService: DatasetService) {}

  async buildForApp(appCode: string): Promise<unknown> {
    const listed = await this.datasetService.list(appCode, { pageSize: 500 });
    const datasets = listed.data;
    const full = await Promise.all(datasets.map((d) => this.datasetService.get(d.datasetCode)));

    const paths: Record<string, unknown> = {};
    // 共享 schemas：不依赖具体 dataset，所有端点都引用。
    // 之前每张表都内联一份 ${TableName}FilterRequest 重复约 13 个 op 枚举；
    // 现在抽出 FilterClause / FilterRequest，spec 体积减小、SDK 端拿到的类型也更利索。
    const schemas: Record<string, unknown> = {
      FilterClause: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          op: {
            type: 'string',
            enum: [
              'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
              'like', 'notLike', 'in', 'notIn', 'isNull', 'isNotNull', 'between',
            ],
          },
          value: {},
        },
        required: ['field', 'op'],
      },
      FilterRequest: {
        type: 'object',
        properties: {
          where: {
            type: 'array',
            items: { $ref: '#/components/schemas/FilterClause' },
          },
          orderBy: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                direction: { type: 'string', enum: ['asc', 'desc'] },
              },
            },
          },
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 1000, default: 20 },
          select: { type: 'array', items: { type: 'string' } },
          includeDeleted: { type: 'boolean', default: false },
        },
      },
    };

    for (const ds of full) {
      const schemaName = pascal(ds.tableName);
      schemas[schemaName] = schemaFromDo(ds.doJson);

      const base = `/api/apps/${appCode}/ds/${ds.datasetCode}`;
      const tag = `${ds.alias} (${ds.tableName})`;

      paths[`${base}/filter`] = {
        post: {
          tags: [tag],
          summary: `筛选 ${ds.alias}`,
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FilterRequest' },
              },
            },
          },
          responses: okRef({
            type: 'object',
            properties: {
              data: { type: 'array', items: { $ref: `#/components/schemas/${schemaName}` } },
              page: { type: 'integer' },
              pageSize: { type: 'integer' },
              total: { type: 'integer' },
            },
          }),
        },
      };

      paths[`${base}/{id}`] = {
        get: {
          tags: [tag],
          summary: `获取单条 ${ds.alias}`,
          parameters: [idParam()],
          responses: okRef(schemaRef(schemaName)),
        },
        patch: {
          tags: [tag],
          summary: `更新 ${ds.alias}`,
          parameters: [idParam()],
          requestBody: { content: { 'application/json': { schema: schemaRef(schemaName) } } },
          responses: okRef(schemaRef(schemaName)),
        },
        delete: {
          tags: [tag],
          summary: `删除 ${ds.alias}`,
          parameters: [idParam()],
          responses: okRef({
            type: 'object',
            properties: { ok: { type: 'boolean' }, softDeleted: { type: 'boolean' } },
          }),
        },
      };

      paths[base] = {
        post: {
          tags: [tag],
          summary: `创建 ${ds.alias}`,
          requestBody: { content: { 'application/json': { schema: schemaRef(schemaName) } } },
          responses: okRef(schemaRef(schemaName)),
        },
      };

      paths[`${base}/batchCreate`] = {
        post: {
          tags: [tag],
          summary: `批量创建 ${ds.alias}（≤100）`,
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    rows: { type: 'array', items: schemaRef(schemaName), maxItems: 100 },
                  },
                  required: ['rows'],
                },
              },
            },
          },
          responses: okRef({ type: 'object', properties: { created: { type: 'integer' } } }),
        },
      };

      paths[`${base}/aggregate`] = {
        post: {
          tags: [tag],
          summary: `聚合 ${ds.alias}`,
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    groupBy: { type: 'array', items: { type: 'string' } },
                    metrics: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
                          field: { type: 'string' },
                          alias: { type: 'string' },
                        },
                        required: ['op', 'alias'],
                      },
                    },
                    where: { type: 'array', items: { type: 'object' } },
                    limit: { type: 'integer' },
                  },
                  required: ['metrics'],
                },
              },
            },
          },
          responses: okRef({
            type: 'object',
            properties: { data: { type: 'array', items: { type: 'object' } } },
          }),
        },
      };

      paths[`${base}/options/{field}`] = {
        get: {
          tags: [tag],
          summary: `取 ${ds.alias} 某字段可选值`,
          parameters: [
            { name: 'field', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: okRef({
            type: 'object',
            properties: {
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' },
                    label: { type: 'string' },
                  },
                },
              },
            },
          }),
        },
      };
    }

    return {
      openapi: '3.0.3',
      info: {
        title: `Kintsugi Instant API · ${appCode}`,
        version: '1.0.0',
        description: `由 DBAgent 扫描并人工 DO 编辑后自动生成的 Instant API。共 ${datasets.length} 个数据集。`,
      },
      servers: [{ url: 'http://localhost:4000' }],
      paths,
      components: {
        schemas,
        securitySchemes: {
          CookieAuth: { type: 'apiKey', in: 'cookie', name: 'kintsugi_session' },
          AccessKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Access-Key',
            description: 'OpenAPI HMAC-SHA256 签名（配合 X-Signature / X-Timestamp / X-Nonce）',
          },
        },
      },
    };
  }
}

function schemaRef(name: string): unknown {
  return { $ref: `#/components/schemas/${name}` };
}

function okRef(schema: unknown): unknown {
  return {
    '200': {
      description: 'OK',
      content: { 'application/json': { schema } },
    },
  };
}

function idParam(): unknown {
  return { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
}

function pascal(s: string): string {
  return s
    .split(/[_\-\s]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function schemaFromDo(doJson: DoJson): unknown {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of doJson.fields) {
    if (f.deprecated) continue;
    props[f.name] = fieldToSchema(f);
    if (!f.nullable && !f.isAutoIncrement) required.push(f.name);
  }
  const s: Record<string, unknown> = { type: 'object', properties: props };
  if (required.length) s['required'] = required;
  if (doJson.description) s['description'] = doJson.description;
  return s;
}

function fieldToSchema(f: DoField): unknown {
  const base: Record<string, unknown> = {};
  if (f.businessName && f.businessName !== f.name) base['title'] = f.businessName;
  if (f.comment) base['description'] = f.comment;
  // OpenAPI 3.0.3: nullable 用 nullable: true 表达
  if (f.nullable) base['nullable'] = true;
  switch (f.logicalType) {
    case 'integer':
    case 'bigint':
      return { ...base, type: 'integer' };
    case 'decimal':
    case 'float':
      return { ...base, type: 'number' };
    case 'boolean':
      return { ...base, type: 'boolean' };
    case 'date':
      return { ...base, type: 'string', format: 'date' };
    case 'datetime':
    case 'timestamptz':
      return { ...base, type: 'string', format: 'date-time' };
    case 'time':
      return { ...base, type: 'string', format: 'time' };
    case 'json':
      return { ...base, type: 'object' };
    case 'uuid':
      return { ...base, type: 'string', format: 'uuid' };
    case 'enum':
      return f.enumValues ? { ...base, type: 'string', enum: f.enumValues } : { ...base, type: 'string' };
    case 'binary':
      return { ...base, type: 'string', format: 'binary' };
    default:
      return { ...base, type: 'string' };
  }
}
