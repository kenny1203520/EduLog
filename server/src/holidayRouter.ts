import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const fields = 'id,start_date,end_date,time_zone,name,kind,classroom_ids,class_session_ids,teacher_ids,created_at,updated_at'
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const ids = z.array(z.string().uuid()).max(500).default([])
const createSchema = z.object({
  start_date: date,
  end_date: date,
  time_zone: z.string().min(1).max(64).optional(),
  name: z.string().max(200).nullable().optional(),
  kind: z.enum(['closure', 'teacher_leave']).default('closure'),
  classroom_ids: ids,
  class_session_ids: ids,
  teacher_ids: ids,
}).strict()
const updateSchema = createSchema.partial().strict()

type Holiday = {
  id: string; start_date: string; end_date: string; time_zone: string | null; name: string | null
  kind: 'closure' | 'teacher_leave'; classroom_ids: string[] | null; class_session_ids: string[] | null
  teacher_ids: string[] | null; created_at?: string; updated_at?: string
}
type Occurrence = { id: string; class_session_id: string | null; occurrence_date: string; teacher_ids: string[] | null; teacher_attendance: Record<string, boolean> | null; is_conducted: boolean | null; class_sessions?: { classroom_id: string | null } | { classroom_id: string | null }[] | null }

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
function validRange(start: string, end: string) { if (end < start) throw new ApiError(422, 'INVALID_DATE_RANGE', 'end_date must not be before start_date') }
function safeTimezone(value?: string | null) {
  if (!value) return 'Asia/Taipei'
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value } catch { return 'Asia/Taipei' }
}
function array(value: string[] | null | undefined) { return value ?? [] }
function applies(holiday: Holiday, occurrence: Occurrence) {
  const classroomId = Array.isArray(occurrence.class_sessions) ? occurrence.class_sessions[0]?.classroom_id : occurrence.class_sessions?.classroom_id
  const classrooms = array(holiday.classroom_ids); const sessions = array(holiday.class_session_ids)
  return (!classrooms.length && !sessions.length) || (occurrence.class_session_id ? sessions.includes(occurrence.class_session_id) : false) || (!!classroomId && classrooms.includes(classroomId))
}

type HolidayScope = { classroom_ids?: string[] | null; class_session_ids?: string[] | null }

export async function permission(req: Request, action: 'create' | 'update' | 'delete' | 'list', scope: HolidayScope = {}) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const classroomIds = array(scope.classroom_ids)
  const sessionIds = array(scope.class_session_ids)
  setAuditContext(req, { domain: action === 'list' ? 'teaching' : classroomIds.length || sessionIds.length ? 'teaching' : 'system', resource: 'holidays', action, permission: `teaching.holidays.${action}`, scopeId: classroomIds[0] ?? sessionIds[0] ?? null })
  if (!classroomIds.length && !sessionIds.length) {
    const rpcName = action === 'list' ? 'has_api_permission' : 'has_system_permission'
    const args = { p_user_id: req.user.id, p_permission_key: `teaching.holidays.${action}`, ...(action === 'list' ? { p_classroom_id: null, p_class_session_id: null } : {}) }
    const result = await req.db.rpc(rpcName, args)
    if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage holidays')
    return
  }
  for (const classroomId of classroomIds) {
    const result = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: `teaching.holidays.${action}`, p_classroom_id: classroomId, p_class_session_id: null })
    if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage holidays')
  }
  for (const sessionId of sessionIds) {
    const result = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: `teaching.holidays.${action}`, p_classroom_id: null, p_class_session_id: sessionId })
    if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage holidays')
  }
}

