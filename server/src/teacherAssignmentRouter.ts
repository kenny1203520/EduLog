import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './http/errors.js'
import { attachTeacherProfile, complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './http/context.js'
import { requireAuthorizationDecision } from './authorization.js'

const assignmentFields = 'id,class_session_id,teacher_id,effective_from,effective_to,role_id,created_at,updated_at'
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const assignmentFieldsSchema = z.object({
  teacher_id: z.string().uuid(),
  role_id: z.string().uuid().optional(),
  effective_from: dateSchema,
  effective_to: dateSchema.nullable().optional(),
}).strict()
const validateAssignmentRange = (value: { effective_from?: string; effective_to?: string | null }, ctx: z.RefinementCtx) => {
  if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'effective_to must not be before effective_from' })
}
export const assignmentSchema = assignmentFieldsSchema.superRefine(validateAssignmentRange)
export const teacherAssignmentCreateSchema = z.object({ teachers: z.array(assignmentSchema).max(100) }).strict()
export const teacherAssignmentUpdateSchema = assignmentFieldsSchema.partial().strict().superRefine((value, ctx) => {
  if (value.effective_from && value.effective_to) validateAssignmentRange(value, ctx)
})
export const teacherAssignmentRemoveSchema = z.object({ teacher_id: z.string().uuid().optional(), effective_from: dateSchema.optional() }).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function sessionId(req: Request) {
  const value = typeof req.params.sessionId === 'string' ? req.params.sessionId : undefined
  if (!value || !z.string().uuid().safeParse(value).success) throw new ApiError(400, 'INVALID_ID', 'Class session id is invalid')
  return value
}

async function authorize(req: Request, id: string, action: 'read' | 'list' | 'create' | 'update' | 'delete') {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'class-session-teachers', resourceId: null, action, permission: `teaching.class_sessions.${action}`, scopeId: id, scopeType: 'class_session' })
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: 'teaching.class_sessions.' + action,
    p_classroom_id: null,
    p_class_session_id: id,
  })
  requireAuthorizationDecision(req, result, { permission: `teaching.class_sessions.${action}`, stage: 'session_teacher_assignment_permission', message: 'You do not have permission to manage session teachers', scopeId: id, scopeType: 'class_session' })
  if (action === 'create' || action === 'update' || action === 'delete') {
    const roleResult = await req.db.rpc('has_api_permission', {
      p_user_id: req.user.id,
      p_permission_key: 'teaching.roles.manage',
      p_classroom_id: null,
      p_class_session_id: id,
    })
    requireAuthorizationDecision(req, roleResult, { permission: 'teaching.roles.manage', stage: 'session_teacher_assignment_role_permission', message: 'Teaching-role management permission is required to assign class roles', scopeId: id, scopeType: 'class_session' })
  }
}

async function resolveRoleId(req: Request, roleId?: string) {
  if (roleId) {
    const result = await req.db!.from('roles').select('id').eq('id', roleId).eq('domain', 'teaching').maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(422, 'INVALID_REFERENCE', 'The selected role is not a teaching role')
    return roleId
  }
  const result = await req.db!.from('roles').select('id').eq('domain', 'teaching').eq('code', 'teacher').maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data?.id) throw new ApiError(422, 'INVALID_REFERENCE', 'The default teacher role is not configured')
  return result.data.id as string
}

function mapAssignment(row: any) {
  const teacher = row.teachers
  if (!teacher) return null
  return { ...teacher, effective_from: row.effective_from, effective_to: row.effective_to, role_id: row.role_id, role: row.roles ?? null }
}

