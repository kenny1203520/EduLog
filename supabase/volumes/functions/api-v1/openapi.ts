import { applyResourceOpenApi } from './openapiRegistry.ts'

const errorSchema = { '$ref': '#/components/schemas/ApiError' }

export function createOpenApiDocument() {
  const document: any = {
    openapi: '3.0.3',
    info: { title: 'EduLog API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: {
        Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
        Sort: { name: 'sort', in: 'query', schema: { type: 'string', example: 'created_at:desc' } },
        IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } },
      },
      schemas: {
        ApiError: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id', 'trace_id'], properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' }, trace_id: { type: 'string' }, fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } } } } } },
        CollectionMeta: { type: 'object', required: ['limit', 'offset', 'total', 'sort'], properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, total: { type: 'integer', minimum: 0 }, sort: { type: 'string' } } },
        ApiEnvelope: { type: 'object', required: ['data', 'meta', 'request_id', 'trace_id'], properties: { data: {}, meta: { oneOf: [{ '$ref': '#/components/schemas/CollectionMeta' }, { type: 'null' }] }, request_id: { type: 'string' }, trace_id: { type: 'string' } } },
      },
      responses: {},
    },
    'x-idempotency': { methods: ['POST', 'PATCH', 'DELETE'], header: 'Idempotency-Key', replay: 'same status and data with current request_id and trace_id' },
    'x-pagination': { parameters: ['limit', 'offset', 'search', 'sort', 'filter[field]'], sort: 'field:asc|desc; supported fields are resource-specific' },
    paths: {
      '/health': { get: { security: [], responses: { '200': { description: 'Healthy' } } } },
      '/me': { get: { responses: { '200': { description: 'Current authenticated user' } } } },
      '/teachings/{id}/members': {},
      '/teachings/{id}/members/{user_id}': {},
    },
  }
  const commonErrors = Object.fromEntries([
    ['400', 'BadRequest'], ['401', 'Unauthorized'], ['403', 'Forbidden'], ['404', 'NotFound'],
    ['409', 'Conflict'], ['413', 'PayloadTooLarge'], ['422', 'ValidationError'], ['429', 'RateLimited'], ['500', 'InternalError'],
  ].map(([status, name]) => [status, { '$ref': `#/components/responses/${name}` }]))
  Object.assign(document.components.responses, {
    BadRequest: { description: 'Malformed request', content: { 'application/json': { schema: errorSchema } } },
    Unauthorized: { description: 'Missing or invalid Supabase JWT', content: { 'application/json': { schema: errorSchema } } },
    Forbidden: { description: 'Permission or teaching scope denied', content: { 'application/json': { schema: errorSchema } } },
    NotFound: { description: 'Resource not found or not visible', content: { 'application/json': { schema: errorSchema } } },
    Conflict: { description: 'State conflict', content: { 'application/json': { schema: errorSchema } } },
    PayloadTooLarge: { description: 'Payload exceeds configured limit', content: { 'application/json': { schema: errorSchema } } },
    ValidationError: { description: 'Schema or business validation failed', content: { 'application/json': { schema: errorSchema } } },
    RateLimited: { description: 'Rate limit exceeded', content: { 'application/json': { schema: errorSchema } } },
    InternalError: { description: 'Unexpected server error', content: { 'application/json': { schema: errorSchema } } },
  })
  applyResourceOpenApi(document, commonErrors)
  const memberBody = { type: 'object', additionalProperties: false, properties: { user_id: { type: 'string', format: 'uuid' }, role_id: { type: 'string', format: 'uuid', nullable: true }, status: { type: 'string', enum: ['active', 'suspended', 'removed'] }, effective_from: { type: 'string', format: 'date' }, effective_to: { type: 'string', format: 'date', nullable: true } } }
  document.paths['/teachings/{id}/members'] = {
    get: { 'x-permission': 'teaching.members.list', parameters: [{ '$ref': '#/components/parameters/Limit' }, { '$ref': '#/components/parameters/Offset' }, { '$ref': '#/components/parameters/Sort' }], responses: { '200': { description: 'Teaching members' }, ...commonErrors } },
    post: { 'x-permission': 'teaching.members.manage', 'x-idempotency-required': true, parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { ...memberBody, required: ['user_id'] } } } }, responses: { '201': { description: 'Member added' }, ...commonErrors } },
  }
  document.paths['/teachings/{id}/members/{user_id}'] = {
    patch: { 'x-permission': 'teaching.members.manage', 'x-idempotency-required': true, parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: memberBody } } }, responses: { '200': { description: 'Member updated' }, ...commonErrors } },
    delete: { 'x-permission': 'teaching.members.manage', 'x-idempotency-required': true, parameters: [{ '$ref': '#/components/parameters/IdempotencyKey' }], responses: { '200': { description: 'Member removed' }, ...commonErrors } },
  }
  return document
}

export const OPENAPI = createOpenApiDocument()
