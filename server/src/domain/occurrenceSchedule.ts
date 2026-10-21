export type ScheduleRule = {
  schedule_kind: string
  day_of_week: number | null
  day_of_month: number | null
  occurrence_date: string | null
  start_time: string
  end_time: string
}

export function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** The schedule rule that produces a lesson on `date` (YYYY-MM-DD), if any. */
export function matchScheduleRule(rules: ScheduleRule[], date: string): ScheduleRule | undefined {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return rules.find((candidate) => candidate.schedule_kind === 'specific_dates'
    ? candidate.occurrence_date === date
    : candidate.schedule_kind === 'monthly'
      ? candidate.day_of_month === Number(date.slice(8, 10))
      : candidate.day_of_week === day)
}

export type ClosureHoliday = {
  start_date: string
  end_date: string
  classroom_ids: string[] | null
  class_session_ids: string[] | null
}

/** Whether a closure applies to a class (an unscoped closure applies everywhere). */
export function closureApplies(holiday: ClosureHoliday, sessionId: string, classroomId: string | null) {
  const classrooms = holiday.classroom_ids ?? []
  const sessions = holiday.class_session_ids ?? []
  return (!classrooms.length && !sessions.length) || sessions.includes(sessionId) || (!!classroomId && classrooms.includes(classroomId))
}

/**
 * The scheduled lesson dates on or after `fromDate` up to the `count`-th open
 * one, within the session's own start/end dates, scanning at most `maxDays`
 * days. Closed dates (`isClosed`) are returned too, so the lesson exists on the
 * calendar, but they do not count toward `count`.
 */
export function plannedLessonDates(
  rules: ScheduleRule[],
  session: { start_date?: string | null; end_date?: string | null },
  fromDate: string,
  count: number,
  maxDays = 3660,
  isClosed: (date: string) => boolean = () => false,
): string[] {
  const dates: string[] = []
  let open = 0
  let date = session.start_date && session.start_date > fromDate ? session.start_date : fromDate
  for (let scanned = 0; open < count && scanned <= maxDays; scanned++, date = nextDate(date)) {
    if (session.end_date && date > session.end_date) break
    if (!matchScheduleRule(rules, date)) continue
    dates.push(date)
    if (!isClosed(date)) open++
  }
  return dates
}
