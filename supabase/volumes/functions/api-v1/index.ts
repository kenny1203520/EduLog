import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { ApiError, audit, authenticate, beginIdempotency, completeIdempotency, corsHeaders, enforceRateLimit, handleError, parseJson, requirePermission, requestId, response, traceId } from '../_shared/api.ts'

const OPENAPI = {
  openapi: '3.0.3',
  info: { title: 'EduLog API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/health': { get: { security: [], responses: { '200': { description: 'Healthy' } } } },
    '/me': { get: { responses: { '200': { description: 'Current user' }, '401': { description: 'Unauthorized' } } } },
    '/permissions': { get: { responses: { '200': { description: 'Available permissions' } } } },
    '/roles': { get: { responses: { '200': { description: 'Roles' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } }, post: { responses: { '201': { description: 'Created' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' }, '429': { description: 'Rate limited' } } } },
    '/audit-events': { get: { responses: { '200': { description: 'Audit events' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } } },
    '/classrooms': { get: { responses: { '200': { description: 'Classrooms' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' }, '429': { description: 'Rate limited' } } }, post: { responses: { '201': { description: 'Created' }, '403': { description: 'Forbidden' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' } } } },
    '/classrooms/{id}': { get: { responses: { '200': { description: 'Classroom' }, '404': { description: 'Not found' } } }, patch: { responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } } }, delete: { responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } } } },
    '/class_sessions': { get: { responses: { '200': { description: 'Class sessions' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/students': { get: { responses: { '200': { description: 'Students' } } }, post: { responses: { '201': { description: 'Created' } } } },
    '/reports': { get: { responses: { '200': { description: 'Reports' } } } },
    '/teachings': { get: { responses: { '200': { description: 'Teaching collection' }, '401': { description: 'Unauthorized' }, '403': { description: 'Forbidden' } } }, post: { responses: { '201': { description: 'Created' }, '409': { description: 'Conflict' }, '422': { description: 'Validation error' } } } },
    '/teachings/{id}': { get: { responses: { '200': { description: 'Teaching' }, '404': { description: 'Not found' } } }, patch: { responses: { '200': { description: 'Updated' } } }, delete: { responses: { '200': { description: 'Deleted' } } } },
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

const resourceDefinitions = {
  classrooms: { table: 'classrooms', select: 'id,name,color,address,phone,external_link,user_id,created_at,updated_at', fields: ['name', 'color', 'address', 'phone', 'external_link'] },
  class_sessions: { table: 'class_sessions', select: 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,user_id,created_at,updated_at', fields: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date'] },
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

function pickBody(body: Record<string, unknown>, fields: readonly string[]) {
  const result: Record<string, unknown> = {}
  for (const field of fields) if (Object.prototype.hasOwnProperty.call(body, field)) result[field] = body[field]
  return result
}

async function mutationResponse(ctx: Awaited<ReturnType<typeof authenticate>>, req: Request, status: number, payload: unknown, id: string, headers: HeadersInit) {
  await completeIdempotency(ctx, req, status, payload)
  return response(payload, status, id, headers)
}
serve(async (req) => {
  const id = requestId(req)
  const trace = traceId(req)
  const headers = corsHeaders(req)
  const started = performance.now()
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api-v1/, '').replace(/^\/v1/, '') || '/'
  if (req.method === 'OPTIONS') return response(null, 204, id, headers)
  try {
    enforceRateLimit(req, path)
    if (path === '/health' && req.method === 'GET') return response({ data: { status: 'ok', version: '1.0.0' }, request_id: id }, 200, id, headers)
    if (path === '/openapi.json' && req.method === 'GET') return response(OPENAPI, 200, id, headers)

    const ctx = await authenticate(req, id, trace)
    const replay = await beginIdempotency(ctx, req, path)
    if (replay) return replay
    if (path === '/me' && req.method === 'GET') return response({ data: { id: ctx.user.id, email: ctx.user.email, metadata: ctx.user.user_metadata }, request_id: id }, 200, id, headers)

    if (path === '/permissions' && req.method === 'GET') {
      await requirePermission(ctx, 'system.permissions.read')
      const { data, error } = await ctx.db.from('permissions').select('key,name,description,domain,resource,action,conditions').order('domain').order('resource').order('action')
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load permissions')
      return response({ data: data ?? [], request_id: id }, 200, id, headers)
    }

    if (path === '/roles' && req.method === 'GET') {
      await requirePermission(ctx, 'system.roles.manage')
      const { data, error } = await ctx.db.from('roles').select('id,code,name,description,is_system,sort_order,created_at,updated_at').order('sort_order').order('name')
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load roles')
      return response({ data: data ?? [], request_id: id }, 200, id, headers)
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
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100)
      const { data, error } = await ctx.db.from('audit_events').select('id,actor_user_id,action,domain,resource,resource_id,scope_id,request_id,outcome,metadata,created_at').order('created_at', { ascending: false }).limit(limit)
      if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load audit events')
      return response({ data: data ?? [], request_id: id }, 200, id, headers)
    }

    const collectionMatch = path.match(/^\/(teachings|classrooms|class_sessions|students|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)$/)
    const itemMatch = path.match(/^\/(teachings|classrooms|class_sessions|students|courses|lessons|enrollments|occurrences|report_templates|report-templates|holidays|reports)\/([0-9a-fA-F-]{36})$/)
    if (collectionMatch) {
      const resource = collectionMatch[1]
      const definition = resourceDefinition(resource)
      if (req.method === 'GET') {
        await requirePermission(ctx, 'teaching.' + (resource === 'report_templates' ? 'templates' : resource) + '.list')
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100)
        const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)
        let query = ctx.db.from(definition.table).select(definition.select).range(offset, offset + limit - 1)
        const search = url.searchParams.get('search')?.trim()
        if (search && ['teachings', 'classrooms', 'students', 'report_templates', 'report-templates', 'holidays'].includes(resource)) query = query.ilike('name', '%' + search + '%')
        const { data, error } = await query
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
        return response({ data: data ?? [], meta: { limit, offset }, request_id: id }, 200, id, headers)
      }
      if (req.method === 'POST') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support creation')
        await requirePermission(ctx, 'teaching.' + (resource === 'report_templates' ? 'templates' : resource) + '.create')
        const body = await parseJson(req) as Record<string, unknown>
        const payload = pickBody(body, definition.fields)
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
        await requirePermission(ctx, 'teaching.' + (resource === 'report_templates' ? 'templates' : resource) + '.read')
        const { data, error } = await ctx.db.from(definition.table).select(definition.select).eq('id', resourceId).maybeSingle()
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        return mutationResponse(ctx, req, 200, { data, request_id: id }, id, headers)
      }
      if (req.method === 'PATCH') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support updates')
        await requirePermission(ctx, 'teaching.' + (resource === 'report_templates' ? 'templates' : resource) + '.update')
        const body = await parseJson(req) as Record<string, unknown>
        const payload = pickBody(body, definition.fields)
        if (Object.keys(payload).length === 0) throw new ApiError(422, 'VALIDATION_ERROR', 'At least one writable field is required')
        const { data, error } = await ctx.db.from(definition.table).update(payload).eq('id', resourceId).select(definition.select).maybeSingle()
        if (error) throw new ApiError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'RESOURCE_EXISTS' : 'DATABASE_ERROR', error.code === '23505' ? 'Resource conflicts with an existing record' : 'Unable to update resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        await audit(ctx, { action: 'update', domain: 'teaching', resource, resourceId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data, request_id: id }, id, headers)
      }
      if (req.method === 'DELETE') {
        if (definition.fields.length === 0) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Resource does not support deletion')
        await requirePermission(ctx, 'teaching.' + (resource === 'report_templates' ? 'templates' : resource) + '.delete')
        const { data, error } = await ctx.db.from(definition.table).delete().eq('id', resourceId).select('id').maybeSingle()
        if (error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to delete resource')
        if (!data) throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Resource not found')
        await audit(ctx, { action: 'delete', domain: 'teaching', resource, resourceId, outcome: 'success' })
        return mutationResponse(ctx, req, 200, { data: null, request_id: id }, id, headers)
      }
    }
    throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found')
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      try { const ctx = await authenticate(req, id, trace); await audit(ctx, { action: req.method, domain: 'teaching', resource: path.split('/')[1] || 'unknown', outcome: 'denied' }) } catch { /* preserve original denial */ }
    }
    return handleError(error, id, trace)
  } finally {
    console.log(JSON.stringify({ type: 'api_request', request_id: id, trace_id: trace, route: path, method: req.method, duration_ms: Math.round(performance.now() - started) }))
  }
})
