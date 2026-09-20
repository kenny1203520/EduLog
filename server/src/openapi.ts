import { z } from 'zod'
import { resources, resourceSchemas, teachingMemberCreateSchema, teachingMemberUpdateSchema } from './resources.js'
import { enrollmentBodySchema, enrollmentCreateSchema } from './enrollmentRouter.js'
import { occurrenceBodySchema, occurrenceGenerationSchema } from './occurrenceRouter.js'
import { reportCreateSchema, reportUpdateSchema, reportCollaborationSchema } from './reportRouter.js'
import { sessionSchema } from './sessionRouter.js'
import { suspensionCreateSchema, suspensionUpdateSchema } from './suspensionRouter.js'
import { holidayCreateSchema, holidayUpdateSchema } from './holidayRouter.js'
import { teacherAssignmentCreateSchema, teacherAssignmentUpdateSchema } from './teacherAssignmentRouter.js'
import { conflictBody, transferBody, repairBody, cancelBody } from './transferRouter.js'
import { permissionForResource } from './authorization.js'
import { allowedRpcs } from './rpcContract.js'

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

function runtimeDocument(schema: z.ZodType) {
  const document = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
  delete document.$schema
  return document
}

export function buildOpenApi() {
  const paths: Record<string, unknown> = {
    '/api/auth/login': { post: { operationId: 'login', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/auth/refresh': { post: { operationId: 'refresh', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/auth/logout': { post: { operationId: 'logout', responses: { '204': { description: 'Session cleared' }, ...errorResponses } } },
    '/api/auth/csrf': { get: { operationId: 'csrfToken', responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/auth/me': { get: { operationId: 'me', security: [{ cookieAuth: [] }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
    '/api/users/search': { get: { operationId: 'users_search', security: [{ cookieAuth: [] }], 'x-permission': 'system.users.list', parameters: [{ name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } }, { name: 'only_unlinked', in: 'query', required: false, schema: { type: 'boolean' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } },
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
  paths['/api/students/{id}/credentials'] = {
    get: {
      operationId: 'students_get_sensitive_credentials',
      summary: 'Read student credentials through the separately authorized sensitive-data route',
      security: [{ cookieAuth: [] }],
      'x-permission': 'teaching.students.read_sensitive',
      'x-sensitive-data': true,
      parameters: [{ $ref: '#/components/parameters/ResourceId' }],
      responses: {
        '200': { description: 'Authorized student credentials; password values are restricted sensitive data', content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/Envelope' }, { type: 'object', properties: { data: { $ref: '#/components/schemas/StudentCredentialSensitiveData' } } }] } } } },
        ...errorResponses,
      },
    },
  }
  const addSpecialized = (path: string, method: 'get' | 'post' | 'patch' | 'delete', operationId: string, permission: string | undefined, status: string, params: unknown[] = [], requestBody?: unknown) => {
    const existing = (paths[path] as Record<string, unknown> | undefined) ?? {}
    paths[path] = { ...existing, [method]: { security: [{ cookieAuth: [] }], operationId, ...(permission ? { 'x-permission': permission, 'x-required-permissions': [permission] } : {}), parameters: params, ...(requestBody ? { requestBody } : {}), responses: { [status]: { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  }
  const idParam = { $ref: '#/components/parameters/ResourceId' }
  const pathParam = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } })
  const mutationParam = { $ref: '#/components/parameters/IdempotencyKey' }
  const refBody = (name: string) => ({ required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } })
  const bodyFor = (route: string, action: 'create' | 'update') => {
    const resource = route.split('/')[1]
    if (resource === 'enrollments') return refBody(action === 'create' ? 'EnrollmentCreateMutation' : 'EnrollmentUpdateMutation')
    if (resource === 'reports') return refBody(action === 'create' ? 'ReportCreateMutation' : 'ReportUpdateMutation')
    if (resource === 'occurrences') return refBody('OccurrenceMutation')
    if (resource === 'student-suspensions') return refBody(action === 'create' ? 'SuspensionCreateMutation' : 'SuspensionUpdateMutation')
    if (resource === 'holidays') return refBody(action === 'create' ? 'HolidayCreateMutation' : 'HolidayUpdateMutation')
    return { required: true, content: { 'application/json': { schema: { type: 'object', properties: {}, additionalProperties: false } } } }
  }
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
    addSpecialized(`/api${route}`, method, `${route.slice(1).replaceAll('/', '_').replaceAll('{id}', 'id')}_${action}`, permission, status, action === 'create' ? [mutationParam] : [idParam, mutationParam], action === 'delete' ? undefined : bodyFor(route, action as 'create' | 'update'))
  }
  addSpecialized('/api/occurrences/generate', 'post', 'occurrences_generate', 'teaching.occurrences.create', '200', [mutationParam], refBody('OccurrenceGenerationMutation'))
  paths['/api/occurrences'] = {
    get: { operationId: 'occurrences_list_scoped', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.occurrences.list', parameters: [
      { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' },
      { name: 'start', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'end', in: 'query', schema: { type: 'string', format: 'date' } },
      { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } }, { name: 'class_session_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'session_ids', in: 'query', schema: { type: 'string' } }, { name: 'ids', in: 'query', schema: { type: 'string' } },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: ['occurrence_date', '-occurrence_date', 'created_at', '-created_at'] } },
    ], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/occurrences/{id}/preferred'] = { get: { operationId: 'occurrence_preferred', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.occurrences.read', parameters: [pathParam('id'), { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/occurrences/{id}/navigation'] = { get: { operationId: 'occurrence_navigation', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.occurrences.read', parameters: [pathParam('id'), { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/occurrences/{occurrenceId}/reports'] = { post: { operationId: 'occurrence_reports_provision', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.reports.create', parameters: [pathParam('occurrenceId'), mutationParam], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/reports/progress-summary'] = { get: { operationId: 'reports_progress_summary', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.reports.list', parameters: [{ name: 'enrollment_ids', in: 'query', required: true, schema: { type: 'string', description: 'Comma-separated enrollment UUIDs, maximum 100' } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 1000 } }, { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_at', '-created_at', 'updated_at', '-updated_at'], default: '-created_at' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/reports/{reportId}/versions/{versionId}/restore'] = { post: { operationId: 'report_version_restore', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.reports.update', parameters: [pathParam('reportId'), pathParam('versionId'), mutationParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expected_version'], additionalProperties: false, properties: { expected_version: { type: 'integer', minimum: 1 } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/reports/{reportId}/conflicts/resolve'] = { post: { operationId: 'report_conflict_resolve', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.reports.update', parameters: [pathParam('reportId'), mutationParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['expected_version', 'report'], additionalProperties: false, properties: { expected_version: { type: 'integer', minimum: 1 }, report: { $ref: '#/components/schemas/ReportUpdateMutation' } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/enrollments/{id}/progress'] = { get: { operationId: 'enrollment_progress_get', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.read', parameters: [pathParam('id')], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/enrollments/{id}/progress/recalculate'] = { post: { operationId: 'enrollment_progress_recalculate', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [pathParam('id'), mutationParam], requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/enrollments/{id}/transfers/class'] = { post: { operationId: 'enrollment_transfer_class', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.enrollments.update', parameters: [pathParam('id'), mutationParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['target_class_session_id', 'transfer_date'], additionalProperties: false, properties: { target_class_session_id: { type: 'string', format: 'uuid' }, original_last_date: { type: 'string', format: 'date' }, transfer_date: { type: 'string', format: 'date' } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/teachers/bulk-delete'] = { post: { operationId: 'teachers_bulk_delete', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.teachers.delete', parameters: [mutationParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['ids'], additionalProperties: false, properties: { ids: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', format: 'uuid' } } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  paths['/api/copy-templates/{templateType}/{scopeType}/{scopeEntityId}'] = { put: { operationId: 'copy_template_put_scoped', security: [{ cookieAuth: [] }], 'x-permission': 'system.users.update', parameters: [pathParam('scopeEntityId'), { name: 'templateType', in: 'path', required: true, schema: { type: 'string' } }, { name: 'scopeType', in: 'path', required: true, schema: { type: 'string' } }, mutationParam], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { template_text: { type: 'string', nullable: true }, template_document: { type: 'object', nullable: true } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } } }
  addSpecialized('/api/reports/{id}/collaboration', 'get', 'report_collaboration_read', 'teaching.reports.read', '200', [idParam])
  addSpecialized('/api/reports/{id}/collaboration', 'post', 'report_collaboration_save', 'teaching.reports.update', '200', [idParam, mutationParam], refBody('ReportCollaborationMutation'))
  const teacherAssignmentDateParameter = { name: 'on_date', in: 'query', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }
  const teacherAssignmentRemoveParameters = [
    { name: 'teacher_id', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } },
    { name: 'effective_from', in: 'query', required: false, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  ]
  for (const [method, operationId, permission, status] of [
    ['get', 'class_session_teachers_by_session_list', 'teaching.class_sessions.list', '200'],
    ['post', 'class_session_teachers_create', 'teaching.class_sessions.update', '201'],
    ['delete', 'class_session_teachers_delete', 'teaching.class_sessions.update', '200'],
  ] as const) addSpecialized('/api/class-sessions/{sessionId}/teachers', method, operationId, permission, status, [pathParam('sessionId'), ...(method === 'get' ? [teacherAssignmentDateParameter] : method === 'delete' ? [...teacherAssignmentRemoveParameters, mutationParam] : [mutationParam])], method === 'post' ? refBody('TeacherAssignmentMutation') : undefined)
  addSpecialized('/api/class-sessions/{sessionId}/teachers/{assignmentId}', 'patch', 'class_session_teachers_update', 'teaching.class_sessions.update', '200', [pathParam('sessionId'), pathParam('assignmentId'), mutationParam], refBody('TeacherAssignmentUpdateMutation'))
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
    get: { operationId: 'teaching_members_list', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.list', parameters: [pathParam('teachingId'), { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }, { $ref: '#/components/parameters/Sort' }, { $ref: '#/components/parameters/Filters' }, { name: 'user_id', in: 'query', required: false, schema: { type: 'string', format: 'uuid' } }, { name: 'status', in: 'query', required: false, schema: { type: 'string', minLength: 1, maxLength: 32 } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    post: { operationId: 'teaching_members_create', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.create', parameters: [pathParam('teachingId'), { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: refBody('TeachingMemberCreateMutation'), responses: { '201': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/teachings/{teachingId}/members/{userId}'] = {
    get: { operationId: 'teaching_members_get', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.read', parameters: [pathParam('teachingId'), pathParam('userId')], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
    patch: { operationId: 'teaching_members_update', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.members.update', parameters: [pathParam('teachingId'), pathParam('userId'), { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: refBody('TeachingMemberUpdateMutation'), responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
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
    post: { operationId: 'class_session_occurrences_sync', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.class_sessions.update', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, { $ref: '#/components/parameters/IdempotencyKey' }], requestBody: { content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { scope: { type: 'string', enum: ['future', 'all'], default: 'future' } } } } } }, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  paths['/api/holidays/check'] = {
    get: { operationId: 'holiday_check', security: [{ cookieAuth: [] }], 'x-permission': 'teaching.holidays.list', parameters: [{ name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } }, { name: 'classroom_id', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'class_session_id', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'teacher_id', in: 'query', schema: { type: 'string', format: 'uuid' } }], responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } },
  }
  const pageBase = { security: [{ cookieAuth: [] }], 'x-page-api': true, responses: { '200': { $ref: '#/components/responses/Envelope' }, ...errorResponses } }
  const pageResponse = (schema: string) => ({
    description: 'Page API response envelope',
    content: { 'application/json': { schema: {
      type: 'object', required: ['data', 'meta', 'request_id', 'trace_id'],
      properties: { data: { $ref: `#/components/schemas/${schema}` }, meta: { type: 'object' }, request_id: { type: 'string' }, trace_id: { type: 'string' } },
    } } },
  })
  paths['/api/pages/me/preferences'] = {
    get: {
      ...pageBase,
      operationId: 'page_me_preferences',
      summary: 'Read the signed-in user preferences read model',
      'x-permission': 'self.user_preferences.read',
    },
  }
  paths['/api/pages/enrollments/{enrollmentId}/reports'] = {
    get: {
      ...pageBase,
      operationId: 'page_enrollment_reports',
      summary: 'Read an enrollment and its visible reports for the enrollment page',
      'x-permission': 'teaching.reports.list',
      parameters: [
        { name: 'enrollmentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { $ref: '#/components/parameters/Limit' },
        { $ref: '#/components/parameters/Offset' },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['occurrence_date', '-occurrence_date', 'updated_at', '-updated_at'], default: '-occurrence_date' } },
      ],
    },
  }
  paths['/api/pages/classrooms/overview'] = {
    get: {
      ...pageBase,
      operationId: 'page_classrooms_overview',
      summary: 'Read the classroom management page read model',
      'x-permission': 'teaching.classrooms.list',
      parameters: [
        { $ref: '#/components/parameters/Limit' },
        { $ref: '#/components/parameters/Offset' },
        { $ref: '#/components/parameters/Search' },
        { name: 'visibility', in: 'query', schema: { type: 'string', enum: ['all', 'visible', 'hidden'], default: 'all' } },
      ],
      responses: { '200': pageResponse('PageClassroomsOverviewData'), ...errorResponses },
    },
  }
  paths['/api/pages/holidays/overview'] = {
    get: {
      ...pageBase,
      operationId: 'page_holidays_overview',
      summary: 'Read the holiday management page read model',
      'x-permission': 'teaching.holidays.list',
      parameters: [
        { name: 'expand', in: 'query', schema: { type: 'boolean', default: true } },
        { $ref: '#/components/parameters/Limit' },
        { $ref: '#/components/parameters/Offset' },
        { $ref: '#/components/parameters/Search' },
        { name: 'sort', in: 'query', schema: { type: 'string', enum: ['start_date', '-start_date', 'name', '-name'], default: '-start_date' } },
      ],
    },
  }
  paths['/api/pages/reports/incomplete'] = {
    get: {
      ...pageBase,
      operationId: 'page_incomplete_reports',
      summary: 'Read incomplete reports for the report workflow page',
      'x-permission': 'teaching.reports.list',
      parameters: [
        { name: 'days_back', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 3650, default: 90 } },
        { name: 'scope', in: 'query', schema: { type: 'string', enum: ['all', 'my_present', 'my_notifications'], default: 'all' } },
        { $ref: '#/components/parameters/Limit' },
        { $ref: '#/components/parameters/Offset' },
      ],
    },
  }
  paths['/api/pages/dashboard'] = {
    get: {
      ...pageBase,
      operationId: 'page_dashboard',
      summary: 'Read the dashboard page read model',
      'x-permission': 'teaching.reports.list',
      parameters: [
        { name: 'start', in: 'query', required: false, schema: { type: 'string', format: 'date' } },
        { name: 'end', in: 'query', required: false, schema: { type: 'string', format: 'date' } },
      ],
    },
  }
  const pageListParameters = [
    { $ref: '#/components/parameters/Limit' },
    { $ref: '#/components/parameters/Offset' },
    { $ref: '#/components/parameters/Search' },
    { name: 'sort', in: 'query', schema: { type: 'string' } },
  ]
  paths['/api/pages/courses/overview'] = { get: {
    ...pageBase, operationId: 'page_courses_overview', summary: 'Read the course management page read model',
    'x-permission': 'teaching.courses.list', parameters: pageListParameters,
    responses: { '200': pageResponse('PageCoursesOverviewData'), ...errorResponses },
  } }
  paths['/api/pages/students/overview'] = { get: {
    ...pageBase, operationId: 'page_students_overview', summary: 'Read the student management page read model without contact or credential values',
    'x-permission': 'teaching.students.list', parameters: [
      ...pageListParameters.slice(0, 3),
      { name: 'sort', in: 'query', schema: { type: 'string', enum: ['name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at'], default: 'name' } },
    ],
    responses: { '200': pageResponse('PageStudentsOverviewData'), ...errorResponses },
  } }
  paths['/api/pages/students/{studentId}/profile'] = { get: {
    ...pageBase, operationId: 'page_student_profile', summary: 'Read one student profile and its required profile relations',
    'x-permission': 'teaching.students.read', parameters: [{ name: 'studentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { '200': pageResponse('PageStudentProfileData'), ...errorResponses },
  } }
  paths['/api/pages/students/{studentId}/private-details'] = { get: {
    ...pageBase, operationId: 'page_student_private_details', summary: 'Read explicitly authorized student personal details and contacts',
    'x-permission': 'teaching.students.read_sensitive', parameters: [{ name: 'studentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { '200': pageResponse('PageStudentPrivateDetailsData'), ...errorResponses },
  } }
  paths['/api/pages/students/{studentId}/reports'] = { get: {
    ...pageBase, operationId: 'page_student_reports', summary: 'Read a student and paginated enrollment history for the reports page',
    'x-permission': 'teaching.students.read', parameters: [
      { name: 'studentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      { $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' },
      { name: 'sort', in: 'query', schema: { type: 'string', enum: ['start_date', '-start_date', 'created_at', '-created_at'], default: '-start_date' } },
    ], responses: { '200': pageResponse('PageStudentReportsData'), ...errorResponses },
  } }
  paths['/api/pages/teachers/overview'] = { get: {
    ...pageBase, operationId: 'page_teachers_overview', summary: 'Read the teacher management list without credential values or profile secrets',
    'x-permission': 'teaching.teachers.list', parameters: pageListParameters,
    responses: { '200': pageResponse('PageTeachersOverviewData'), ...errorResponses },
  } }
  paths['/api/pages/teachers/{teacherId}/private-details'] = { get: {
    ...pageBase, operationId: 'page_teacher_private_details', summary: 'Read explicitly authorized teacher personal details and credentials',
    'x-permission': 'teaching.teachers.read_sensitive', parameters: [{ name: 'teacherId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { '200': pageResponse('PageTeacherPrivateDetailsData'), ...errorResponses },
  } }
  paths['/api/pages/class-sessions/{sessionId}/workspace'] = { get: {
    ...pageBase, operationId: 'page_class_session_workspace', summary: 'Read the class session workspace read model',
    'x-permission': 'teaching.class_sessions.read', parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: { '200': pageResponse('PageClassSessionWorkspaceData'), ...errorResponses },
  } }
  paths['/api/rpc/{name}'] = {
    post: {
      operationId: 'invoke_allowed_rpc',
      summary: 'Invoke an allowlisted business RPC through the authenticated user-JWT client',
      security: [{ cookieAuth: [] }],
      'x-rpc-allowlist': [...allowedRpcs],
      parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }, { $ref: '#/components/parameters/IdempotencyKey' }],
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RpcInvocation' } } } },
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
  const specializedSchemas = {
    EnrollmentCreateMutation: runtimeDocument(enrollmentCreateSchema),
    EnrollmentUpdateMutation: runtimeDocument(enrollmentBodySchema),
    ReportCreateMutation: runtimeDocument(reportCreateSchema),
    ReportUpdateMutation: runtimeDocument(reportUpdateSchema),
    OccurrenceMutation: runtimeDocument(occurrenceBodySchema),
    SuspensionCreateMutation: runtimeDocument(suspensionCreateSchema),
    SuspensionUpdateMutation: runtimeDocument(suspensionUpdateSchema),
    HolidayCreateMutation: runtimeDocument(holidayCreateSchema),
    HolidayUpdateMutation: runtimeDocument(holidayUpdateSchema),
    ReportCollaborationMutation: runtimeDocument(reportCollaborationSchema),
    TeacherAssignmentMutation: runtimeDocument(teacherAssignmentCreateSchema),
    TeacherAssignmentUpdateMutation: runtimeDocument(teacherAssignmentUpdateSchema),
    TeachingMemberCreateMutation: runtimeDocument(teachingMemberCreateSchema),
    TeachingMemberUpdateMutation: runtimeDocument(teachingMemberUpdateSchema),
    TransferMutation: runtimeDocument(transferBody),
    // Zod's JSON Schema emitter represents nullable fields conservatively and
    // can omit them from `required`; the runtime validator still requires
    // source_version (it only permits null as its value). Preserve that
    // distinction explicitly in the public contract.
    TransferConflictMutation: {
      ...runtimeDocument(conflictBody),
      required: ['enrollment_id', 'source_occurrence_id', 'target_occurrence_id', 'source_report_id', 'source_version', 'target_report_id', 'target_version', 'field_sources'],
    },
    TransferRepairMutation: runtimeDocument(repairBody),
    TransferCancelMutation: runtimeDocument(cancelBody),
    RpcInvocation: { oneOf: [
      { type: 'object', required: ['class_occurrence_id'], additionalProperties: false, properties: { class_occurrence_id: { type: 'string', format: 'uuid' } } },
      { type: 'object', required: ['enrollment_id'], additionalProperties: false, properties: { enrollment_id: { type: 'string', format: 'uuid' } } },
      { type: 'object', required: ['user_id', 'permission_key'], additionalProperties: false, properties: { user_id: { type: 'string', format: 'uuid' }, permission_key: { type: 'string', minLength: 1, maxLength: 200 }, teaching_id: { type: 'string', format: 'uuid' }, classroom_id: { type: 'string', format: 'uuid' }, class_session_id: { type: 'string', format: 'uuid' } } },
    ] },
  }
  const pageResponseSchemas = {
    PageClassroomsOverviewData: {
      type: 'object',
      required: ['classrooms', 'count', 'hiddenClassroomIds', 'hiddenSessionIds', 'classSessions', 'sessionCount', 'classroomTotal', 'visibleClassroomCount', 'hiddenClassroomCount', 'sessionTotal', 'visibleSessionCount', 'hiddenSessionCount'],
      properties: {
        classrooms: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, color: { type: ['string', 'null'] }, external_link: { type: ['string', 'null'] }, teaching_id: { type: ['string', 'null'], format: 'uuid' }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' } } } },
        count: { type: 'integer', minimum: 0 },
        classroomTotal: { type: 'integer', minimum: 0 },
        visibleClassroomCount: { type: 'integer', minimum: 0 },
        hiddenClassroomCount: { type: 'integer', minimum: 0 },
        hiddenClassroomIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        hiddenSessionIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        classSessions: { type: 'array', items: { type: 'object' } },
        sessionCount: { type: 'integer', minimum: 0 },
        sessionTotal: { type: 'integer', minimum: 0 },
        visibleSessionCount: { type: 'integer', minimum: 0 },
        hiddenSessionCount: { type: 'integer', minimum: 0 },
      },
    },
    PageCoursesOverviewData: { type: 'array', items: { type: 'object', required: ['id', 'subject', 'stage'], properties: { id: { type: 'string', format: 'uuid' }, subject: { type: 'string' }, stage: { type: 'string' }, display_name: { type: ['string', 'null'] }, description: { type: ['string', 'null'] }, description_document: { type: ['object', 'null'] }, lessons: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, course_id: { type: 'string', format: 'uuid' }, title: { type: 'string' }, sequence: { type: 'integer' } } } } } } },
    PageStudentsOverviewData: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, notes: { type: ['string', 'null'] }, notes_document: { type: ['object', 'null'] }, external_link: { type: ['string', 'null'] }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' } } } },
    PageStudentProfileData: { type: 'object', required: ['id', 'name', 'capabilities'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, notes: { type: ['string', 'null'] }, notes_document: { type: ['object', 'null'] }, external_link: { type: ['string', 'null'] }, enrollments: { type: 'array', items: { type: 'object' } }, capabilities: { type: 'object', required: ['read_sensitive', 'update_sensitive'], properties: { read_sensitive: { type: 'boolean' }, update_sensitive: { type: 'boolean' } } } } },
    PageStudentPrivateDetailsData: { type: 'object', required: ['student', 'contacts', 'schools'], properties: { student: { type: 'object' }, contacts: { type: 'array', items: { type: 'object' } }, schools: { type: 'array', items: { type: 'object' } } } },
    StudentCredentialSensitiveData: { type: 'array', items: { type: 'object', required: ['id', 'student_id', 'platform'], properties: { id: { type: 'string', format: 'uuid' }, student_id: { type: 'string', format: 'uuid' }, platform: { type: 'string' }, username: { type: ['string', 'null'] }, password: { type: ['string', 'null'], writeOnly: false }, url: { type: ['string', 'null'] }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' } } } },
    PageStudentReportsData: { type: 'object', required: ['student', 'enrollments'], properties: { student: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } }, enrollments: { type: 'array', items: { type: 'object' } } } },
    PageTeachersOverviewData: { type: 'object', required: ['teachers', 'statistics'], properties: { teachers: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, user_id: { type: ['string', 'null'], format: 'uuid' }, name: { type: 'string' }, bio: { type: ['string', 'null'] }, bio_document: { type: ['object', 'null'] }, created_at: { type: 'string', format: 'date-time' }, updated_at: { type: ['string', 'null'], format: 'date-time' } } } }, statistics: { type: 'object', required: ['totalTeachers', 'linkedAccounts', 'unlinkedAccounts', 'completeProfiles'], properties: { totalTeachers: { type: 'integer' }, linkedAccounts: { type: 'integer' }, unlinkedAccounts: { type: 'integer' }, completeProfiles: { type: 'integer' } } } } },
    PageTeacherPrivateDetailsData: { type: 'object', required: ['teacher', 'credentials'], properties: { teacher: { type: 'object' }, credentials: { type: 'array', items: { type: 'object' } } } },
    PageClassSessionWorkspaceData: { type: 'object', required: ['session', 'enrollments', 'teachers'], properties: { session: { type: 'object' }, enrollments: { type: 'array', items: { type: 'object' } }, teachers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, user_id: { type: ['string', 'null'], format: 'uuid' }, name: { type: 'string' } } } } } },
  }
  return {
    openapi: '3.1.0', info: { title: 'EduLog API', version: '1.0.0' }, servers: [{ url: '/' }], paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'edulog_access' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      parameters: { ResourceId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }, Filters: { name: 'filters', in: 'query', description: 'JSON array of allowlisted field filters', schema: { type: 'string', maxLength: 8000 } }, Or: { name: 'or', in: 'query', description: 'Allowlisted PostgREST OR expression', schema: { type: 'string', maxLength: 2000 } }, Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } }, Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }, Sort: { name: 'sort', in: 'query', schema: { type: 'string' } }, Search: { name: 'search', in: 'query', schema: { type: 'string' } }, Status: { name: 'status', in: 'query', schema: { type: 'string' } }, ...Object.fromEntries(['teaching_id', 'course_id', 'classroom_id', 'class_session_id', 'class_occurrence_id', 'lesson_id', 'student_id', 'teacher_id', 'instructor_id', 'user_id', 'enrollment_id', 'occurrence_report_id', 'entity_type', 'entity_id', 'entity_ids', 'template_type', 'scope_type', 'scope_entity_id'].map((field) => [field, { name: field, in: 'query', schema: { type: 'string', ...(field.endsWith('_id') || field === 'entity_id' || field === 'scope_entity_id' ? { format: 'uuid' } : {}), ...(field === 'entity_ids' ? { description: 'Comma-separated UUIDs' } : {}) } }])), IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 255 } } },
      schemas: { ...specializedSchemas, ...pageResponseSchemas, Envelope: { type: 'object', required: ['data', 'meta', 'request_id', 'trace_id'], properties: { data: {}, meta: { type: 'object' }, request_id: { type: 'string' }, trace_id: { type: 'string' } } }, Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id', 'trace_id'], properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' }, trace_id: { type: 'string' }, fields: { type: 'object' } } } } }, OccurrenceGenerationMutation: runtimeDocument(occurrenceGenerationSchema), ClassSessionMutation: runtimeDocument(sessionSchema), LoginRequest: { type: 'object', required: ['email', 'password'], additionalProperties: false, properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1 } } }, SingleLessonTransferMutation: runtimeDocument(transferBody) },
      responses: {
        Envelope: { description: 'EduLog API response envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
        ...Object.fromEntries(Object.entries({ BadRequest: 'Invalid request', Unauthorized: 'Authentication required', Forbidden: 'Permission denied', NotFound: 'Resource not found', Conflict: 'Resource conflict', PayloadTooLarge: 'Payload too large', UnprocessableEntity: 'Validation failed', RateLimited: 'Rate limit exceeded', InternalError: 'Unexpected error' }).map(([name, description]) => [name, { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]))
      }
    }
  }
}
