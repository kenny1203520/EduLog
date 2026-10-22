import type { Request } from 'express'
import { closureApplies, matchScheduleRule, plannedLessonDates, type ClosureHoliday, type ScheduleRule } from '../../domain/occurrenceSchedule.js'

export type LessonProvisioning = {
  /** Scheduled dates scanned, closed ones included. */
  planned: number
  /** True when the schedule ran out (end date or no rules) before `count` open dates. */
  exhausted: boolean
}

/**
 * Inserts lessons the schedule rules call for but that were never generated,
 * up to the `count`-th open (non-closure) date from `fromDate`. Insert-only:
 * existing lessons, including cancelled ones, are left untouched. A lesson
 * generated on a closure date is created as not conducted. A caller without
 * occurrence-create permission simply keeps the lessons that already exist.
 */
export async function ensurePlannedLessons(req: Request, sessionId: string, fromDate: string, count: number): Promise<LessonProvisioning> {
  if (count <= 0) return { planned: 0, exhausted: false }
  const session = await req.db!.from('class_sessions').select('id,user_id,classroom_id,start_date,end_date,time_zone,class_session_schedule_rules(schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)').eq('id', sessionId).maybeSingle()
  const sessionRow = session.data
  if (session.error || !sessionRow) return { planned: 0, exhausted: true }
  const rules = (sessionRow.class_session_schedule_rules ?? []) as ScheduleRule[]
  const holidays = await req.db!.from('holidays').select('start_date,end_date,classroom_ids,class_session_ids').eq('kind', 'closure').gte('end_date', fromDate)
  const closures = holidays.error ? [] : ((holidays.data ?? []) as ClosureHoliday[]).filter((holiday) => closureApplies(holiday, sessionId, sessionRow.classroom_id ?? null))
  const isClosed = (date: string) => closures.some((holiday) => holiday.start_date <= date && holiday.end_date >= date)
  const dates = plannedLessonDates(rules, sessionRow, fromDate, count, undefined, isClosed)
  const exhausted = dates.filter((date) => !isClosed(date)).length < count
  if (!dates.length) return { planned: 0, exhausted }
  const existing = await req.db!.from('class_occurrences').select('occurrence_date').eq('class_session_id', sessionId).in('occurrence_date', dates)
  if (existing.error) return { planned: dates.length, exhausted: true }
  const existingDates = new Set((existing.data ?? []).map((row) => row.occurrence_date))
  const missing = dates.filter((date) => !existingDates.has(date))
  if (!missing.length) return { planned: dates.length, exhausted }
  const assignments = await req.db!.from('class_session_teachers').select('teacher_id,effective_from,effective_to').eq('class_session_id', sessionId)
  if (assignments.error) return { planned: dates.length, exhausted: true }
  const rows = missing.map((date) => {
    const rule = matchScheduleRule(rules, date)!
    const active = (assignments.data ?? []).filter((assignment) => assignment.effective_from <= date && (!assignment.effective_to || assignment.effective_to >= date)).map((assignment) => assignment.teacher_id)
    const teacherIds = [...new Set(active.length ? active : [sessionRow.user_id].filter(Boolean))]
    const conducted = !isClosed(date)
    return { class_session_id: sessionId, occurrence_date: date, status: 'scheduled', original_start_time: rule.start_time, original_end_time: rule.end_time, time_zone: sessionRow.time_zone || 'Asia/Taipei', is_conducted: conducted, teacher_ids: teacherIds, teacher_attendance: Object.fromEntries(teacherIds.map((id) => [id, conducted])) }
  })
  const inserted = await req.db!.from('class_occurrences').upsert(rows, { onConflict: 'class_session_id,occurrence_date', ignoreDuplicates: true })
  if (inserted.error) {
    req.log.warn({ event: 'enrollment_lesson_generation_skipped', database_error_code: inserted.error.code ?? 'UNKNOWN' }, 'enrollment_lesson_generation_skipped')
    return { planned: dates.length, exhausted: true }
  }
  return { planned: dates.length, exhausted }
}

/**
 * Generates lessons until `missing()` reports no shortfall: cancelled lessons,
 * closures and lessons the student transferred away from do not hold a report,
 * so the first batch can fall short. Stops when the schedule runs out.
 */
export async function fillPlannedLessons(req: Request, sessionId: string, fromDate: string, count: number, missing: () => Promise<number>, maxRounds = 5) {
  let target = count
  for (let round = 0; round < maxRounds; round++) {
    const provisioning = await ensurePlannedLessons(req, sessionId, fromDate, target)
    const shortfall = await missing()
    if (shortfall <= 0 || provisioning.exhausted) return shortfall
    target += shortfall
  }
  return missing()
}
