import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision } from '../../auth/authorization.js'

const fields = 'id,class_session_id,occurrence_date,status,notes,original_start_time,original_end_time,actual_start_time,actual_end_time,teacher_ids,teacher_attendance,is_conducted,time_zone,created_at,updated_at'
const syncBody = z.object({ scope: z.enum(['future', 'all']).default('future') }).strict()
type Rule = { schedule_kind: string; day_of_week: number | null; day_of_month: number | null; occurrence_date: string | null; start_time: string; end_time: string }
type Existing = { id: string; occurrence_date: string; status: string; notes: string | null; original_start_time: string | null; original_end_time: string | null; actual_start_time: string | null; actual_end_time: string | null; is_conducted: boolean | null; teacher_attendance: Record<string, boolean> | null; occurrence_reports: Array<{ id: string; content: string | null; class_notes: string | null; contact_notes: string | null; is_completed: boolean | null; attendance_status: string | null; version: number | null }> }

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
function today() { return new Date().toISOString().slice(0, 10) }
function addMonths(date: string, months: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + months); return value.toISOString().slice(0, 10) }
function nextDate(value: string) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10) }
function protectedData(row: Existing) {
  const manual = Boolean(row.notes?.trim() || row.actual_start_time || row.actual_end_time || row.status !== 'scheduled' || row.is_conducted === false || Object.keys(row.teacher_attendance || {}).length > 0)
  const report = row.occurrence_reports.some((item) => Boolean(item.content?.trim() || item.class_notes?.trim() || item.contact_notes?.trim() || item.is_completed || (item.attendance_status && item.attendance_status !== 'pending') || (item.version || 1) > 1))
  return manual || report
}
function matchingRule(rules: Rule[], date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return rules.find((rule) => rule.schedule_kind === 'specific_dates' ? rule.occurrence_date === date : rule.schedule_kind === 'monthly' ? rule.day_of_month === Number(date.slice(8, 10)) : rule.day_of_week === day)
}

async function sync(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const sessionId = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!sessionId) throw new ApiError(400, 'INVALID_ID', 'Class session id is required')
  const input = syncBody.parse(req.body ?? {})
  setAuditContext(req, { domain: 'teaching', resource: 'occurrences', resourceId: null, action: 'update', permission: 'teaching.class_sessions.update', scopeId: sessionId, scopeType: 'class_session' })
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.class_sessions.update', p_classroom_id: null, p_class_session_id: sessionId })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.class_sessions.update', stage: 'session_sync_permission', message: 'You do not have permission to synchronize this session', scopeId: sessionId, scopeType: 'class_session' })
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const session = await req.db.from('class_sessions').select('id,start_date,end_date,time_zone,user_id,class_session_schedule_rules(schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)').eq('id', sessionId).maybeSingle()
  if (session.error) throw mapDatabaseError(session.error)
  if (!session.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  const current = today()
  const start = input.scope === 'all' ? (session.data.start_date || current) : session.data.start_date && session.data.start_date > current ? session.data.start_date : current
  let end = session.data.end_date || addMonths(start, 6)
  const defaultEnd = addMonths(start, 6)
  if (end > defaultEnd && !session.data.end_date) end = defaultEnd
  if (end < start) return res.json({ data: { created: 0, updated: 0, deleted: 0, preserved: 0 }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  const existingResult = await req.db.from('class_occurrences').select('id,occurrence_date,status,notes,original_start_time,original_end_time,actual_start_time,actual_end_time,is_conducted,teacher_attendance,occurrence_reports(id,content,class_notes,contact_notes,is_completed,attendance_status,version)').eq('class_session_id', sessionId).gte('occurrence_date', start)
  if (existingResult.error) throw mapDatabaseError(existingResult.error)
  const existing = (existingResult.data ?? []) as unknown as Existing[]
  const planned = new Map<string, Rule>()
  const rules = (session.data.class_session_schedule_rules ?? []) as Rule[]
  for (let date = start; date <= end; date = nextDate(date)) { const rule = matchingRule(rules, date); if (rule) planned.set(date, rule) }
  const retained = new Set<string>(); const stale: string[] = []; const placeholderReports: string[] = []; let preserved = 0; let updated = 0
  for (const row of existing) {
    const target = planned.get(row.occurrence_date)
    if (protectedData(row)) { retained.add(row.occurrence_date); preserved++; continue }
    if (!target) { stale.push(row.id); placeholderReports.push(...row.occurrence_reports.map((report) => report.id)); continue }
    retained.add(row.occurrence_date)
    if (row.original_start_time?.slice(0, 5) !== target.start_time.slice(0, 5) || row.original_end_time?.slice(0, 5) !== target.end_time.slice(0, 5)) {
      const result = await req.db.from('class_occurrences').update({ original_start_time: target.start_time, original_end_time: target.end_time, time_zone: session.data.time_zone }).eq('id', row.id)
      if (result.error) throw mapDatabaseError(result.error)
      updated++
    }
  }
  if (placeholderReports.length) { const result = await req.db.from('occurrence_reports').delete().in('id', placeholderReports); if (result.error) throw mapDatabaseError(result.error) }
  if (stale.length) { const result = await req.db.from('class_occurrences').delete().in('id', stale); if (result.error) throw mapDatabaseError(result.error) }
  const rows: Record<string, unknown>[] = []
  for (const [date, rule] of planned) {
    if (retained.has(date)) continue
    rows.push({ class_session_id: sessionId, occurrence_date: date, status: 'scheduled', original_start_time: rule.start_time, original_end_time: rule.end_time, time_zone: session.data.time_zone || 'Asia/Taipei', is_conducted: true })
  }
  let created = 0
  if (rows.length) { const result = await req.db.from('class_occurrences').upsert(rows, { onConflict: 'class_session_id,occurrence_date', ignoreDuplicates: true }).select(fields); if (result.error) throw mapDatabaseError(result.error); created = result.data?.length ?? 0 }
  const body = { data: { created, updated, deleted: stale.length, preserved }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

export function createSyncRouter() { const router = Router(); router.post('/class-sessions/:id/occurrences/sync', wrap(sync)); return router }