async function hydrateAssignments(req: Request, rows: any[]) {
  if (!rows.length) return []
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The teacher service is unavailable')
  const teacherIds = [...new Set(rows.map((row) => row.teacher_id).filter((id): id is string => typeof id === 'string'))]
  const roleIds = [...new Set(rows.map((row) => row.role_id).filter((id): id is string => typeof id === 'string'))]
  const [teacherResult, roleResult] = await Promise.all([
    teacherIds.length
      ? req.adminDb.from('teachers').select('id,user_id,name,bio,created_at,updated_at').in('id', teacherIds)
      : Promise.resolve({ data: [], error: null }),
    roleIds.length
      ? req.adminDb.from('roles').select('id,name,code').in('id', roleIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (teacherResult.error) throw mapDatabaseError(teacherResult.error)
  if (roleResult.error) throw mapDatabaseError(roleResult.error)
  const teachers = new Map((teacherResult.data ?? []).map((row: any) => [row.id, row]))
  const roles = new Map((roleResult.data ?? []).map((row: any) => [row.id, row]))
  return rows.map((row) => ({
    ...row,
    teachers: teachers.get(row.teacher_id) ?? null,
    roles: roles.get(row.role_id) ?? null,
  }))
}

async function list(req: Request, res: Response) {
  const id = sessionId(req)
  await authorize(req, id, 'list')
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The teacher service is unavailable')
  const result = await req.adminDb.from('class_session_teachers').select(assignmentFields).eq('class_session_id', id).order('effective_from', { ascending: false })
  if (result.error) throw mapDatabaseError(result.error)
  const onDate = typeof req.query.on_date === 'string' ? req.query.on_date : undefined
  if (onDate && !dateSchema.safeParse(onDate).success) throw new ApiError(400, 'INVALID_DATE', 'on_date is invalid')
  const scopedRows = (result.data ?? []).filter((row: any) => !onDate || (row.effective_from <= onDate && (!row.effective_to || row.effective_to >= onDate)))
  const data = (await hydrateAssignments(req, scopedRows)).map(mapAssignment).filter(Boolean)
  const enriched = await attachTeacherProfile(req, data)
  return res.json({ data: enriched, meta: { limit: data.length, offset: 0, total: data.length, sort: 'effective_from' }, request_id: req.requestId, trace_id: req.traceId })
}

async function create(req: Request, res: Response) {
  const id = sessionId(req)
  const input = teacherAssignmentCreateSchema.parse(req.body)
  // Assignments are relationship-management mutations on an existing class
  // session. Keep POST, PATCH, and DELETE aligned with the RLS policy and
  // OpenAPI contract: all require class-session update permission.
  await authorize(req, id, 'update')
  const replay = await idempotency(req, 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  if (input.teachers.length === 0) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one teacher assignment is required')
  const rows = await Promise.all(input.teachers.map(async (teacher) => ({ ...teacher, role_id: await resolveRoleId(req, teacher.role_id), class_session_id: id })))
  const result = await req.db!.from('class_session_teachers').insert(rows).select(assignmentFields)
  if (result.error) throw mapDatabaseError(result.error)
  const data = (await hydrateAssignments(req, result.data ?? [])).map(mapAssignment).filter(Boolean)
  setAuditContext(req, { resourceId: null, scopeId: id, scopeType: 'class_session' })
  const body = { data, meta: { count: data.length }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 201, body)
  return res.status(201).json(body)
}

async function replace(req: Request, res: Response) {
  const id = sessionId(req)
  const input = teacherAssignmentCreateSchema.parse(req.body)
  await authorize(req, id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const rows = await Promise.all(input.teachers.map(async (teacher) => ({
    ...teacher,
    role_id: await resolveRoleId(req, teacher.role_id),
  })))
  const result = await req.db!.rpc('replace_class_session_teacher_assignments', { p_session_id: id, p_teachers: rows })
  if (result.error) throw mapDatabaseError(result.error)
  const data = (await hydrateAssignments(req, result.data ?? [])).map(mapAssignment).filter(Boolean)
  setAuditContext(req, { resourceId: null, scopeId: id, scopeType: 'class_session' })
  const body = { data, meta: { count: data.length }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function remove(req: Request, res: Response) {
  const id = sessionId(req)
  const removalBody = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const input = teacherAssignmentRemoveSchema.parse({
    teacher_id: removalBody.teacher_id ?? req.query.teacher_id,
    effective_from: removalBody.effective_from ?? req.query.effective_from,
  })
  if (req.params.teacherId && !z.string().uuid().safeParse(req.params.teacherId).success) throw new ApiError(400, 'INVALID_ID', 'Teacher id is invalid')
  await authorize(req, id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  let builder = req.db!.from('class_session_teachers').delete().eq('class_session_id', id)
  if (req.params.teacherId) {
    builder = builder.eq('teacher_id', req.params.teacherId)
  }
  if (input.teacher_id) builder = builder.eq('teacher_id', input.teacher_id)
  if (input.effective_from) builder = builder.eq('effective_from', input.effective_from)
  const result = await builder.select(assignmentFields)
  if (result.error) throw mapDatabaseError(result.error)
  const data = (await hydrateAssignments(req, result.data ?? [])).map(mapAssignment).filter(Boolean)
  setAuditContext(req, { resourceId: null, scopeId: id, scopeType: 'class_session' })
  const body = { data, meta: { count: data.length }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function update(req: Request, res: Response) {
  const id = sessionId(req)
  const assignmentId = typeof req.params.assignmentId === 'string' && z.string().uuid().safeParse(req.params.assignmentId).success ? req.params.assignmentId : undefined
  if (!assignmentId) throw new ApiError(400, 'INVALID_ID', 'Assignment id is invalid')
  const input = teacherAssignmentUpdateSchema.parse(req.body)
  if (!Object.keys(input).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one assignment field is required')
  await authorize(req, id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('class_session_teachers').update(input).eq('id', assignmentId).eq('class_session_id', id).select(assignmentFields).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher assignment was not found')
  const data = (await hydrateAssignments(req, [result.data])).map(mapAssignment)[0]
  setAuditContext(req, { resourceId: assignmentId, scopeId: id, scopeType: 'class_session' })
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

export function createTeacherAssignmentRouter() {
  const router = Router()
  router.get('/class-sessions/:sessionId/teachers', wrap(list))
  router.post('/class-sessions/:sessionId/teachers', wrap(create))
  router.put('/class-sessions/:sessionId/teachers', wrap(replace))
  router.delete('/class-sessions/:sessionId/teachers', wrap(remove))
  router.delete('/class-sessions/:sessionId/teachers/:teacherId', wrap(remove))
  router.patch('/class-sessions/:sessionId/teachers/:assignmentId', wrap(update))
  return router
}
