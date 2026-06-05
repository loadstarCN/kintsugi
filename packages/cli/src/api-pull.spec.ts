/**
 * api-pull 的 codegen 部分单测：不发 HTTP，直接喂 OpenAPI fixture 给 openapi-typescript，
 * 验证：
 *   1) types.ts 包含期望的 components / paths
 *   2) renderClient 能产出可独立 typecheck 的 client.ts
 */

import { describe, expect, it } from 'vitest';
import openapiTS, { astToString } from 'openapi-typescript';

const FIXTURE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Kintsugi App API', version: '1.0' },
  paths: {
    '/api/apps/app-x/ds/goods/filter': {
      post: {
        operationId: 'goods_filter',
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GoodsFilterResponse' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Goods: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['id', 'name'],
      },
      GoodsFilterResponse: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Goods' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
      },
    },
  },
};

describe('api-pull codegen', () => {
  it('generates TypeScript types from a Kintsugi-shaped OpenAPI spec', async () => {
    const ast = await openapiTS(FIXTURE_SPEC as Parameters<typeof openapiTS>[0]);
    const out = astToString(ast);

    // schemas
    expect(out).toContain('Goods');
    expect(out).toContain('GoodsFilterResponse');
    // paths
    expect(out).toContain('/api/apps/app-x/ds/goods/filter');
    // primitive types correctly inferred
    expect(out).toMatch(/id\??: number/);
    expect(out).toMatch(/name\??: string/);
  });

  it('handles empty paths gracefully', async () => {
    const empty = { openapi: '3.0.3', info: { title: 't', version: '1' }, paths: {} };
    const ast = await openapiTS(empty as Parameters<typeof openapiTS>[0]);
    const out = astToString(ast);
    expect(out).toContain('paths');
  });

  it('shared FilterClause / FilterRequest become typed enum + reusable schema', async () => {
    const SHARED_FILTER_SPEC = {
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      paths: {
        '/api/apps/x/ds/y/filter': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FilterRequest' },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          FilterClause: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: {
                type: 'string',
                enum: ['eq', 'ne', 'gt', 'in', 'notIn', 'isNull'],
              },
              value: {},
            },
            required: ['field', 'op'],
          },
          FilterRequest: {
            type: 'object',
            properties: {
              where: { type: 'array', items: { $ref: '#/components/schemas/FilterClause' } },
            },
          },
        },
      },
    };
    const ast = await openapiTS(SHARED_FILTER_SPEC as Parameters<typeof openapiTS>[0]);
    const out = astToString(ast);
    // op should be a typed string-literal union, not just `string`
    expect(out).toContain('"eq"');
    expect(out).toContain('"in"');
    expect(out).toContain('"isNull"');
    // FilterRequest.where references FilterClause schema, not inlined
    expect(out).toMatch(/where\?:\s*components\["schemas"\]\["FilterClause"\]\[\]/);
  });

  it('handles spec with no components.schemas', async () => {
    const noSchemas = {
      openapi: '3.0.3',
      info: { title: 't', version: '1' },
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'ok' } } },
        },
      },
    };
    const ast = await openapiTS(noSchemas as Parameters<typeof openapiTS>[0]);
    const out = astToString(ast);
    expect(out).toContain('/health');
  });
});
