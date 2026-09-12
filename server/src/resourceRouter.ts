import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'
import { listQuerySchema, resources, type ResourceDefinition } from './resources.js'
import { authorizeCollection, authorizeResource, permissionForResource } from './authorization.js'
import { setAuditContext } from './context.js'

const mutationMethods = ['POST', 'PATCH', 'DELETE']
const bodySchema = z.record(z.string(), z.unknown())

export async function idempotency(req: Request, status: number, body: unknown) {
  const key = req.header('idempotency-key')?.trim()
  if (!mutationMethods.includes(req.method)) return false
  if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for mutations')
  if (!req.user || !req.adminDb) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is invalid')
  const { data, error } = await req.adminDb.rpc('reserve_api_idempotency', { p_user_id: req.user.id, p_key: key, p_method: req.method, p_route: req.originalUrl.split('?')[0] })
  if (error) throw mapDatabaseError(error)
  const row = Array.isArray(data) ? data[0] : data
  if (row?.is_replay) {
    const replay = row.response_body && typeof row.response_body === 'object'
      ? { ...(row.response_body as Record<string, unknown>), ...(isErrorEnvelope(row.response_body) ? { error: { ...(row.response_body as { error: Record<string, unknown> }).error, request_id: req.requestId, trace_id: req.traceId } } : {}), request_id: req.requestId, trace_id: req.traceId }
      : { data: row.response_body ?? null, meta: {}, request_id: req.requestId, trace_id: req.traceId }
    return { status: row.response_status ?? 200, body: replay } as const
  }
  return false
}

function isErrorEnvelope(value: unknown): value is { error: Record<string, unknown> } {
  return Boolean(value && typeof value === 'object' && 'error' in value && value.error && typeof value.error === 'object')
}

export async function complete(req: Request, status: number, body: unknown) {
  const key = req.header('idempotency-key')?.trim()
  if (key && req.user && req.adminDb && mutationMethods.includes(req.method)) await req.adminDb.rpc('complete_api_idempotency', { p_user_id: req.user.id, p_key: key, p_status: status, p_body: body })
}

function pickBody(def: Pick<ResourceDefinition, 'writable' | 'compatibilityFields'>, body: Record<string, unknown>) {
  const compatibilityFields = def.compatibilityFields ?? []
  const unknown = Object.keys(body).filter((key) => !def.writable.includes(key) && !compatibilityFields.includes(key))
  if (unknown.length) throw new ApiError(422, 'UNKNOWN_FIELD', 'The request contains a non-writable field', Object.fromEntries(unknown.map((key) => [key, ['Field is not writable']])) )
  if (compatibilityFields.includes('is_system') && body.is_system !== undefined && body.is_system !== false) {
    throw new ApiError(403, 'SYSTEM_ROLE_FORBIDDEN', 'System roles cannot be created or modified through this API', { is_system: ['Only custom roles are supported'] })
  }
  return Object.fromEntries(Object.entries(body).filter(([key]) => def.writable.includes(key)))
}

function validateBody(def: ResourceDefinition, body: Record<string, unknown>, action: 'create' | 'update') {
  const schema = action === 'create' ? def.createSchema : def.updateSchema
  if (!schema) return body
  return schema.parse(body)
}

function queryValue(req: Request, key: string) { const value = req.query[key]; return typeof value === 'string' ? value : undefined }

function parseFilters(raw: string, def: ResourceDefinition) {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid') }
  if (!Array.isArray(parsed)) throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid')
  return parsed.map((item) => {
    if (!item || typeof item !== 'object') throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid')
    const filter = item as { field?: unknown; operator?: unknown; value?: unknown }
    const field = typeof filter.field === 'string' ? filter.field : ''
    const operator = typeof filter.operator === 'string' ? filter.operator : ''
    if (!field || !def.fields.includes(field) || !['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt'].includes(operator)) throw new ApiError(400, 'INVALID_FILTER', 'The filter is not supported')
    if (operator === 'in' && !Array.isArray(filter.value)) throw new ApiError(400, 'INVALID_FILTER', 'The filter value is invalid')
    return { field, operator, value: filter.value }
  })
}

