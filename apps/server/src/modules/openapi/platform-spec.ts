/**
 * Kintsugi 平台稳定 API 的 OpenAPI 3.0.3 规范。
 *
 * 这是手写的"契约源"——和**每个 app 的** Instant API 不同（那个由 DO 动态生成），
 * 平台 API（auth / dataset 列表 / sql / bff / chats / 等）的形状由源码决定，
 * 这里集中维护让 `@kintsugi/sdk` 能从单一来源派生 TS 类型。
 *
 * 维护规则：
 *  - 加新端点 / 改 controller signature 时，**同时改这个文件**
 *  - CI 不强制（无法自动检 controller ↔ spec drift），靠 PR review
 *  - 覆盖范围：SDK 实际使用的 ~15 个端点；管理面（rbac/dbagent/asset-transfer/pages）
 *    暂不暴露给 SDK 用户，所以也不进 spec
 *
 * 路径不带 `/api/` 前缀的进 spec —— `/api/` 是 server 的 globalPrefix，
 * SDK baseUrl 自带，不重复。
 */

const ERROR_RESPONSE = {
  type: 'object',
  properties: {
    code: { type: 'string', example: 'NOT_FOUND' },
    message: { type: 'string' },
    detail: { type: 'object', additionalProperties: true, nullable: true },
  },
  required: ['code', 'message'],
};

