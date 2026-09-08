import { resources } from './resources.js'

const errorResponses = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '413': { $ref: '#/components/responses/PayloadTooLarge' },
  '422': { $ref: '#/components/responses/UnprocessableEntity' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/InternalError' },
}

export function buildOpenApi() {
  const paths: Record<string, unknown> = {
    '/api/auth/login': { post: { operationId: 'login', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/auth/refresh': { post: { operationId: 'refresh', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/auth/logout': { post: { operationId: 'logout', responses: { '204': { description: 'Session cleared' }, ...errorResponses } } },
    '/api/auth/me': { get: { operationId: 'me', security: [{ cookieAuth: [] }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
  }
  for (const def of Object.values(resources)) {
    const collection = `/api/${def.route}`
    const item = `${collection}/{id}`
    paths[collection] = {
      get: { operationId: `${def.route.replaceAll('-', '_')}_list`, security: [{ cookieAuth: [] }], 'x-permission': def.permission, parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Search' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
      post: { operationId: `${def.route.replaceAll('-', '_')}_create`, security: [{ cookieAuth: [] }], 'x-permission': def.permission.replace(/\.list$/, '.create'), parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    }
    paths[item] = {
      get: { operationId: `${def.route.replaceAll('-', '_')}_get`, security: [{ cookieAuth: [] }], 'x-permission': def.permission.replace(/\.list$/, '.read'), responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
      patch: { operationId: `${def.route.replaceAll('-', '_')}_update`, security: [{ cookieAuth: [] }], 'x-permission': def.permission.replace(/\.list$/, '.update'), parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
      delete: { operationId: `${def.route.replaceAll('-', '_')}_delete`, security: [{ cookieAuth: [] }], 'x-permission': def.permission.replace(/\.list$/, '.delete'), parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    }
  }
  paths['/api/class-sessions'] = {
    get: { operationId: 'class_sessions_list', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.sessions.list', parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Search' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    post: { operationId: 'class_sessions_create_with_schedule', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.sessions.create', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ClassSessionMutation' } } } }, responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/class-sessions/{id}'] = {
    get: { operationId: 'class_sessions_get', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.sessions.read', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'class_sessions_update_with_schedule', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.sessions.update', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ClassSessionMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    delete: { operationId: 'class_sessions_delete', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.sessions.delete', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/teachings/{teachingId}/members'] = {
    get: { operationId: 'teaching_members_list', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.list', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    post: { operationId: 'teaching_members_create', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.create', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/teachings/{teachingId}/members/{userId}'] = {
    patch: { operationId: 'teaching_members_update', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.update', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    delete: { operationId: 'teaching_members_delete', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.delete', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/rbac/capability'] = {
    get: { operationId: 'rbac_capability', security: [{ cookieAuth: [] }], parameters: [{ name: 'permission', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/permissions/{permissionId}/policies'] = {
    get: { operationId: 'permission_policies_list', security: [{ cookieAuth: [] }], parameters: [{ name: 'permissionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'permission_policies_replace', security: [{ cookieAuth: [] }], parameters: [{ name: 'permissionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  return {
    openapi: '3.1.0', info: { title: 'EduLog API', version: '1.0.0' }, servers: [{ url: '/' }], paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'edulog_access' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, Sort: { name: 'sort', in: 'query', schema: { type: 'string' } }, Search: { name: 'search', in: 'query', schema: { type: 'string' } }, IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 255 } } },
      schemas: { Envelope: { type: 'object', required: ['data', 'meta', 'request_id', 'trace_id'], properties: { data: {}, meta: { type: 'object' }, request_id: { type: 'string' }, trace_id: { type: 'string' } } }, Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id', 'trace_id'], properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' }, trace_id: { type: 'string' }, fields: { type: 'object' } } } } }, ClassSessionMutation: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, classroom_id: { type: ['string', 'null'], format: 'uuid' }, course_ids: { type: 'array', items: { type: 'string', format: 'uuid' } }, capacity: { type: 'integer', minimum: 0 }, start_date: { type: ['string', 'null'], format: 'date' }, end_date: { type: ['string', 'null'], format: 'date' }, time_zone: { type: 'string' }, session_type: { type: 'string', enum: ['regular', 'camp'] }, schedule_mode: { type: 'string', enum: ['weekly', 'monthly', 'specific_dates'] }, schedule_rules: { type: 'array', items: { type: 'object' } } } }, LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1 } } } },
      responses: Object.fromEntries(Object.entries({ BadRequest: 'Invalid request', Unauthorized: 'Authentication required', Forbidden: 'Permission denied', NotFound: 'Resource not found', Conflict: 'Resource conflict', PayloadTooLarge: 'Payload too large', UnprocessableEntity: 'Validation failed', RateLimited: 'Rate limit exceeded', InternalError: 'Unexpected error' }).map(([name, description]) => [name, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]))
    }
  }
}

