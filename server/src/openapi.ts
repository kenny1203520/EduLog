import { z } from 'zod'
import { resources, resourceSchemas } from './resources.js'
import { permissionForResource } from './authorization.js'

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

function fieldSchema(field: string) {
  if (field === 'is_system') return { type: 'boolean', const: false, description: 'Compatibility input only; system roles cannot be created or modified' }
  if (field.endsWith('_id') || field === 'id') return { type: 'string', format: 'uuid' }
  if (['course_ids', 'teacher_ids', 'classroom_ids', 'class_session_ids'].includes(field)) return { type: 'array', items: { type: 'string', format: 'uuid' } }
  if (['teacher_attendance', 'editor_settings', 'content_document', 'notes_document', 'bio_document', 'contact_notes_document', 'class_notes_document', 'description_document', 'template_document', 'snapshot'].includes(field)) return { type: 'object' }
  if (field.endsWith('_date') || field.endsWith('_at') || field === 'birthday') return { type: 'string', format: field.endsWith('_at') ? 'date-time' : 'date' }
  if (['is_completed', 'active', 'enabled', 'is_hidden', 'is_conducted'].includes(field)) return { type: 'boolean' }
  if (['sequence', 'lesson_number', 'capacity', 'sort_order', 'version', 'day_of_week', 'day_of_month'].includes(field)) return { type: 'integer' }
  return { type: 'string' }
}

function runtimeSchema(def: typeof resources[keyof typeof resources], action: 'create' | 'update') {
  const schema = resourceSchemas[def.route]?.[action === 'create' ? 'createSchema' : 'updateSchema']
  if (!schema) return { type: 'object', properties: {}, additionalProperties: false }
  const document = z.toJSONSchema(schema) as Record<string, unknown>
  // OpenAPI 3.1 accepts the JSON Schema vocabulary but does not need the
  // dialect marker repeated on every request schema.
  delete document.$schema
  return document
}