async function occurrences(req: Request, holiday: Holiday) {
  let query = req.db!.from('class_occurrences').select('id,class_session_id,occurrence_date,teacher_ids,teacher_attendance,is_conducted,class_sessions(classroom_id)').gte('occurrence_date', holiday.start_date).lte('occurrence_date', holiday.end_date)
  const sessions = array(holiday.class_session_ids)
  if (sessions.length) query = query.in('class_session_id', sessions)
  else if (array(holiday.classroom_ids).length) {
    const sessionResult = await req.db!.from('class_sessions').select('id').in('classroom_id', array(holiday.classroom_ids))
    if (sessionResult.error) throw mapDatabaseError(sessionResult.error)
    const sessionIds = (sessionResult.data ?? []).map((row) => row.id)
    if (!sessionIds.length) return [] as Occurrence[]
    query = query.in('class_session_id', sessionIds)
  }
  const result = await query
  if (result.error) throw mapDatabaseError(result.error)
  const rows = (result.data ?? []) as Occurrence[]
  if (holiday.kind !== 'teacher_leave') return rows.filter((row) => applies(holiday, row))
  const teacherIds = new Set(array(holiday.teacher_ids)); return rows.filter((row) => applies(holiday, row) && (row.teacher_ids ?? []).some((id) => teacherIds.has(id)))
}

async function updateReports(req: Request, occurrenceIds: string[], status: 'absent' | 'pending', reason: 'holiday' | null) {
  if (!occurrenceIds.length) return
  let query = req.db!.from('occurrence_reports').select('id,version,attendance_status,absence_reason').in('class_occurrence_id', occurrenceIds)
  if (status === 'pending') query = query.eq('attendance_status', 'absent').eq('absence_reason', 'holiday')
  const result = await query; if (result.error) throw mapDatabaseError(result.error)
  for (const report of result.data ?? []) {
    if (report.attendance_status === status && report.absence_reason === reason) continue
    const update = await req.db!.from('occurrence_reports').update({ attendance_status: status, absence_reason: reason, version: (report.version ?? 1) + 1 }).eq('id', report.id).eq('version', report.version ?? 1)
    if (update.error) throw mapDatabaseError(update.error)
  }
}

async function activeClosure(req: Request, occurrence: Occurrence, excludedId?: string) {
  const result = await req.db!.from('holidays').select(fields).lte('start_date', occurrence.occurrence_date).gte('end_date', occurrence.occurrence_date).eq('kind', 'closure')
  if (result.error) throw mapDatabaseError(result.error)
  return (result.data as Holiday[] ?? []).filter((holiday) => holiday.id !== excludedId && applies(holiday, occurrence)).length > 0
}

async function release(req: Request, holiday: Holiday) {
  const rows = await occurrences(req, holiday)
  if (holiday.kind === 'teacher_leave') {
    for (const row of rows) {
      const attendance = { ...(row.teacher_attendance ?? {}) }; let changed = false
      for (const teacherId of array(holiday.teacher_ids)) if (!(await activeTeacherLeave(req, row, teacherId, holiday.id)) && attendance[teacherId] === false) { attendance[teacherId] = true; changed = true }
      if (changed) { const result = await req.db!.from('class_occurrences').update({ teacher_attendance: attendance }).eq('id', row.id); if (result.error) throw mapDatabaseError(result.error) }
    }
    return
  }
  const releasable = [] as Occurrence[]
  for (const row of rows) if (!(await activeClosure(req, row, holiday.id))) releasable.push(row)
  await updateReports(req, releasable.map((row) => row.id), 'pending', null)
  for (const row of releasable) {
    const attendance = Object.fromEntries((row.teacher_ids ?? []).map((id) => [id, true]))
    const result = await req.db!.from('class_occurrences').update({ is_conducted: true, teacher_attendance: attendance }).eq('id', row.id)
    if (result.error) throw mapDatabaseError(result.error)
  }
}

async function activeTeacherLeave(req: Request, occurrence: Occurrence, teacherId: string, excludedId?: string) {
  const result = await req.db!.from('holidays').select(fields).lte('start_date', occurrence.occurrence_date).gte('end_date', occurrence.occurrence_date)
  if (result.error) throw mapDatabaseError(result.error)
  return (result.data as Holiday[] ?? []).filter((holiday) => holiday.id !== excludedId && applies(holiday, occurrence)).some((holiday) => holiday.kind === 'closure' || array(holiday.teacher_ids).includes(teacherId))
}