async function list(req: Request, res: Response, def: ResourceDefinition) {
  setAuditContext(req, { resource: def.route, action: 'list' })
  const parsedQuery = listQuerySchema.safeParse(req.query)
  if (!parsedQuery.success) {
    const fields = parsedQuery.error.issues.reduce<Record<string, string[]>>((result, issue) => {
      const key = issue.path.join('.') || 'query'
      ;(result[key] ??= []).push(issue.message)
      return result
    }, {})
    throw new ApiError(400, 'INVALID_QUERY', 'The query is invalid', fields)
  }
  const query = parsedQuery.data
  const sortName = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
  if (!def.sortable.includes(sortName)) throw new ApiError(400, 'INVALID_SORT', 'The sort field is not supported')
  const descending = query.sort.startsWith('-')
  const listFields = def.listFields ?? def.fields
  let builder = req.db!.from(def.table).select(listFields.join(', '), { count: 'exact' })
  if (def.table === 'user_preferences' || def.table === 'user_entity_visibility_preferences' || def.table === 'copy_templates') builder = builder.eq('user_id', req.user!.id)
  if (query.search && def.searchable.length) {
    const clauses = def.searchable.map((field) => `${field}.ilike.%${query.search!.replace(/[%_,]/g, '')}%`).join(',')
    builder = builder.or(clauses)
  }
  const queryFields = ['teaching_id', 'entity_type', 'entity_id', 'lesson_id', 'course_id', 'classroom_id', 'student_id', 'teacher_id', 'user_id', 'class_session_id', 'enrollment_id', 'class_occurrence_id', 'occurrence_report_id', 'instructor_id', 'template_type', 'scope_type', 'scope_entity_id']
  for (const field of queryFields) {
    if (queryValue(req, field) && !def.fields.includes(field)) throw new ApiError(400, 'INVALID_FILTER', `The ${field} filter is not supported for this resource`)
    const value = queryValue(req, field)
    if (value) builder = builder.eq(field, value)
  }
  const status = queryValue(req, 'status')
  if (status) {
    if (!def.fields.includes('status')) throw new ApiError(400, 'INVALID_FILTER', 'The status filter is not supported for this resource')
    builder = builder.eq('status', status)
  }
  const filters = query.filters ? parseFilters(query.filters, def) : []
  for (const filter of filters) {
    if (filter.operator === 'in') builder = builder.in(filter.field, filter.value as unknown[])
    else if (filter.operator === 'neq') builder = builder.neq(filter.field, filter.value)
    else if (filter.operator === 'gte') builder = builder.gte(filter.field, filter.value)
    else if (filter.operator === 'lte') builder = builder.lte(filter.field, filter.value)
    else if (filter.operator === 'gt') builder = builder.gt(filter.field, filter.value)
    else if (filter.operator === 'lt') builder = builder.lt(filter.field, filter.value)
    else builder = builder.eq(filter.field, filter.value)
  }
  const entityIds = queryValue(req, 'entity_ids')
  if (entityIds) {
    if (!def.fields.includes('entity_id')) throw new ApiError(400, 'INVALID_FILTER', 'The entity_ids filter is not supported for this resource')
    const values = entityIds.split(',').filter(Boolean)
    if (!values.length || values.some((value) => !z.string().uuid().safeParse(value).success)) throw new ApiError(400, 'INVALID_FILTER', 'The entity_ids filter is invalid')
    builder = builder.in('entity_id', values)
  }
  const { data, error, count } = await builder.order(sortName, { ascending: !descending }).range(query.offset, query.offset + query.limit - 1)
  if (error) throw mapDatabaseError(error)
  return sendData(req, res, data ?? [], { limit: query.limit, offset: query.offset, total: count ?? 0, sort: query.sort })
}