const FILTER_REQUEST = {
  type: 'object',
  properties: {
    where: {
      type: 'array',
      items: {
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
};

const PAGED_RESPONSE = {
  type: 'object',
  properties: {
    data: { type: 'array', items: { type: 'object', additionalProperties: true } },
    total: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
  },
  required: ['data', 'total', 'page', 'pageSize'],
};

const ROW_RESPONSE = {
  type: 'object',
  additionalProperties: true,
};

function ok<T>(schema: T) {
  return {
    '200': {
      description: 'success',
      content: { 'application/json': { schema } },
    },
  };
}

function err4xx() {
  return {
    '400': {
      description: 'bad request / validation',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '401': {
      description: 'unauthorized',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '403': {
      description: 'forbidden',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '404': {
      description: 'not found',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '409': {
      description: 'concurrent edit conflict',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
    '429': {
      description: 'rate limited',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  };
}

export function buildPlatformSpec(): unknown {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Kintsugi Platform API',
      version: '0.1.0',
      description:
        '平台稳定 API。每个 app 的 Instant API（dataset 字段级 schema）见 /api/apps/:appCode/openapi.json',
    },
    components: {
      schemas: {
        Error: ERROR_RESPONSE,
        FilterRequest: FILTER_REQUEST,
        PagedResponse: PAGED_RESPONSE,
        Row: ROW_RESPONSE,

        LoginRequest: {
          type: 'object',
          properties: {
            tenantCode: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
          },
          required: ['tenantCode', 'username', 'password'],
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                tenantCode: { type: 'string' },
              },
            },
          },
          required: ['token'],
        },
        RegisterRequest: {
          type: 'object',
          properties: {
            tenantCode: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string', minLength: 12 },
            email: { type: 'string', nullable: true },
          },
          required: ['tenantCode', 'username', 'password'],
        },
        Me: {
          type: 'object',
          properties: {
            sub: { type: 'string' },
            username: { type: 'string' },
            tenantCode: { type: 'string' },
            roles: { type: 'array', items: { type: 'string' } },
          },
        },
        TrialApplyRequest: {
          type: 'object',
          properties: {
            contactName: { type: 'string', minLength: 2, maxLength: 64 },
            email: { type: 'string', format: 'email', maxLength: 128 },
            phone: { type: 'string', maxLength: 32, nullable: true },
            company: { type: 'string', maxLength: 128, nullable: true },
            useCase: { type: 'string', maxLength: 2000, nullable: true },
          },
          required: ['contactName', 'email'],
        },
        TrialApplyResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Application id; quote when contacting platform admin.' },
          },
          required: ['id'],
        },

        Application: {
          type: 'object',
          properties: {
            appCode: { type: 'string' },
            tenantCode: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            environment: { type: 'string', enum: ['production', 'daily', 'development'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        DatasetSummary: {
          type: 'object',
          properties: {
            datasetCode: { type: 'string' },
            appCode: { type: 'string' },
            dataSourceId: { type: 'string' },
            tableName: { type: 'string' },
            alias: { type: 'string' },
            version: { type: 'integer' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        SqlExecuteRequest: {
          type: 'object',
          properties: {
            params: { type: 'object', additionalProperties: true },
            sqlSafe: { type: 'boolean', default: false },
          },
        },
        SqlExecuteResponse: {
          type: 'object',
          properties: {
            data: {},
            rowCount: { type: 'integer' },
            riskLevel: { type: 'string', enum: ['low', 'medium', 'critical'] },
            error: { type: 'string', nullable: true },
          },
          required: ['rowCount', 'riskLevel'],
        },

        BffExecRequest: {
          type: 'object',
          properties: { input: {} },
        },
        BffExecResponse: {
          type: 'object',
          properties: {
            data: {},
            logs: { type: 'array', items: { type: 'string' } },
          },
        },

        ChatsAskRequest: {
          type: 'object',
          properties: {
            appCode: { type: 'string' },
            question: { type: 'string' },
            maxTables: { type: 'integer', minimum: 1, maximum: 60 },
          },
          required: ['appCode', 'question'],
        },
        ChatsAskResponse: {
          type: 'object',
          properties: {
            sql: { type: 'string' },
            explanation: { type: 'string' },
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            rowCount: { type: 'integer' },
          },
        },

        AccessKeyPublic: {
          type: 'object',
          properties: {
            accessKey: { type: 'string' },
            appCode: { type: 'string' },
            createdBy: { type: 'string', nullable: true },
            boundUserId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            revokedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        AccessKeyCreateRequest: {
          type: 'object',
          properties: {
            appCode: { type: 'string' },
            createdBy: { type: 'string' },
            expiresInDays: { type: 'integer', minimum: 1, maximum: 3650 },
            boundUserId: { type: 'string' },
          },
          required: ['appCode'],
        },
        AccessKeyCreateResponse: {
          type: 'object',
          properties: {
            accessKey: { type: 'string' },
            secretKey: { type: 'string' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            boundUserId: { type: 'string', nullable: true },
          },
          required: ['accessKey', 'secretKey'],
        },
        AccessKeyRotateResponse: {
          type: 'object',
          properties: {
            accessKey: { type: 'string' },
            newSecretKey: { type: 'string' },
            prevValidUntil: { type: 'string', format: 'date-time' },
          },
        },

        AuditEntry: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tenantCode: { type: 'string' },
            appCode: { type: 'string', nullable: true },
            userId: { type: 'string', nullable: true },
            /** HMAC 路径写入；JWT 路径恒为 null。按 key 查 / 撤后回溯走索引。 */
            accessKey: { type: 'string', nullable: true },
            action: { type: 'string' },
            targetType: { type: 'string' },
            targetId: { type: 'string', nullable: true },
            traceparent: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            afterJson: {},
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'kintsugi_session' },
        accessKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Access-Key',
          description:
            'Use with X-Signature / X-Timestamp / X-Nonce. See /guides/hmac in docs.',
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }, { accessKeyAuth: [] }],
    paths: {
      '/api/health': {
        get: {
          operationId: 'getHealth',
          summary: 'Health check',
          security: [],
          responses: {
            ...ok({
              type: 'object',
              properties: {
                status: { type: 'string' },
                metadata: { type: 'string' },
              },
            }),
          },
        },
      },

      // ---- Auth ----
      '/api/auth/register': {
        post: {
          operationId: 'register',
          summary: 'Register a new tenant + initial user',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/LoginResponse' }), ...err4xx() },
        },
      },
      '/api/auth/login': {
        post: {
          operationId: 'login',
          summary: 'Log in',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/LoginResponse' }), ...err4xx() },
        },
      },
      '/api/auth/logout': {
        post: {
          operationId: 'logout',
          responses: {
            ...ok({ type: 'object', properties: { ok: { type: 'boolean' } } }),
            ...err4xx(),
          },
        },
      },
      '/api/auth/me': {
        get: {
          operationId: 'getMe',
          responses: { ...ok({ $ref: '#/components/schemas/Me' }), ...err4xx() },
        },
      },

      // ---- Trial application（公开 / 非 tenant-scoped）----
      '/api/trial/apply': {
        post: {
          operationId: 'applyForTrial',
          summary: 'Submit a trial application (public, no auth)',
          security: [],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TrialApplyRequest' } } },
          },
          responses: {
            ...ok({ $ref: '#/components/schemas/TrialApplyResponse' }),
            ...err4xx(),
          },
        },
      },

      // ---- Applications ----
      '/api/applications': {
        get: {
          operationId: 'listApplications',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
        post: {
          operationId: 'createApplication',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    appCode: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    environment: { type: 'string', enum: ['production', 'daily', 'development'] },
                  },
                  required: ['appCode', 'name'],
                },
              },
            },
          },
          responses: { ...ok({ $ref: '#/components/schemas/Application' }), ...err4xx() },
        },
      },
      '/api/applications/{appCode}': {
        get: {
          operationId: 'getApplication',
          parameters: [{ name: 'appCode', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { ...ok({ $ref: '#/components/schemas/Application' }), ...err4xx() },
        },
      },

      // ---- Datasets ----
      '/api/datasets': {
        get: {
          operationId: 'listDatasets',
          parameters: [
            { name: 'appCode', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
            { name: 'keyword', in: 'query', schema: { type: 'string' } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
      },
      '/api/datasets/{datasetCode}': {
        get: {
          operationId: 'getDataset',
          parameters: [{ name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { ...ok({ type: 'object', additionalProperties: true }), ...err4xx() },
        },
      },
      '/api/datasets/{datasetCode}/rls-policy': {
        get: {
          operationId: 'getRlsPolicy',
          parameters: [{ name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            ...ok({
              type: 'object',
              properties: {
                sql: { type: 'string' },
                dropSql: { type: 'string' },
                policies: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      using: { type: 'string' },
                      check: { type: 'string' },
                    },
                  },
                },
                warnings: { type: 'array', items: { type: 'string' } },
              },
            }),
            ...err4xx(),
          },
        },
      },

      // ---- Instant API（按 :appCode + :datasetCode 模板，row 是 generic Row） ----
      '/api/apps/{appCode}/ds/{datasetCode}/filter': {
        post: {
          operationId: 'instantFilter',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FilterRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
      },
      '/api/apps/{appCode}/ds/{datasetCode}/{id}': {
        get: {
          operationId: 'instantGetOne',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/Row' }), ...err4xx() },
        },
        patch: {
          operationId: 'instantUpdate',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Row' } } },
          },
          responses: {
            ...ok({
              type: 'object',
              properties: { ok: { type: 'boolean' }, row: { $ref: '#/components/schemas/Row' } },
            }),
            ...err4xx(),
          },
        },
        delete: {
          operationId: 'instantDelete',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            ...ok({
              type: 'object',
              properties: { ok: { type: 'boolean' }, softDeleted: { type: 'boolean' } },
            }),
            ...err4xx(),
          },
        },
      },
      '/api/apps/{appCode}/ds/{datasetCode}': {
        post: {
          operationId: 'instantCreate',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'datasetCode', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Row' } } },
          },
          responses: {
            ...ok({
              type: 'object',
              properties: { ok: { type: 'boolean' }, row: { $ref: '#/components/schemas/Row' } },
            }),
            ...err4xx(),
          },
        },
      },

      // ---- Custom SQL ----
      '/api/sql/{sqlCode}/execute': {
        post: {
          operationId: 'sqlExecute',
          parameters: [{ name: 'sqlCode', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SqlExecuteRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/SqlExecuteResponse' }), ...err4xx() },
        },
      },

      // ---- BFF ----
      '/api/bff/exec/{appCode}/{scriptName}': {
        post: {
          operationId: 'bffExec',
          parameters: [
            { name: 'appCode', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'scriptName', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BffExecRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/BffExecResponse' }), ...err4xx() },
        },
      },

      // ---- Chats ----
      '/api/chats/ask': {
        post: {
          operationId: 'chatsAsk',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatsAskRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/ChatsAskResponse' }), ...err4xx() },
        },
      },

      // ---- AccessKey ----
      '/api/access-keys': {
        get: {
          operationId: 'listAccessKeys',
          parameters: [
            { name: 'appCode', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
        post: {
          operationId: 'createAccessKey',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AccessKeyCreateRequest' } } },
          },
          responses: { ...ok({ $ref: '#/components/schemas/AccessKeyCreateResponse' }), ...err4xx() },
        },
      },
      '/api/access-keys/{accessKey}/rotate': {
        post: {
          operationId: 'rotateAccessKey',
          parameters: [
            { name: 'accessKey', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'graceMinutes', in: 'query', schema: { type: 'integer', minimum: 10, maximum: 1440 } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/AccessKeyRotateResponse' }), ...err4xx() },
        },
      },
      '/api/access-keys/{accessKey}': {
        delete: {
          operationId: 'revokeAccessKey',
          parameters: [{ name: 'accessKey', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            ...ok({ type: 'object', properties: { ok: { type: 'boolean' } } }),
            ...err4xx(),
          },
        },
      },

      // ---- Webhooks ----
      '/api/webhooks': {
        get: {
          operationId: 'listWebhooks',
          parameters: [
            { name: 'appCode', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            ...ok({ type: 'array', items: { type: 'object', additionalProperties: true } }),
            ...err4xx(),
          },
        },
        post: {
          operationId: 'createWebhook',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    appCode: { type: 'string' },
                    url: { type: 'string', format: 'uri' },
                    events: { type: 'array', items: { type: 'string' } },
                    description: { type: 'string' },
                  },
                  required: ['appCode', 'url', 'events'],
                },
              },
            },
          },
          responses: {
            ...ok({
              type: 'object',
              properties: {
                id: { type: 'string' },
                secret: { type: 'string', description: '一次性返回；之后不可再读取' },
              },
              required: ['id', 'secret'],
            }),
            ...err4xx(),
          },
        },
      },
      '/api/webhooks/{id}': {
        delete: {
          operationId: 'removeWebhook',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            ...ok({ type: 'object', properties: { ok: { type: 'boolean' } } }),
            ...err4xx(),
          },
        },
      },
      '/api/webhooks/{id}/deliveries': {
        get: {
          operationId: 'listWebhookDeliveries',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['pending', 'success', 'dead_lettered'] },
            },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
      },

      // ---- Audit ----
      '/api/audit-logs': {
        get: {
          operationId: 'listAuditLogs',
          parameters: [
            { name: 'appCode', in: 'query', schema: { type: 'string' } },
            { name: 'userId', in: 'query', schema: { type: 'string' } },
            { name: 'accessKey', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'traceparent', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { ...ok({ $ref: '#/components/schemas/PagedResponse' }), ...err4xx() },
        },
      },
    },
  };
}