function mutationSchema(def: typeof resources[keyof typeof resources], action: 'create' | 'update') {
  const document = runtimeSchema(def, action) as { properties?: Record<string, unknown>; additionalProperties?: unknown }
  const properties = { ...(document.properties ?? {}) }
  if (def.compatibilityFields?.includes('is_system')) {
    properties.is_system = { type: 'boolean', const: false, description: 'Compatibility input only; system roles cannot be created or modified' }
  }
  return { ...document, type: 'object', properties, additionalProperties: false }
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
    const methods = new Set(def.genericMethods ?? ['GET', 'POST', 'PATCH', 'DELETE'])
    const name = def.route.replaceAll('-', '_')
    const base = { security: [{ cookieAuth: [] }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } }
    const collectionPath: Record<string, unknown> = {}
    const permission = (action: 'create' | 'read' | 'update' | 'delete' | 'list') => def.selfAuthorization ? undefined : permissionForResource(def, action)
    const filterableFields = def.filterable ?? []
    const queryParameters = [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Search' }, { $ref: '#/components/parameters/Filters' }, { $ref: '#/components/parameters/Or' }, ...(filterableFields.includes('status') ? [{ $ref: '#/components/parameters/Status' }] : []), ...['teaching_id', 'course_id', 'classroom_id', 'class_session_id', 'class_occurrence_id', 'lesson_id', 'student_id', 'teacher_id', 'instructor_id', 'user_id', 'enrollment_id', 'occurrence_report_id', 'entity_type', 'entity_id', 'entity_ids', 'template_type', 'scope_type', 'scope_entity_id'].filter((field) => filterableFields.includes(field)).map((field) => ({ $ref: `#/components/parameters/${field}` }))]
    if (methods.has('GET')) collectionPath.get = { ...base, operationId: `${name}_list`, ...(permission('list') ? { 'x-permission': permission('list') } : {}), 'x-readable-fields': def.listFields ?? def.fields, 'x-sortable-fields': def.sortable, 'x-searchable-fields': def.searchable, parameters: queryParameters }
    if (methods.has('POST')) collectionPath.post = { ...base, operationId: `${name}_create`, ...(permission('create') ? { 'x-permission': permission('create') } : {}), 'x-writable-fields': def.writable, 'x-compatibility-fields': def.compatibilityFields ?? [], 'x-request-schema-source': 'resource-registry', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: mutationSchema(def, 'create') } } }, responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } }
    paths[collection] = collectionPath
    const itemPath: Record<string, unknown> = {}
    if (methods.has('GET')) itemPath.get = { ...base, operationId: `${name}_get`, ...(permission('read') ? { 'x-permission': permission('read') } : {}), 'x-readable-fields': def.itemFields ?? def.fields, parameters: [{ $ref: '#/components/parameters/ResourceId' }] }
    if (methods.has('PATCH')) itemPath.patch = { ...base, operationId: `${name}_update`, ...(permission('update') ? { 'x-permission': permission('update') } : {}), 'x-writable-fields': def.writable, 'x-compatibility-fields': def.compatibilityFields ?? [], 'x-request-schema-source': 'resource-registry', parameters: [{ $ref: '#/components/parameters/ResourceId' }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: mutationSchema(def, 'update') } } } }
    if (methods.has('DELETE')) itemPath.delete = { ...base, operationId: `${name}_delete`, ...(permission('delete') ? { 'x-permission': permission('delete') } : {}), 'x-writable-fields': [], parameters: [{ $ref: '#/components/parameters/ResourceId' }, { $ref: '#/components/parameters/IdempotencyKey' }] }
    paths[item] = itemPath
  }
  const addSpecialized = (path: string, method: 'get' | 'post' | 'patch' | 'delete', operationId: string, permission: string | undefined, status: string, params: unknown[] = [], requestBody?: unknown) => {
    const existing = (paths[path] as Record<string, unknown> | undefined) ?? {}
    paths[path] = { ...existing, [method]: { security: [{ cookieAuth: [] }], operationId, ...(permission ? { 'x-permission': permission } : {}), parameters: params, ...(requestBody ? { requestBody } : {}), responses: { [status]: { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  }
  const idParam = { $ref: '#/components/parameters/ResourceId' }
  const pathParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } })
  const mutationParam = { $ref: '#/components/parameters/IdempotencyKey' }
  const body = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } }
  for (const [route, action, permission, status] of [
    ['/enrollments', 'create', 'teaching.enrollments.create', '201'],
    ['/enrollments/{id}', 'update', 'teaching.enrollments.update', '200'],
    ['/enrollments/{id}', 'delete', 'teaching.enrollments.delete', '200'],
    ['/reports', 'create', 'teaching.reports.create', '201'],
    ['/reports/{id}', 'update', 'teaching.reports.update', '200'],
    ['/reports/{id}', 'delete', 'teaching.reports.delete', '200'],
    ['/occurrences/{id}', 'update', 'teaching.occurrences.update', '200'],
    ['/occurrences/{id}', 'delete', 'teaching.occurrences.delete', '200'],
    ['/student-suspensions', 'create', 'teaching.students.update', '201'],
    ['/student-suspensions/{id}', 'update', 'teaching.students.update', '200'],
    ['/student-suspensions/{id}', 'delete', 'teaching.students.update', '200'],
    ['/holidays', 'create', 'teaching.holidays.create', '201'],
    ['/holidays/{id}', 'update', 'teaching.holidays.update', '200'],
    ['/holidays/{id}', 'delete', 'teaching.holidays.delete', '200'],
  ] as const) {
    const method = action === 'create' ? 'post' : action === 'update' ? 'patch' : 'delete'
    addSpecialized(`/api${route}`, method, `${route.slice(1).replaceAll('/', '_').replaceAll('{id}', 'id')}_${action}`, permission, status, action === 'create' ? [mutationParam] : [idParam, mutationParam], action === 'delete' ? undefined : body)
  }
  addSpecialized('/api/occurrences/generate', 'post', 'occurrences_generate', 'teaching.occurrences.create', '200', [mutationParam], body)
  addSpecialized('/api/reports/{id}/collaboration', 'get', 'report_collaboration_read', 'teaching.reports.read', '200', [idParam])
  addSpecialized('/api/reports/{id}/collaboration', 'post', 'report_collaboration_save', 'teaching.reports.update', '200', [idParam, mutationParam], body)
  for (const [method, operationId, permission, status] of [
    ['get', 'class_session_teachers_list', 'teaching.class_sessions.list', '200'],
    ['post', 'class_session_teachers_create', 'teaching.class_sessions.update', '201'],
    ['delete', 'class_session_teachers_delete', 'teaching.class_sessions.update', '200'],
  ] as const) addSpecialized('/api/class-sessions/{sessionId}/teachers', method, operationId, permission, status, [pathParam('sessionId'), ...(method === 'get' ? [] : [mutationParam])], method === 'post' ? body : undefined)
  addSpecialized('/api/class-sessions/{sessionId}/teachers/{assignmentId}', 'patch', 'class_session_teachers_update', 'teaching.class_sessions.update', '200', [pathParam('sessionId'), pathParam('assignmentId'), mutationParam], body)
  addSpecialized('/api/class-sessions/{sessionId}/teachers/{teacherId}', 'delete', 'class_session_teachers_delete_teacher', 'teaching.class_sessions.update', '200', [pathParam('sessionId'), pathParam('teacherId'), mutationParam])
  paths['/api/class-sessions'] = {
    get: { operationId: 'class_sessions_list', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.list', parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Search' }, { $ref: '#/components/parameters/Filters' }, { $ref: '#/components/parameters/classroom_id' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    post: { operationId: 'class_sessions_create_with_schedule', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.create', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ClassSessionMutation' } } } }, responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/class-sessions/{id}'] = {
    get: { operationId: 'class_sessions_get', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.read', parameters: [pathParam('id')], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'class_sessions_update_with_schedule', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.update', parameters: [pathParam('id'), { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ClassSessionMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    delete: { operationId: 'class_sessions_delete', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.delete', parameters: [pathParam('id'), { $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/class-sessions/{id}/details'] = {
    get: { operationId: 'class_sessions_details', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.read', 'x-permissions': ['teaching.class_sessions.read', 'teaching.enrollments.list'], parameters: [pathParam('id')], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/class-sessions/{id}/enrollment-peak'] = {
    get: { operationId: 'class_sessions_enrollment_peak', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.read', 'x-permissions': ['teaching.class_sessions.read', 'teaching.occurrences.list', 'teaching.reports.list'], parameters: [pathParam('id'), { name: 'start_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'end_date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/teachings/{teachingId}/members'] = {
    get: { operationId: 'teaching_members_list', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.list', parameters: [pathParam('teachingId'), { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Search' }, { $ref: '#/components/parameters/Filters' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    post: { operationId: 'teaching_members_create', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.create', parameters: [pathParam('teachingId'), { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: body, responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/teachings/{teachingId}/members/{userId}'] = {
    get: { operationId: 'teaching_members_get', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.read', parameters: [pathParam('teachingId'), pathParam('userId')], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'teaching_members_update', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.update', parameters: [pathParam('teachingId'), pathParam('userId'), { $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    delete: { operationId: 'teaching_members_delete', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.delete', parameters: [pathParam('teachingId'), pathParam('userId'), { $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/occurrences/generate'] = {
    post: { operationId: 'occurrences_generate', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.occurrences.create', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OccurrenceGenerationMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollments/{id}/transfer-history'] = {
    get: { operationId: 'enrollment_transfer_history', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.read', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollments/{id}/effective-transfer-targets'] = {
    get: { operationId: 'enrollment_effective_transfer_targets', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.read', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollments/{id}/repair-transfer-report'] = {
    post: { operationId: 'enrollment_repair_transfer_report', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransferRepairMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollment-transfers/single-lesson'] = {
    post: { operationId: 'enrollment_transfer_single_lesson', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SingleLessonTransferMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollment-transfers/conflicts/resolve'] = {
    post: { operationId: 'enrollment_transfer_conflict_resolve', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransferConflictMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/enrollment-transfers/cancel'] = {
    post: { operationId: 'enrollment_transfer_cancel', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransferCancelMutation' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/occurrences/{id}/roster'] = {
    get: { operationId: 'occurrence_roster', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.occurrences.read', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/class-sessions/{id}/occurrences/sync'] = {
    post: { operationId: 'class_session_occurrences_sync', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.update', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { scope: { type: 'string', enum: ['future', 'all'], default: 'future' } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/holidays/check'] = {
    get: { operationId: 'holiday_check', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.holidays.list', parameters: [{ name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'classroom_id', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'class_session_id', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'teacher_id', in: 'query', schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  for (const aggregate of ['user-preferences', 'student-reports', 'classroom-session-manager', 'holidays-manager', 'incomplete-reports', 'dashboard']) {
    paths[`/api/aggregates/${aggregate}`] = { get: { operationId: `aggregate_${aggregate.replaceAll('-', '_')}`, security: [{ cookieAuth: [] }], 'x-permission': 'teaching.reports.list', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  }
  paths['/api/rpc/{name}'] = {
    post: {
      operationId: 'invoke_allowed_rpc',
      summary: 'Invoke an allowlisted business RPC through the authenticated user-JWT client',
      security: [{ cookieAuth: [] }],
      'x-rpc-allowlist': ['get_effective_occurrence_enrollment_ids', 'get_single_lesson_transfer_history', 'get_effective_single_lesson_transfer_targets', 'resolve_user_permission'],
      parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses },
    },
  }
  paths['/api/rbac/capability'] = {
    get: { operationId: 'rbac_capability', security: [{ cookieAuth: [] }], parameters: [{ name: 'permission', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/realtime'] = {
    get: {
      operationId: 'realtime_websocket',
      summary: 'Authenticated report collaboration WebSocket upgrade',
      description: 'Upgrade to a WebSocket after the HttpOnly session is authenticated and the user can read the requested report room. The room query parameter is a report UUID; the upstream Realtime access token is never exposed to the browser.',
      security: [{ cookieAuth: [] }],
      'x-websocket': true,
      'x-permission': 'teaching.reports.read',
      parameters: [{ name: 'room', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        '101': { description: 'WebSocket protocol upgrade' },
        '400': { description: 'Invalid report room' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '503': { description: 'Realtime upstream is unavailable' },
      },
    },
  }
  paths['/api/permissions/{permissionId}/policies'] = {
    get: { operationId: 'permission_policies_list', security: [{ cookieAuth: [] }], parameters: [{ name: 'permissionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'permission_policies_replace', security: [{ cookieAuth: [] }], parameters: [{ name: 'permissionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { $ref: '#/components/parameters/IdempotencyKey' }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  return {
    openapi: '3.1.0', info: { title: 'EduLog API', version: '1.0.0' }, servers: [{ url: '/' }], paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'edulog_access' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: { ResourceId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, Filters: { name: 'filters', in: 'query', description: 'JSON array of allowlisted field filters', schema: { type: 'string', maxLength: 8000 } }, Or: { name: 'or', in: 'query', description: 'Allowlisted PostgREST OR expression', schema: { type: 'string', maxLength: 2000 } }, Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, Sort: { name: 'sort', in: 'query', schema: { type: 'string' } }, Search: { name: 'search', in: 'query', schema: { type: 'string' } }, Status: { name: 'status', in: 'query', schema: { type: 'string' } }, ...Object.fromEntries(['teaching_id', 'course_id', 'classroom_id', 'class_session_id', 'class_occurrence_id', 'lesson_id', 'student_id', 'teacher_id', 'instructor_id', 'user_id', 'enrollment_id', 'occurrence_report_id', 'entity_type', 'entity_id', 'entity_ids', 'template_type', 'scope_type', 'scope_entity_id'].map((field) => [field, { name: field, in: 'query', schema: { type: 'string', ...(field.endsWith('_id') || field === 'entity_id' || field === 'scope_entity_id' ? { format: 'uuid' } : {}), ...(field === 'entity_ids' ? { description: 'Comma-separated UUIDs' } : {}) } }])), IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 255 } } },
      schemas: { Envelope: { type: 'object', required: ['data', 'meta', 'request_id', 'trace_id'], properties: { data: {}, meta: { type: 'object' }, request_id: { type: 'string' }, trace_id: { type: 'string' } } }, Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id', 'trace_id'], properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' }, trace_id: { type: 'string' }, fields: { type: 'object' } } } } }, OccurrenceGenerationMutation: { type: 'object', required: ['class_session_id', 'start_date', 'end_date'], properties: { class_session_id: { type: 'string', format: 'uuid' }, start_date: { type: 'string', format: 'date' }, end_date: { type: 'string', format: 'date' }, skip_existing_dates: { type: 'array', items: { type: 'string', format: 'date' } } } }, ClassSessionMutation: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, classroom_id: { type: ['string', 'null'], format: 'uuid' }, course_ids: { type: 'array', items: { type: 'string', format: 'uuid' } }, capacity: { type: 'integer', minimum: 0 }, start_date: { type: ['string', 'null'], format: 'date' }, end_date: { type: ['string', 'null'], format: 'date' }, time_zone: { type: 'string' }, session_type: { type: 'string', enum: ['regular', 'camp'] }, schedule_mode: { type: 'string', enum: ['weekly', 'monthly', 'specific_dates'] }, schedule_rules: { type: 'array', items: { type: 'object' } } } }, LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1 } } }, TransferRepairMutation: { type: 'object', required: ['target_occurrence_id'], properties: { target_occurrence_id: { type: 'string', format: 'uuid' } } }, SingleLessonTransferMutation: { type: 'object', required: ['enrollment_id', 'source_occurrence_id', 'target_occurrence_id'], properties: { enrollment_id: { type: 'string', format: 'uuid' }, source_occurrence_id: { type: 'string', format: 'uuid' }, target_occurrence_id: { type: 'string', format: 'uuid' }, report_id: { type: ['string', 'null'], format: 'uuid' } } }, TransferCancelMutation: { type: 'object', required: ['transfer_id'], properties: { transfer_id: { type: 'string', format: 'uuid' } } }, TransferConflictMutation: { type: 'object', required: ['enrollment_id', 'source_occurrence_id', 'target_occurrence_id', 'target_report_id', 'target_version', 'field_sources'], properties: { enrollment_id: { type: 'string', format: 'uuid' }, source_occurrence_id: { type: 'string', format: 'uuid' }, target_occurrence_id: { type: 'string', format: 'uuid' }, source_report_id: { type: ['string', 'null'], format: 'uuid' }, source_version: { type: ['integer', 'null'], minimum: 1 }, target_report_id: { type: 'string', format: 'uuid' }, target_version: { type: 'integer', minimum: 1 }, field_sources: { type: 'object' } } } },
      responses: {
        Envelope: { description: 'EduLog API response envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
        ...Object.fromEntries(Object.entries({ BadRequest: 'Invalid request', Unauthorized: 'Authentication required', Forbidden: 'Permission denied', NotFound: 'Resource not found', Conflict: 'Resource conflict', PayloadTooLarge: 'Payload too large', UnprocessableEntity: 'Validation failed', RateLimited: 'Rate limit exceeded', InternalError: 'Unexpected error' }).map(([name, description]) => [name, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]))
      }
    }
  }
}
