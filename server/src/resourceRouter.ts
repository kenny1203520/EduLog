import { Router, type Request, type Response, type NextFunction } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendCreated, sendData } from './response.js'
import { listQuerySchema, resources, type ResourceDefinition } from './resources.js'

const mutationMethods = ['POST', 'PATCH', 'DELETE']
const bodySchema = z.record(z.string(), z.unknown())

function permissionFor(def: ResourceDefinition, action: string) {
  return `${def.permission.slice(0, def.permission.lastIndexOf('.') + 1)}${action}`
}

async function allowed(req: Request, permission: string, resourceId: string | null) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const { data, error } = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: permission, p_classroom_id: resourceId, p_class_session_id: null })
  if (error || data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
}

async function idempotency(req: Request, status: number, body: unknown) {
  const key = req.header('idempotency-key')?.trim()
  if (!mutationMethods.includes(req.method)) return false
  if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required for mutations')
  if (!req.user || !req.adminDb) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key is invalid')
  const { data, error } = await req.adminDb.rpc('reserve_api_idempotency', { p_user_id: req.user.id, p_key: key, p_method: req.method, p_route: req.originalUrl.split('?')[0] })
  if (error) throw mapDatabaseError(error)
  const row = Array.isArray(data) ? data[0] : data
  if (row?.is_replay) { const replay = row.response_body ?? {}; return { status: row.response_status ?? 200, body: replay } as const }
  return false
}

async function complete(req: Request, status: number, body: unknown) {
  const key = req.header('idempotency-key')?.trim()
  if (key && req.user && req.adminDb && mutationMethods.includes(req.method)) await req.adminDb.rpc('complete_api_idempotency', { p_user_id: req.user.id, p_key: key, p_status: status, p_body: body })
}

function pickBody(def: Pick<ResourceDefinition, 'writable'>, body: Record<string, unknown>) {
  const unknown = Object.keys(body).filter((key) => !def.writable.includes(key))
  if (unknown.length) throw new ApiError(422, 'UNKNOWN_FIELD', 'The request contains a non-writable field', Object.fromEntries(unknown.map((key) => [key, ['Field is not writable']])) )
  return Object.fromEntries(Object.entries(body).filter(([key]) => def.writable.includes(key)))
}

function queryValue(req: Request, key: string) { const value = req.query[key]; return typeof value === 'string' ? value : undefined }

async function list(req: Request, res: Response, def: ResourceDefinition) {
  const query = listQuerySchema.parse(req.query)
  const sortName = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
  if (!def.sortable.includes(sortName)) throw new ApiError(400, 'INVALID_SORT', 'The sort field is not supported')
  const descending = query.sort.startsWith('-')
  let builder = req.db!.from(def.table).select(def.fields.join(', '), { count: 'exact' })
  if (def.table === 'user_preferences' || def.table === 'user_entity_visibility_preferences') builder = builder.eq('user_id', req.user!.id)
  if (query.search && def.searchable.length) {
    const clauses = def.searchable.map((field) => `${field}.ilike.%${query.search!.replace(/[%_,]/g, '')}%`).join(',')
    builder = builder.or(clauses)
  }
  for (const field of ['teaching_id', 'status', 'course_id', 'classroom_id', 'student_id', 'class_session_id']) {
    const value = queryValue(req, field)
    if (value) builder = builder.eq(field, value)
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
  if (req.method === 'GET') {
    await allowed(req, permissionFor(def, 'read'), id)
    const result = await req.db!.from(def.table).select(def.fields.join(', ')).eq(def.idColumn, id).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return sendData(req, res, result.data)
  }
  const action = req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete'
  await allowed(req, permissionFor(def, action), id)
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  let response: Response
  if (req.method === 'DELETE') {
    const result = await req.db!.from(def.table).delete().eq(def.idColumn, id).select(def.fields.join(', ')).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }
  const body = pickBody(def, bodySchema.parse(req.body))
  if (!Object.keys(body).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one writable field is required')
  const result = await req.db!.from(def.table).update(body).eq(def.idColumn, id).select(def.fields.join(', ')).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); response = res.json(envelope); return response
}

async function collection(req: Request, res: Response, def: ResourceDefinition) {
  if (req.method === 'GET') { await allowed(req, def.permission, null); return list(req, res, def) }
  const action = req.method === 'POST' ? 'create' : 'update'
  await allowed(req, permissionFor(def, action), null)
  const replay = await idempotency(req, 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const body = pickBody(def, bodySchema.parse(req.body))
  if (!Object.keys(body).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one writable field is required')
  const insertBody = def.table === 'user_entity_visibility_preferences' ? { ...body, user_id: req.user!.id } : body
  const result = req.method === 'POST' ? await req.db!.from(def.table).insert(insertBody).select(def.fields.join(', ')).single() : await req.db!.from(def.table).update(body).select(def.fields.join(', ')).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
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
  const action = req.method === 'GET' ? 'list' : req.method === 'POST' ? 'create' : req.method === 'PATCH' ? 'update' : 'delete'
  await teachingAllowed(req, `teaching.members.${action}`, teachingId)
  if (req.method === 'GET') {
    const result = await req.db!.from('teaching_members').select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').eq('teaching_id', teachingId).order('created_at', { ascending: true })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? {}, { limit: result.data?.length ?? 0, offset: 0, total: result.data?.length ?? 0, sort: 'created_at' })
  }
  if (req.method === 'POST') {
    const body = bodySchema.parse(req.body)
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
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = req.method === 'DELETE'
    ? await req.db!.from('teaching_members').delete().eq('teaching_id', teachingId).eq('user_id', userId).select('teaching_id,user_id,role_id,status,effective_from,effective_to').maybeSingle()
    : await req.db!.from('teaching_members').update(pickBody({ writable: ['role_id', 'status', 'effective_from', 'effective_to'] }, bodySchema.parse(req.body))).eq('teaching_id', teachingId).eq('user_id', userId).select('teaching_id,user_id,role_id,status,effective_from,effective_to,created_at,updated_at').maybeSingle()
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
    router.get(`/${route}`, wrap((req, res) => collection(req, res, def)))
    router.post(`/${route}`, wrap((req, res) => collection(req, res, def)))
    router.get(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
    router.patch(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
    router.delete(`/${route}/:id`, wrap((req, res) => item(req, res, def)))
  }
  return router
}

function wrap(handler: (req: Request, res: Response, next?: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res, next)).catch(next)
}

