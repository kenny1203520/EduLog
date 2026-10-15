import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './http/errors.js'
import { sendData } from './http/response.js'
import { listQuerySchema, resources, type ResourceDefinition } from './resources.js'
import { authorizeCollection, authorizeResource, permissionForResource } from './authorization.js'
import { setAuditContext } from './http/context.js'

const mutationMethods = ['POST', 'PATCH', 'DELETE']
const serviceOnlyViews = new Set(['users', 'teachers'])
const sensitivePatchFields: Record<string, readonly string[]> = {
  students: ['gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday'],
  teachers: ['email', 'phone', 'address', 'mailing_address', 'birthday', 'gov_id'],
}
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

type FilterOperator = 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike' | 'contains' | 'is'

function filterableFields(def: ResourceDefinition) {
  // Query exposure must be opt-in. Falling back to `fields` would turn a
  // missing registry entry into a filter/existence oracle for item-only
  // sensitive columns.
  return def.filterable ?? []
}

export function parseFilters(raw: string, def: ResourceDefinition) {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid') }
  if (!Array.isArray(parsed)) throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid')
  return parsed.map((item) => {
    if (!item || typeof item !== 'object') throw new ApiError(400, 'INVALID_FILTER', 'The filters query is invalid')
    const filter = item as { field?: unknown; operator?: unknown; value?: unknown }
    const field = typeof filter.field === 'string' ? filter.field : ''
    const operator = typeof filter.operator === 'string' ? filter.operator : ''
    if (!field || !filterableFields(def).includes(field) || !['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'ilike', 'contains', 'is'].includes(operator)) throw new ApiError(400, 'INVALID_FILTER', 'The filter is not supported')
    if (operator === 'in' && !Array.isArray(filter.value)) throw new ApiError(400, 'INVALID_FILTER', 'The filter value is invalid')
    if (operator === 'ilike' && typeof filter.value !== 'string') throw new ApiError(400, 'INVALID_FILTER', 'The filter value is invalid')
    if (operator === 'is' && !['null', 'true', 'false'].includes(String(filter.value))) throw new ApiError(400, 'INVALID_FILTER', 'The filter value is invalid')
    return { field, operator: operator as FilterOperator, value: filter.value }
  })
}

export function parseOr(raw: string, def: ResourceDefinition) {
  const clauses = raw.split(',').map((clause) => clause.trim()).filter(Boolean)
  if (!clauses.length) throw new ApiError(400, 'INVALID_FILTER', 'The or filter is invalid')
  return clauses.map((clause) => {
    const parts = clause.split('.')
    const field = parts.shift() ?? ''
    const operator = (parts.shift() ?? '') as FilterOperator
    const value = parts.join('.')
    if (!field || !filterableFields(def).includes(field) || !['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'ilike', 'is'].includes(operator) || /[(),\n\r]/.test(value)) {
      throw new ApiError(400, 'INVALID_FILTER', 'The or filter is not supported')
    }
    if (operator === 'is' && !['null', 'true', 'false'].includes(value)) throw new ApiError(400, 'INVALID_FILTER', 'The or filter value is invalid')
    return `${field}.${operator}.${value}`
  }).join(',')
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
  const queryDb = serviceOnlyViews.has(def.route) ? req.adminDb : req.db
  if (!queryDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The requested resource is unavailable')
  let builder = queryDb.from(def.table).select(listFields.join(', '), { count: 'exact' })
  if (def.table === 'user_preferences' || def.table === 'user_entity_visibility_preferences' || def.table === 'copy_templates') builder = builder.eq('user_id', req.user!.id)
  if (query.search && def.searchable.length) {
    const clauses = def.searchable.map((field) => `${field}.ilike.%${query.search!.replace(/[%_,()]/g, '')}%`).join(',')
    builder = builder.or(clauses)
  }
  if (query.or) builder = builder.or(parseOr(query.or, def))
  const queryFields = ['teaching_id', 'entity_type', 'entity_id', 'lesson_id', 'course_id', 'classroom_id', 'student_id', 'teacher_id', 'user_id', 'class_session_id', 'enrollment_id', 'class_occurrence_id', 'occurrence_report_id', 'instructor_id', 'template_type', 'scope_type', 'scope_entity_id']
  for (const field of queryFields) {
    if (queryValue(req, field) && !filterableFields(def).includes(field)) throw new ApiError(400, 'INVALID_FILTER', `The ${field} filter is not supported for this resource`)
    const value = queryValue(req, field)
    if (value) builder = builder.eq(field, value)
  }
  const status = queryValue(req, 'status')
  if (status) {
    if (!filterableFields(def).includes('status')) throw new ApiError(400, 'INVALID_FILTER', 'The status filter is not supported for this resource')
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
    else if (filter.operator === 'ilike') builder = builder.ilike(filter.field, filter.value as string)
    else if (filter.operator === 'contains') builder = builder.contains(filter.field, filter.value as never)
    else if (filter.operator === 'is') {
      const value = String(filter.value)
      builder = builder.is(filter.field, value === 'null' ? null : value === 'true' ? true : false)
    }
    else builder = builder.eq(filter.field, filter.value)
  }
  const entityIds = queryValue(req, 'entity_ids')
  if (entityIds) {
    if (!filterableFields(def).includes('entity_id')) throw new ApiError(400, 'INVALID_FILTER', 'The entity_ids filter is not supported for this resource')
    const values = entityIds.split(',').filter(Boolean)
    if (!values.length || values.some((value) => !z.string().uuid().safeParse(value).success)) throw new ApiError(400, 'INVALID_FILTER', 'The entity_ids filter is invalid')
    builder = builder.in('entity_id', values)
  }
  const relationSort = /^([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(sortName)
  const ordered = relationSort
    ? builder.order(relationSort[2], { ascending: !descending, foreignTable: relationSort[1] })
    : builder.order(sortName, { ascending: !descending })
  const { data, error, count } = await ordered.range(query.offset, query.offset + query.limit - 1)
  if (error) throw mapDatabaseError(error)
  let includeSensitive = false
  if (def.route === 'teachers') {
    try {
      await authorizeCollection(req, def, 'teaching.teachers.read_sensitive', req.query as Record<string, unknown>)
      includeSensitive = true
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 403) throw error
    }
  }
  const rows = def.route === 'teachers' ? await attachTeacherProfile(req, data ?? [], includeSensitive) : data ?? []
  return sendData(req, res, rows, { limit: query.limit, offset: query.offset, total: count ?? 0, sort: query.sort })
}

export async function attachTeacherProfile(req: Request, value: unknown, includeSensitive = false) {
  const rows = (Array.isArray(value) ? value : [value]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
  if (!req.adminDb) {
    const safeRows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'profile_id')))
    return Array.isArray(value) ? safeRows : safeRows[0]
  }
  const profileIds = [...new Set(rows.map((row) => row.profile_id).filter((id): id is string => typeof id === 'string'))]
  if (!profileIds.length) return value
  const projection = includeSensitive
    ? 'id,auth_user_id,full_name,contact_email,phone,address,mailing_address,birthday,government_id,bio,bio_document'
    : 'id,auth_user_id,full_name,bio,bio_document'
  const result = await req.adminDb.from('profiles').select(projection).in('id', profileIds)
  if (result.error) throw mapDatabaseError(result.error)
  const profileRows = (result.data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>
  const profiles = new Map(profileRows.map((profile) => [profile.id, profile]))
  const enriched = rows.map((row) => {
    const profile = profiles.get(row.profile_id as string)
    const safeRow = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'profile_id'))
    if (!profile) return safeRow
    return {
      ...safeRow,
      profile_id: profile.id,
      user_id: profile.auth_user_id,
      name: profile.full_name,
      ...(includeSensitive ? {
        email: profile.contact_email,
        phone: profile.phone,
        address: profile.address,
        mailing_address: profile.mailing_address,
        birthday: profile.birthday,
        gov_id: profile.government_id,
      } : {}),
      bio: profile.bio,
      bio_document: profile.bio_document,
    }
  })
  return Array.isArray(value) ? enriched : enriched[0]
}

async function authorizeServiceViewItemBeforeRead(req: Request, def: ResourceDefinition, id: string) {
  if (!serviceOnlyViews.has(def.route)) return
  if (!req.user || !req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const action = req.method === 'GET' ? 'read' : req.method === 'DELETE' ? 'delete' : 'update'
  const permission = permissionForResource(def, action)
  if (def.route === 'users') {
    // User account lookups use a service-role-only view, so enforce the
    // system permission before the privileged query can reveal row existence.
    await authorizeResource(req, def, permission, id)
    return
  }
  if (req.method === 'DELETE') {
    // Self-service access intentionally does not grant teacher deletion.
    await authorizeResource(req, def, permission, id)
    return
  }
  const { data, error } = await req.db.rpc('can_access_teacher', {
    p_teacher_id: id,
    p_permission_key: permission,
  })
  if (error) throw mapDatabaseError(error)
  if (data !== true) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
}

export async function item(req: Request, res: Response, def: ResourceDefinition) {
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
  await authorizeServiceViewItemBeforeRead(req, def, id)
  const itemFields = def.itemFields ?? def.fields
  const queryDb = serviceOnlyViews.has(def.route) ? req.adminDb : req.db
  if (!queryDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The requested resource is unavailable')
  const existing = await queryDb.from(def.table).select(itemFields.join(', ')).eq(def.idColumn, id).maybeSingle()
  if (existing.error) throw mapDatabaseError(existing.error as unknown as { code?: string; message?: string })
  if (!existing.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  if (req.method === 'GET') {
    await authorizeResource(req, def, permissionForResource(def, 'read'), id, existing.data as unknown as Record<string, unknown>)
    let includeSensitive = false
  if (def.route === 'teachers') {
      try {
        await authorizeResource(req, def, 'teaching.teachers.read_sensitive', id, existing.data as unknown as Record<string, unknown>)
        includeSensitive = true
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error
      }
    }
    return sendData(req, res, def.route === 'teachers' ? await attachTeacherProfile(req, existing.data, includeSensitive) : existing.data)
  }
  const action = req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete'
  await authorizeResource(req, def, permissionForResource(def, action), id, existing.data as unknown as Record<string, unknown>)
  if (req.method === 'PATCH' && mutationBody) {
    // Re-resolve authorization from the persisted row plus the validated
    // mutation.  A writable foreign key can otherwise move an item into a
    // different teaching/classroom/session scope after the old row passed.
    await authorizeResource(req, def, permissionForResource(def, 'update'), id, {
      ...(existing.data as unknown as Record<string, unknown>),
      ...mutationBody,
    })
  }
  const isMutation = mutationMethods.includes(req.method)
  if (isMutation) {
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
  }
  let response: Response
  if (req.method === 'DELETE') {
    const result = def.route === 'teachers'
      ? await req.adminDb!.from('teacher_records').delete().eq(def.idColumn, id).select('id,profile_id,created_at,updated_at').maybeSingle()
      : await req.db!.from(def.table).delete().eq(def.idColumn, id).select(itemFields.join(', ')).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }
  const patch = mutationBody ?? {}
  const sensitiveFields = new Set(sensitivePatchFields[def.table] ?? [])
  const sensitivePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => sensitiveFields.has(key)))
  const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !sensitiveFields.has(key)))
  if (Object.keys(sensitivePatch).length) {
    const sensitivePermission = def.route === 'students' ? 'teaching.students.update_sensitive' : 'teaching.teachers.update_sensitive'
    await authorizeResource(req, def, sensitivePermission, id, existing.data as unknown as Record<string, unknown>)
    const functionName = def.route === 'students' ? 'update_student_sensitive' : 'update_teacher_sensitive'
    const parameterName = def.route === 'students' ? 'p_student_id' : 'p_teacher_id'
    const sensitiveResult = await req.db!.rpc(functionName, { [parameterName]: id, p_patch: sensitivePatch })
    if (sensitiveResult.error) throw mapDatabaseError(sensitiveResult.error)
  }
  if (Object.keys(safePatch).length) {
    const safeResult = def.route === 'teachers'
      ? await req.db!.rpc('update_teacher_profile', { p_teacher_id: id, p_patch: safePatch })
      : await req.db!.from(def.table).update(safePatch).eq(def.idColumn, id).select(itemFields.join(', ')).maybeSingle()
    if (safeResult.error) throw mapDatabaseError(safeResult.error)
    if (!safeResult.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  }
  const updated = await queryDb.from(def.table).select(itemFields.join(', ')).eq(def.idColumn, id).maybeSingle()
  if (updated.error) throw mapDatabaseError(updated.error)
  if (!updated.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  const envelope = { data: def.route === 'teachers' ? await attachTeacherProfile(req, updated.data, Object.keys(sensitivePatch).length > 0) : updated.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); response = res.json(envelope); return response
}

export async function collection(req: Request, res: Response, def: ResourceDefinition) {
  setAuditContext(req, { resource: def.route, action: req.method.toLowerCase() })
  if (req.method === 'GET') {
    await authorizeCollection(req, def, permissionForResource(def, 'list'), req.query as Record<string, unknown>)
    return list(req, res, def)
  }
  // Collection PATCH is intentionally not supported. A collection update
  // without an explicit item id is a mass-update footgun and could mutate
  // rows outside the caller's intended scope. Use PATCH /:id instead.
  if (req.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use an item endpoint for updates')
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
  if (def.route === 'teachers') {
    const privateKeys = ['email', 'phone', 'address', 'mailing_address', 'birthday', 'gov_id']
    if (privateKeys.some((key) => body[key] !== undefined && body[key] !== null && body[key] !== '')) {
      await authorizeCollection(req, def, 'teaching.teachers.update_sensitive', {}, body)
    }
    if (!req.adminDb) throw new ApiError(503, 'PROFILE_SERVICE_UNAVAILABLE', 'The teacher profile service is unavailable')
    const { user_id, ...profilePatch } = parsedBody
    const created = await req.adminDb.rpc('create_teacher_with_profile', {
      p_account_user_id: typeof user_id === 'string' ? user_id : null,
      p_patch: profilePatch,
    })
    if (created.error) throw mapDatabaseError(created.error)
    const row = created.data as Record<string, unknown> | null
    if (!row || typeof row.id !== 'string') throw new ApiError(500, 'DATABASE_ERROR', 'The teacher could not be created')
    setAuditContext(req, { resourceId: row.id })
    const data = await attachTeacherProfile(req, row, privateKeys.some((key) => body[key] !== undefined))
    const envelope = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
    await complete(req, 201, envelope)
    return res.status(201).json(envelope)
  }
  const userOwnedTables = new Set(['user_preferences', 'user_entity_visibility_preferences', 'copy_templates'])
   let insertBody = userOwnedTables.has(def.table) ? { ...body, user_id: req.user!.id } : body
   // Legacy teaching_id markers on teaching records are normalized by the
   // database compatibility trigger; the API no longer reads teaching spaces.
  const itemFields = def.itemFields ?? def.fields
  const result = req.method === 'POST' ? await req.db!.from(def.table).insert(insertBody).select(itemFields.join(', ')).single() : await req.db!.from(def.table).update(body).select(itemFields.join(', ')).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  const createdId = result.data && typeof result.data === 'object' && typeof (result.data as Record<string, unknown>).id === 'string' ? (result.data as Record<string, unknown>).id as string : null
  if (createdId) setAuditContext(req, { resourceId: createdId })
  const status = req.method === 'POST' ? 201 : 200
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, status, envelope)
  return res.status(status).json(envelope)
}

export function createResourceRouter() {
  const router = Router()
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


