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

/**
 * The first `count` scheduled lesson dates on or after `fromDate`, within the
 * session's own start/end dates, scanning at most `maxDays` days.
 */
export function plannedLessonDates(
  rules: ScheduleRule[],
  session: { start_date?: string | null; end_date?: string | null },
  fromDate: string,
  count: number,
  maxDays = 3660,
): string[] {
  const dates: string[] = []
  let date = session.start_date && session.start_date > fromDate ? session.start_date : fromDate
  for (let scanned = 0; dates.length < count && scanned <= maxDays; scanned++, date = nextDate(date)) {
    if (session.end_date && date > session.end_date) break
    if (matchScheduleRule(rules, date)) dates.push(date)
  }
  return dates
}
