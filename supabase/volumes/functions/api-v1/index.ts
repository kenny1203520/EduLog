import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { ApiError, audit, authenticate, beginIdempotency, completeIdempotency, corsHeaders, emitTelemetry, enforceRateLimit, handleError, parseJson, requirePermission, requestId, response, traceId } from '../_shared/api.ts'
import { parsePagination, ValidationError, validateWritableFields } from '../_shared/validation.ts'

const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'EduLog API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    headers: {
      RequestId: { schema: { type: 'string' }, description: 'Server request correlation identifier' },
      TraceId: { schema: { type: 'string' }, description: 'W3C trace identifier' },
    },
    parameters: {
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
      Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
      Sort: { name: 'sort', in: 'query', schema: { type: 'string', example: 'created_at:desc' } },
      IdempotencyKey: { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } },
    },
    schemas: {
      ApiError: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'request_id', 'trace_id'], properties: { code: { type: 'string' }, message: { type: 'string' }, request_id: { type: 'string' }, trace_id: { type: 'string' }, fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } } } } } },
      CollectionMeta: { type: 'object', required: ['limit', 'offset'], properties: { limit: { type: 'integer' }, offset: { type: 'integer' }, sort: { type: 'string' } } },
      ApiEnvelope: { type: 'object', required: ['data', 'request_id', 'trace_id'], properties: { data: {}, meta: { '$ref': '#/components/schemas/CollectionMeta' }, request_id: { type: 'string' }, trace_id: { type: 'string' } } },
    },
    responses: {
      Unauthorized: { description: 'Missing or invalid Supabase JWT', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
      Forbidden: { description: 'Permission or teaching scope denied', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
      ValidationError: { description: 'Schema or business validation failed', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
      RateLimited: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
    },
  },
  'x-idempotency': { methods: ['POST', 'PATCH', 'DELETE'], header: 'Idempotency-Key', replay: 'same response body with the current request_id and trace_id' },
  'x-pagination': { parameters: ['limit', 'offset', 'search', 'sort'], sort: 'field:asc|desc; supported fields are resource-specific' },
  paths: {
    '/health': { get: { security: [], responses: { '200': { description: 'Healthy' } } } },
    '/me': { get: { responses: { '200': { description: 'Current user' }, '401': { description: 'Unauthorized' } } } },
    '/permissions': { get: { responses: { '200': { description: 'Available permissions' } } } },
    '/roles': { get: { responses: { '200': { description: 'Roles' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } }, post: { responses: { '201': { description: 'Created' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' }, '429': { description: 'Rate limited' } } } },
    '/audit-events': { get: { responses: { '200': { description: 'Audit events' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } } },
    '/classrooms': { get: { responses: { '200': { description: 'Classrooms' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } }, post: { responses: { '201': { description: 'Created' }, '403': { description: 'Forbidden' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' } } } },
    '/classrooms/{id}': { get: { responses: { '200': { description: 'Classroom' }, '404': { description: 'Not found' } } }, patch: { responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } } }, delete: { responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } } } },
    '/class-sessions': { get: { responses: { '200': { description: 'Class sessions' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/students': { get: { responses: { '200': { description: 'Students' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/reports': { get: { responses: { '200': { description: 'Reports' } } } },
    '/teachings': { get: { responses: { '200': { description: 'Teaching collection' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' } } }, post: { responses: { '201': { description: 'Created' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' } } } },
    '/teachings/{id}': { get: { responses: { '200': { description: 'Teaching' }, '404': { description: 'Not found' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/teachings/{id}/members': { get: { responses: { '200': { description: 'Teaching members' }, '403': { description: 'Forbidden' } } }, post: { responses: { '201': { description: 'Member added' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' } } } },
    '/courses': { get: { responses: { '200': { description: 'Courses' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/courses/{id}': { get: { responses: { '200': { description: 'Course' }, '404': { description: 'Not found' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/lessons': { get: { responses: { '200': { description: 'Lessons' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/lessons/{id}': { get: { responses: { '200': { description: 'Lesson' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/enrollments': { get: { responses: { '200': { description: 'Enrollments' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/enrollments/{id}': { get: { responses: { '200': { description: 'Enrollment' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/occurrences': { get: { responses: { '200': { description: 'Occurrences' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/occurrences/{id}': { get: { responses: { '200': { description: 'Occurrence' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/report-templates': { get: { responses: { '200': { description: 'Report templates' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/report-templates/{id}': { get: { responses: { '200': { description: 'Report template' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
    '/holidays': { get: { responses: { '200': { description: 'Holidays' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/holidays/{id}': { get: { responses: { '200': { description: 'Holiday' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
  },
}

const openapi = OPENAPI as any
const commonErrors = {
  '400': { '$ref': '#/components/responses/BadRequest' },
  '401': { '$ref': '#/components/responses/Unauthorized' },
  '403': { '$ref': '#/components/responses/Forbidden' },
  '404': { '$ref': '#/components/responses/NotFound' },
  '409': { '$ref': '#/components/responses/Conflict' },
  '413': { '$ref': '#/components/responses/PayloadTooLarge' },
  '422': { '$ref': '#/components/responses/ValidationError' },
  '429': { '$ref': '#/components/responses/RateLimited' },
  '500': { '$ref': '#/components/responses/InternalError' },
}
Object.assign(openapi.components.responses, {
  BadRequest: { description: 'Malformed request', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
  NotFound: { description: 'Resource not found or not visible', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
  Conflict: { description: 'State conflict', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
  PayloadTooLarge: { description: 'Payload exceeds the configured limit', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
  InternalError: { description: 'Unexpected server error', content: { 'application/json': { schema: { '$ref': '#/components/schemas/ApiError' } } } },
})
openapi.paths['/roles/{id}'] = { get: { responses: { '200': { description: 'Role' } } }, patch: { responses: { '200': { description: 'Updated role' } } }, delete: { responses: { '200': { description: 'Deleted role' } } } }
for (const [path, pathItem] of Object.entries(openapi.paths) as [string, Record<string, any>][]) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!['get', 'post', 'patch', 'delete'].includes(method)) continue
    operation.responses = { ...commonErrors, ...operation.responses }
    const pathResource = path.split('/')[1] ?? 'unknown'
    const normalizedResource = pathResource === 'report-templates' ? 'templates' : pathResource.replaceAll('-', '_')
    const operationAction = method === 'get' ? (path.includes('{') ? 'read' : 'list') : method
    operation['x-permission'] = path === '/permissions' ? 'system.permissions.read' : path.startsWith('/roles') ? 'system.roles.manage' : path === '/audit-events' ? 'system.audit.list' : path.includes('/members') ? (method === 'get' ? 'teaching.members.list' : 'teaching.members.manage') : path === '/health' || path === '/me' ? undefined : 'teaching.' + normalizedResource + '.' + operationAction
    if (method === 'get' && path !== '/health') operation.parameters = [...(operation.parameters ?? []), { '$ref': '#/components/parameters/Limit' }, { '$ref': '#/components/parameters/Offset' }, { '$ref': '#/components/parameters/Sort' }]
    if (['post', 'patch', 'delete'].includes(method)) operation.parameters = [...(operation.parameters ?? []), { '$ref': '#/components/parameters/IdempotencyKey' }]
  }
}

const resourceDefinitions = {
  classrooms: { table: 'classrooms', select: 'id,name,color,address,phone,external_link,teaching_id,user_id,created_at,updated_at', fields: ['name', 'color', 'address', 'phone', 'external_link', 'teaching_id'] },
  class_sessions: { table: 'class_sessions', select: 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,teaching_id,user_id,created_at,updated_at', fields: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id'] },
  'class-sessions': { table: 'class_sessions', select: 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,teaching_id,user_id,created_at,updated_at', fields: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id'] },
  students: { table: 'students', select: 'id,name,notes,gov_id,email,phone,residence_address,mailing_address,birthday,external_link,user_id,created_at,updated_at', fields: ['name', 'notes', 'gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday', 'external_link'] },
  reports: { table: 'occurrence_reports', select: 'id,enrollment_id,class_occurrence_id,lesson_id,content,content_document,attendance_status,is_completed,progress_letter,class_participation,classroom_behavior,contact_notes,class_notes,external_link,version,updated_at', fields: [] },
  teachings: { table: 'teachings', select: 'id,name,owner_user_id,is_quarantine,created_at,updated_at', fields: ['name'] },
  courses: { table: 'courses', select: 'id,subject,stage,description,display_name,teaching_id,user_id,created_at,updated_at', fields: ['subject', 'stage', 'description', 'display_name', 'teaching_id'] },
  lessons: { table: 'lessons', select: 'id,course_id,title,sequence,user_id,created_at,updated_at', fields: ['course_id', 'title', 'sequence'] },
  enrollments: { table: 'enrollments', select: 'id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,user_id,created_at,updated_at', fields: ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link'] },
  occurrences: { table: 'class_occurrences', select: 'id,class_session_id,occurrence_date,status,teacher_ids,teacher_attendance,notes,is_conducted,created_at,updated_at', fields: ['class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted'] },
  report_templates: { table: 'report_templates', select: 'id,name,content,contact_notes,class_notes,instructor_id,teaching_id,created_at,updated_at', fields: ['name', 'content', 'contact_notes', 'class_notes', 'teaching_id'] },
  'report-templates': { table: 'report_templates', select: 'id,name,content,contact_notes,class_notes,instructor_id,teaching_id,created_at,updated_at', fields: ['name', 'content', 'contact_notes', 'class_notes', 'teaching_id'] },
  holidays: { table: 'holidays', select: 'id,name,start_date,end_date,classroom_ids,class_session_ids,created_at,updated_at', fields: ['name', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids'] },
} as const

function resourceDefinition(resource: string) {
  const definition = resourceDefinitions[resource as keyof typeof resourceDefinitions]
  if (!definition) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource is not available through this API')
  return definition
}

function validateBody(body: Record<string, unknown>, fields: readonly string[], allowedExtra: readonly string[] = []) { try { return validateWritableFields(body, [...fields, ...allowedExtra]) } catch (error) { if (error instanceof ValidationError) throw new ApiError(422, 'VALIDATION_ERROR', error.message, error.fields); throw error } }
function pickBody(body: Record<string, unknown>, fields: readonly string[], allowedExtra: readonly string[] = []) { validateBody(body, fields, allowedExtra); const result: Record<string, unknown> = {}; for (const field of fields) if (Object.prototype.hasOwnProperty.call(body, field)) result[field] = body[field]; return result }
function permissionResource(resource: string) {
  if (resource === 'report_templates' || resource === 'report-templates') return 'templates'
  return resource.replaceAll('-', '_')
}
const sortableFields: Record<string, readonly string[]> = {
  teachings: ['name', 'created_at', 'updated_at'],
  classrooms: ['name', 'created_at', 'updated_at'],
  class_sessions: ['name', 'start_date', 'created_at', 'updated_at'],
  'class-sessions': ['name', 'start_date', 'created_at', 'updated_at'],
  students: ['name', 'created_at', 'updated_at'],
  courses: ['subject', 'stage', 'display_name', 'created_at', 'updated_at'],
  lessons: ['title', 'sequence', 'created_at', 'updated_at'],
  enrollments: ['status', 'start_date', 'created_at', 'updated_at'],
  occurrences: ['occurrence_date', 'status', 'created_at', 'updated_at'],
  reports: ['updated_at', 'version'],
  report_templates: ['name', 'created_at', 'updated_at'],
  'report-templates': ['name', 'created_at', 'updated_at'],
  holidays: ['name', 'start_date', 'end_date', 'created_at', 'updated_at'],
}
function collectionSort(resource: string, raw: string | null) {
  const [field = 'created_at', direction = 'desc'] = (raw ?? '').split(':')
  const fields = sortableFields[resource] ?? []
  if (!fields.includes(field)) throw new ApiError(400, 'INVALID_SORT', 'Unsupported sort field')
  if (direction !== 'asc' && direction !== 'desc') throw new ApiError(400, 'INVALID_SORT', 'Sort direction must be asc or desc')
  return { field, ascending: direction === 'asc' }
}

async function mutationResponse(ctx: Awaited<ReturnType<typeof authenticate>>, req: Request, status: number, payload: unknown, id: string, headers: HeadersInit) {
  await completeIdempotency(ctx, req, status, payload)
  return response(payload, status, id, headers)
}
serve(async (req) => {
  const id = requestId(req)
  const trace = traceId(req)
  const headers = { ...corsHeaders(req), 'X-Trace-Id': trace }
  const started = performance.now()
  let telemetryOutcome: 'success' | 'denied' | 'failure' = 'success'
  let telemetryUserId: string | undefined
  let authenticatedContext: Awaited<ReturnType<typeof authenticate>> | undefined
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api-v1/, '').replace(/^\/v1/, '') || '/'
  if (req.method === 'OPTIONS') return response(null, 204, id, headers)
  try {
    enforceRateLimit(req, path)
    if (path === '/health' && req.method === 'GET') return response({ data: { status: 'ok', version: '1.0.0' }, request_id: id }, 200, id, headers)
    if (path === '/openapi.json' && req.method === 'GET') return response(OPENAPI, 200, id, headers)

    const ctx = await authenticate(req, id, trace)
    authenticatedContext = ctx
    telemetryUserId = ctx.user.id
    const replay = await beginIdempotency(ctx, req, path)
    if (replay) return replay
    if (path === '/me' && req.method === 'GET') return response({ data: { id: ctx.user.id, email: ctx.user.email, metadata: ctx.user.user_metadata }, request_id: id }, 200, id, headers)

    if (path === '/permissions' && req.method === 'GET') {
      await requirePermission(ctx, 'system.permissions.read')
      const { limit, offset } = parsePagination(url.searchParams)
      const { data, error } = await ctx.db.from('permissions').select('key,name,description,domain,resource,action,conditions').order('domain').order('resource').order('action').range(offset, offset + limit - 1)
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load permissions')
      return response({ data: data ?? [], meta: { limit, offset }, request_id: id }, 200, id, headers)
    }

    if (path === '/roles' && req.method === 'GET') {
      await requirePermission(ctx, 'system.roles.manage')
      const { limit, offset } = parsePagination(url.searchParams)
      const { data, error } = await ctx.db.from('roles').select('id,code,name,description,is_system,sort_order,created_at,updated_at').order('sort_order').order('name').range(offset, offset + limit - 1)
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load roles')
      return response({ data: data ?? [], meta: { limit, offset }, request_id: id }, 200, id, headers)
    }

    const roleItemMatch = path.match(/^\/roles\/([0-9a-fA-F-]{36})$/)
    if (roleItemMatch) {
      const roleId = roleItemMatch[1]
      await requirePermission(ctx, 'system.roles.manage')
      if (req.method === 'GET') {
        const { data, error } = await ctx.db.from('roles').select('id,code,name,description,is_system,sort_order,created_at,updated_at').eq('id', roleId).maybeSingle()
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load role')
        if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found')
        return response({ data, meta: null, request_id: id }, 200, id, headers)
      }
      if (req.method === 'PATCH') {
        const body = await parseJson(req)
        validateBody(body, ['code', 'name', 'description'])
        const payload = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
        const { data, error } = await ctx.db.from('roles').update(payload).eq('id', roleId).eq('is_system', false).select('id,code,name,description,is_system,sort_order,created_at,updated_at').maybeSingle()
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'ROLE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Role already exists' : 'Unable to update role')
        if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found or system role cannot be changed')
        await audit(ctx, { action: 'update', domain: 'system', resource: 'roles', resourceId: roleId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data, meta: null, request_id: id }, id, headers)
      }
      if (req.method === 'DELETE') {
        const { data, error } = await ctx.db.from('roles').delete().eq('id', roleId).eq('is_system', false).select('id').maybeSingle()
        if (error) throw new ApiError(409, 'ROLE_IN_USE', 'Role could not be deleted')
        if (!data) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role not found or system role cannot be deleted')
        await audit(ctx, { action: 'delete', domain: 'system', resource: 'roles', resourceId: roleId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data: null, meta: null, request_id: id }, id, headers)
      }
    }

    if (path === '/roles' && req.method === 'POST') {
      await requirePermission(ctx, 'system.roles.manage')
      const body = await parseJson(req) as Record<string, unknown>
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name || name.length > 120) throw new ApiError(422, 'VALIDATION_ERROR', 'name is required and must be at most 120 characters', { name: ['required'] })
      const { data, error } = await ctx.db.from('roles').insert({ code: typeof body.code === 'string' ? body.code.trim() || null : null, name, description: typeof body.description === 'string' ? body.description.trim() || null : null, is_system: false }).select('id,code,name,description,is_system,sort_order,created_at,updated_at').single()
      if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'ROLE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Role already exists' : 'Unable to create role')
      await audit(ctx, { action: 'create', domain: 'system', resource: 'roles', resourceId: data.id, outcome: 'success' })
      return mutationResponse(ctx, req, 201, { data, request_id: id }, id, headers)
    }

    if (path === '/audit-events' && req.method === 'GET') {
      await requirePermission(ctx, 'system.audit.list')
      const { limit, offset } = parsePagination(url.searchParams)
      const { data, error } = await ctx.db.from('audit_events').select('id,actor_user_id,action,domain,resource,resource_id,scope_id,request_id,outcome,metadata,created_at').order('created_at', { ascending: false }).range(offset, offset + limit - 1)
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load audit events')
      return response({ data: data ?? [], meta: { limit, offset }, request_id: id }, 200, id, headers)
    }

    const teachingMembersMatch = path.match(/^\/teachings\/([0-9a-fA-F-]{36})\/members$/)
    if (teachingMembersMatch) {
      const teachingId = teachingMembersMatch[1]
      if (req.method === 'GET') {
        await requirePermission(ctx, 'teaching.members.list')
        const { data, error } = await ctx.db.from('teaching_members').select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').eq('teaching_id', teachingId).order('created_at')
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load teaching members')
        return response({ data: data ?? [], request_id: id }, 200, id, headers)
      }
      if (req.method === 'POST') {
        await requirePermission(ctx, 'teaching.members.manage')
        const body = await parseJson(req) as Record<string, unknown>
        const userId = typeof body.user_id === 'string' ? body.user_id : ''
        if (!/^[0-9a-fA-F-]{36}$/.test(userId)) throw new ApiError(422, 'VALIDATION_ERROR', 'user_id must be a UUID', { user_id: ['invalid'] })
        const payload = { teaching_id: teachingId, user_id: userId, ...pickBody(body, ['role_id', 'status', 'effective_from', 'effective_to'], ['user_id']) }
        const { data, error } = await ctx.db.from('teaching_members').insert(payload).select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').single()
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'MEMBER_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Teaching member already exists' : 'Unable to add teaching member')
        await audit(ctx, { action: 'create', domain: 'teaching', resource: 'members', resourceId: teachingId, scopeId: teachingId, outcome: 'success' })
        return mutationResponse(ctx, req, 201, { data, request_id: id }, id, headers)
      }
    }    const collectionMatch = path.match(/^\/(teachings|classrooms|class_sessions|class-sessions|students|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)$/)
    const itemMatch = path.match(/^\/(teachings|classrooms|class_sessions|class-sessions|students|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)\/([0-9a-fA-F-]{36})$/)
    if (collectionMatch) {
      const resource = collectionMatch[1]
      const definition = resourceDefinition(resource)
      if (req.method === 'GET') {
        await requirePermission(ctx, 'teaching.' + (permissionResource(resource)) + '.list')
        const { limit, offset } = parsePagination(url.searchParams)
        const sort = collectionSort(resource, url.searchParams.get('sort'))
        let query = ctx.db.from(definition.table).select(definition.select).range(offset, offset + limit - 1).order(sort.field, { ascending: sort.ascending })
        const search = url.searchParams.get('search')?.trim()
        if (search && ['teachings', 'classrooms', 'students', 'report_templates', 'report-templates', 'holidays'].includes(resource)) query = query.ilike('name', '%' + search + '%')
        const { data, error } = await query
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
        return response({ data: data ?? [], meta: { limit, offset, sort: url.searchParams.get('sort') ?? 'created_at:desc' }, request_id: id }, 200, id, headers)
      }
      if (req.method === 'POST') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support creation')
        await requirePermission(ctx, 'teaching.' + (permissionResource(resource)) + '.create')
        const body = await parseJson(req) as Record<string, unknown>
        const payload = { ...pickBody(body, definition.fields), ...(resource === 'teachings' ? { owner_user_id: ctx.user.id } : {}) }
        if (Object.keys(payload).length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
        const { data, error } = await ctx.db.from(definition.table).insert(payload).select(definition.select).single()
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'RESOURCE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Resource already exists' : 'Unable to create resource')
        await audit(ctx, { action: 'create', domain: 'teaching', resource, resourceId: data.id, outcome: 'success' })
        return mutationResponse(ctx, req, 201, { data, request_id: id }, id, headers)
      }
    }
    if (itemMatch) {
      const resource = itemMatch[1]
      const resourceId = itemMatch[2]
      const definition = resourceDefinition(resource)
      if (req.method === 'GET') {
        await requirePermission(ctx, 'teaching.' + (permissionResource(resource)) + '.read')
        const { data, error } = await ctx.db.from(definition.table).select(definition.select).eq('id', resourceId).maybeSingle()
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        return mutationResponse(ctx, req, 200, { data, request_id: id }, id, headers)
      }
      if (req.method === 'PATCH') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support updates')
        await requirePermission(ctx, 'teaching.' + (permissionResource(resource)) + '.update')
        const body = await parseJson(req) as Record<string, unknown>
        const payload = { ...pickBody(body, definition.fields), ...(resource === 'teachings' ? { owner_user_id: ctx.user.id } : {}) }
        if (Object.keys(payload).length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
        const { data, error } = await ctx.db.from(definition.table).update(payload).eq('id', resourceId).select(definition.select).maybeSingle()
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'RESOURCE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Resource conflicts with an existing record' : 'Unable to update resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        await audit(ctx, { action: 'update', domain: 'teaching', resource, resourceId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data, request_id: id }, id, headers)
      }
      if (req.method === 'DELETE') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support deletion')
        await requirePermission(ctx, 'teaching.' + (permissionResource(resource)) + '.delete')
        const { data, error } = await ctx.db.from(definition.table).delete().eq('id', resourceId).select('id').maybeSingle()
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to delete resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        await audit(ctx, { action: 'delete', domain: 'teaching', resource, resourceId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data: null, request_id: id }, id, headers)
      }
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found')
  } catch (error) {
    if (error instanceof ValidationError) error = new ApiError(400, 'INVALID_QUERY', error.message, error.fields)
    telemetryOutcome = error instanceof ApiError && error.status === 403 ? 'denied' : 'failure'
    if (error instanceof ApiError && error.status === 403) {
      try {
        const deniedContext = authenticatedContext ?? await authenticate(req, id, trace, path, started)
        await audit(deniedContext, { action: req.method, domain: 'teaching', resource: path.split('/')[1] || 'unknown', outcome: 'denied', status: 403 })
      } catch { /* preserve original denial */ }
    } else if (authenticatedContext) {
      void audit(authenticatedContext, {
        action: req.method,
        domain: path.startsWith('/roles') || path === '/permissions' || path === '/audit-events' ? 'system' : 'teaching',
        resource: path.split('/')[1] || 'unknown',
        outcome: 'failure',
        status: error instanceof ApiError ? error.status : 500,
      })
    }
    return handleError(error, id, trace)
  } finally {
    void emitTelemetry({ request_id: id, trace_id: trace, user_id: telemetryUserId, route: path, method: req.method, latency_ms: Math.round(performance.now() - started), outcome: telemetryOutcome })
  }
})