async function item(req: Request, res: Response, def: ResourceDefinition) {
  const requestedId = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!requestedId) throw new ApiError(400, 'INVALID_ID', 'Resource id is required')
  const id = def.table === 'user_preferences' && requestedId === 'me' ? req.user?.id : requestedId
  if (!id) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Resource id is invalid')
  const mutationBody = req.method === 'PATCH'
    ? validateBody(def, pickBody(def, bodySchema.parse(req.body)), 'update')
    : null
  if (req.method === 'PATCH' && !Object.keys(mutationBody ?? {}).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one writable field is required')
  setAuditContext(req, { resource: def.route, resourceId: id, action: req.method.toLowerCase() })
  const itemFields = def.itemFields ?? def.fields
  const existing = await req.db!.from(def.table).select(itemFields.join(', ')).eq(def.idColumn, id).maybeSingle()
  if (existing.error) throw mapDatabaseError(existing.error as unknown as { code?: string; message?: string })
  if (!existing.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  if (req.method === 'GET') {
    await authorizeResource(req, def, permissionForResource(def, 'read'), id, existing.data as unknown as Record<string, unknown>)
    return sendData(req, res, existing.data)
  }
  const action = req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete'
  await authorizeResource(req, def, permissionForResource(def, action), id, existing.data as unknown as Record<string, unknown>)
  const isMutation = mutationMethods.includes(req.method)
  if (isMutation) {
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
  }
  let response: Response
  if (req.method === 'DELETE') {
    const result = await req.db!.from(def.table).delete().eq(def.idColumn, id).select(itemFields.join(', ')).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }
  const result = await req.db!.from(def.table).update(mutationBody ?? {}).eq(def.idColumn, id).select(itemFields.join(', ')).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); response = res.json(envelope); return response
}

