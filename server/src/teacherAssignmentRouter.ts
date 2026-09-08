import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

const assignmentFields = 'id,class_session_id,teacher_id,effective_from,effective_to,role_id,created_at,updated_at,roles(id,name,code),teachers(id,user_id,name,email,phone,address,bio,created_at,updated_at)'
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const assignmentSchema = z.object({
  teacher_id: z.string().uuid(),
  role_id: z.string().uuid().optional(),
  effective_from: dateSchema,
  effective_to: dateSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.effective_to && value.effective_to < value.effective_from) ctx.addIssue({ code: 'custom', path: ['effective_to'], message: 'effective_to must not be before effective_from' })
})
const bulkSchema = z.object({ teachers: z.array(assignmentSchema).max(100) }).strict()
const removeSchema = z.object({ teacher_id: z.string().uuid().optional(), effective_from: dateSchema.optional() }).strict()

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
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: 'teaching.sessions.' + action,
    p_classroom_id: null,
    p_class_session_id: id,
  })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage session teachers')
}

async function resolveRoleId(req: Request, roleId?: string) {
  if (roleId) return roleId
  const result = await req.db!.from('roles').select('id').eq('code', 'teacher').maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data?.id) throw new ApiError(422, 'INVALID_REFERENCE', 'The default teacher role is not configured')
  return result.data.id as string
}

function mapAssignment(row: any) {
  const teacher = row.teachers
  if (!teacher) return null
  return { ...teacher, effective_from: row.effective_from, effective_to: row.effective_to, role_id: row.role_id, role: row.roles ?? null }
}

async function list(req: Request, res: Response) {
  const id = sessionId(req)
  await authorize(req, id, 'list')
  const result = await req.db!.from('class_session_teachers').select(assignmentFields).eq('class_session_id', id).order('effective_from', { ascending: false })
  if (result.error) throw mapDatabaseError(result.error)
  const onDate = typeof req.query.on_date === 'string' ? req.query.on_date : undefined
  if (onDate && !dateSchema.safeParse(onDate).success) throw new ApiError(400, 'INVALID_DATE', 'on_date is invalid')
  const data = (result.data ?? []).filter((row: any) => !onDate || (row.effective_from <= onDate && (!row.effective_to || row.effective_to >= onDate))).map(mapAssignment).filter(Boolean)
  return res.json({ data, meta: { limit: data.length, offset: 0, total: data.length, sort: 'effective_from' }, request_id: req.requestId, trace_id: req.traceId })
}

async function create(req: Request, res: Response) {
  const id = sessionId(req)
  await authorize(req, id, 'create')
  const input = bulkSchema.parse(req.body)
  const replay = await idempotency(req, 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  if (input.teachers.length === 0) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one teacher assignment is required')
  const rows = await Promise.all(input.teachers.map(async (teacher) => ({ ...teacher, role_id: await resolveRoleId(req, teacher.role_id), class_session_id: id })))
  const result = await req.db!.from('class_session_teachers').insert(rows).select(assignmentFields)
  if (result.error) throw mapDatabaseError(result.error)
  const body = { data: result.data ?? [], meta: { count: result.data?.length ?? 0 }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 201, body)
  return res.status(201).json(body)
}

async function remove(req: Request, res: Response) {
  const id = sessionId(req)
  await authorize(req, id, 'delete')
  const removalBody = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
  const input = removeSchema.parse({
    teacher_id: removalBody.teacher_id ?? req.query.teacher_id,
    effective_from: removalBody.effective_from ?? req.query.effective_from,
  })
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  let builder = req.db!.from('class_session_teachers').delete().eq('class_session_id', id)
  if (req.params.teacherId) {
    if (!z.string().uuid().safeParse(req.params.teacherId).success) throw new ApiError(400, 'INVALID_ID', 'Teacher id is invalid')
    builder = builder.eq('teacher_id', req.params.teacherId)
  }
  if (input.teacher_id) builder = builder.eq('teacher_id', input.teacher_id)
  if (input.effective_from) builder = builder.eq('effective_from', input.effective_from)
  const result = await builder.select(assignmentFields)
  if (result.error) throw mapDatabaseError(result.error)
  const body = { data: result.data ?? [], meta: { count: result.data?.length ?? 0 }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function update(req: Request, res: Response) {
  const id = sessionId(req)
  await authorize(req, id, 'update')
  const assignmentId = typeof req.params.assignmentId === 'string' && z.string().uuid().safeParse(req.params.assignmentId).success ? req.params.assignmentId : undefined
  if (!assignmentId) throw new ApiError(400, 'INVALID_ID', 'Assignment id is invalid')
  const input = assignmentSchema.partial().strict().parse(req.body)
  if (!Object.keys(input).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one assignment field is required')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('class_session_teachers').update(input).eq('id', assignmentId).eq('class_session_id', id).select(assignmentFields).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher assignment was not found')
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

export function createTeacherAssignmentRouter() {
  const router = Router()
  router.get('/class-sessions/:sessionId/teachers', wrap(list))
  router.post('/class-sessions/:sessionId/teachers', wrap(create))
  router.delete('/class-sessions/:sessionId/teachers', wrap(remove))
  router.delete('/class-sessions/:sessionId/teachers/:teacherId', wrap(remove))
  router.patch('/class-sessions/:sessionId/teachers/:assignmentId', wrap(update))
  return router
}