async function sync(req: Request, holiday: Holiday) {
  const rows = await occurrences(req, holiday)
  if (holiday.kind === 'teacher_leave') {
    for (const row of rows) {
      const attendance = { ...(row.teacher_attendance ?? {}) }; let changed = false
      for (const teacherId of array(holiday.teacher_ids)) if ((row.teacher_ids ?? []).includes(teacherId) && attendance[teacherId] !== false) { attendance[teacherId] = false; changed = true }
      if (changed) { const result = await req.db!.from('class_occurrences').update({ teacher_attendance: attendance }).eq('id', row.id); if (result.error) throw mapDatabaseError(result.error) }
    }
    return
  }
  await updateReports(req, rows.map((row) => row.id), 'absent', 'holiday')
  for (const row of rows) {
    const attendance = Object.fromEntries((row.teacher_ids ?? []).map((id) => [id, false]))
    const result = await req.db!.from('class_occurrences').update({ is_conducted: false, teacher_attendance: attendance }).eq('id', row.id)
    if (result.error) throw mapDatabaseError(result.error)
  }
}

async function create(req: Request, res: Response) {
  const input = createSchema.parse(req.body); validRange(input.start_date, input.end_date); await permission(req, 'create', input)
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('holidays').insert({ ...input, time_zone: safeTimezone(input.time_zone) }).select(fields).single(); if (result.error) throw mapDatabaseError(result.error)
  await sync(req, result.data as Holiday); const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, body); return res.status(201).json(body)
}

async function update(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Holiday id is required')
  const current = await req.db!.from('holidays').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Holiday was not found')
  const input = updateSchema.parse(req.body); const start = input.start_date ?? current.data.start_date; const end = input.end_date ?? current.data.end_date; validRange(start, end)
  await permission(req, 'update', current.data as Holiday)
  await permission(req, 'update', { classroom_ids: input.classroom_ids ?? current.data.classroom_ids, class_session_ids: input.class_session_ids ?? current.data.class_session_ids })
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  await release(req, current.data as Holiday)
  const result = await req.db!.from('holidays').update({ ...input, time_zone: input.time_zone === undefined ? undefined : safeTimezone(input.time_zone) }).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Holiday was not found')
  await sync(req, result.data as Holiday); const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Holiday id is required')
  const current = await req.db!.from('holidays').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Holiday was not found')
  await permission(req, 'delete', current.data as Holiday); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  await release(req, current.data as Holiday); const result = await req.db!.from('holidays').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Holiday was not found')
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

async function check(req: Request, res: Response) {
  const input = z.object({ date, classroom_id: z.string().uuid().optional(), class_session_id: z.string().uuid().optional(), teacher_id: z.string().uuid().optional() }).strict().parse(req.query)
  await permission(req, 'list', { classroom_ids: input.classroom_id ? [input.classroom_id] : [], class_session_ids: input.class_session_id ? [input.class_session_id] : [] })
  let query = req.db!.from('holidays').select(fields).lte('start_date', input.date).gte('end_date', input.date)
  if (input.teacher_id) query = query.eq('kind', 'teacher_leave').contains('teacher_ids', [input.teacher_id])
  else query = query.eq('kind', 'closure')
  const result = await query; if (result.error) throw mapDatabaseError(result.error)
  const matched = (result.data as Holiday[] ?? []).some((holiday) => (!input.classroom_id && !input.class_session_id) || (array(holiday.classroom_ids).length === 0 && array(holiday.class_session_ids).length === 0) || (!!input.classroom_id && array(holiday.classroom_ids).includes(input.classroom_id)) || (!!input.class_session_id && array(holiday.class_session_ids).includes(input.class_session_id)))
  return res.json({ data: { matched }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
}

export function createHolidayRouter() { const router = Router(); router.get('/holidays/check', wrap(check)); router.post('/holidays', wrap(create)); router.patch('/holidays/:id', wrap(update)); router.delete('/holidays/:id', wrap(remove)); return router }