export async function collection(req: Request, res: Response, def: ResourceDefinition) {
  setAuditContext(req, { resource: def.route, action: req.method.toLowerCase() })
  if (req.method === 'GET') {
    await authorizeCollection(req, def, permissionForResource(def, 'list'), req.query as Record<string, unknown>)
    return list(req, res, def)
  }
  const action = req.method === 'POST' ? 'create' : 'update'
  const parsedBody = bodySchema.parse(req.body)
  const body = validateBody(def, pickBody(def, parsedBody), action)
  if (!Object.keys(body).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one writable field is required')
  // Authorization must consume the same filtered/validated representation
  // that will be persisted.  Passing parsedBody here allowed compatibility or
  // future non-persisted fields to influence scope resolution.
  await authorizeCollection(req, def, permissionForResource(def, action), {}, body)
  const replay = await idempotency(req, req.method === 'POST' ? 201 : 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const userOwnedTables = new Set(['user_preferences', 'user_entity_visibility_preferences', 'copy_templates'])
  const insertBody = userOwnedTables.has(def.table) ? { ...body, user_id: req.user!.id } : body
  const itemFields = def.itemFields ?? def.fields
  const result = req.method === 'POST' ? await req.db!.from(def.table).insert(insertBody).select(itemFields.join(', ')).single() : await req.db!.from(def.table).update(body).select(itemFields.join(', ')).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  const createdId = result.data && typeof result.data === 'object' && typeof (result.data as Record<string, unknown>).id === 'string' ? (result.data as Record<string, unknown>).id as string : null
  if (createdId) setAuditContext(req, { resourceId: createdId })
  const status = req.method === 'POST' ? 201 : 200
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, status, envelope)
  return res.status(status).json(envelope)
}

async function teachingAllowed(req: Request, permission: string, teachingId: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const { data, error } = await req.db.rpc('has_teaching_permission', { p_user_id: req.user.id, p_permission_key: permission, p_teaching_id: teachingId, p_classroom_id: null, p_class_session_id: null })
  if (error || data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
}

async function members(req: Request, res: Response) {
  const teachingId = typeof req.params.teachingId === 'string' ? req.params.teachingId : undefined
  const userId = typeof req.params.userId === 'string' ? req.params.userId : undefined
  if (!teachingId) throw new ApiError(400, 'INVALID_TEACHING_ID', 'Teaching id is required')
  if (!z.string().uuid().safeParse(teachingId).success) throw new ApiError(400, 'INVALID_TEACHING_ID', 'Teaching id is invalid')
  if (userId && !z.string().uuid().safeParse(userId).success) throw new ApiError(400, 'INVALID_USER_ID', 'Member user id is invalid')
  const action = req.method === 'GET' ? 'list' : req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete'
  setAuditContext(req, { domain: 'teaching', resource: 'members', action, resourceId: userId ?? null, teachingId: teachingId ?? null, scopeId: teachingId ?? null, permission: `teaching.members.${action}` })
  await teachingAllowed(req, `teaching.members.${action}`, teachingId)
  if (req.method === 'GET') {
    const result = await req.db!.from('teaching_members').select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').eq('teaching_id', teachingId).order('created_at', { ascending: true })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { limit: result.data?.length ?? 0, offset: 0, total: result.data?.length ?? 0, sort: 'created_at' })
  }
  if (req.method === 'POST') {
    const body = z.object({ user_id: z.string().uuid(), role_id: z.string().uuid().nullable().optional(), status: z.string().min(1).max(32).optional(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict().parse(req.body)
    const allowedFields = ['user_id', 'role_id', 'status', 'effective_from', 'effective_to']
    const unknown = Object.keys(body).filter((key) => !allowedFields.includes(key))
    if (unknown.length) throw new ApiError(422, 'UNKNOWN_FIELD', 'The request contains a non-writable field')
    const replay = await idempotency(req, 201, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.from('teaching_members').insert({ ...body, teaching_id: teachingId }).select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').single()
    if (result.error) throw mapDatabaseError(result.error)
    const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
  }
  if (!userId) throw new ApiError(400, 'INVALID_USER_ID', 'Member user id is required')
  const updateBody = req.method === 'PATCH'
    ? z.object({ role_id: z.string().uuid().optional(), status: z.string().min(1).max(32).optional(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict().parse(req.body)
    : null
  if (req.method === 'PATCH' && !Object.keys(updateBody ?? {}).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one member field is required')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = req.method === 'DELETE'
    ? await req.db!.from('teaching_members').delete().eq('teaching_id', teachingId).eq('user_id', userId).select('teaching_id,user_id,role_id,status,effective_from,effective_to').maybeSingle()
    : await req.db!.from('teaching_members').update(updateBody ?? {}).eq('teaching_id', teachingId).eq('user_id', userId).select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Teaching member was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export function createResourceRouter() {
  const router = Router()
  router.get('/teachings/:teachingId/members', wrap((req, res) => members(req, res)))
  router.post('/teachings/:teachingId/members', wrap((req, res) => members(req, res)))
  router.patch('/teachings/:teachingId/members/:userId', wrap((req, res) => members(req, res)))
  router.delete('/teachings/:teachingId/members/:userId', wrap((req, res) => members(req, res)))
  for (const [route, def] of Object.entries(resources)) {
    const methods = new Set(def.genericMethods ?? ['GET', 'POST', 'PATCH', 'DELETE'])
    if (methods.has('GET')) router.get(`/${route}`, wrap((req, res) => collection(req, res, def)))
    if (methods.has('POST')) router.post(`/${route}`, wrap((req, res) => collection(req, res, def)))
    if (methods.has('GET')) router.get(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
    if (methods.has('PATCH')) router.patch(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
    if (methods.has('DELETE')) router.delete(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
  }
  return router
}

function wrap(handler: (req: Request, res: Response, next?: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res, next)).catch(next)
}


