import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchScheduleRule, plannedLessonDates, type ScheduleRule } from './occurrenceSchedule.js'
import { todayIn } from '../routes/rest/enrollmentRouter.js'

const saturday: ScheduleRule = { schedule_kind: 'weekly', day_of_week: 6, day_of_month: null, occurrence_date: null, start_time: '10:00', end_time: '12:00' }

describe('lesson schedule planning', () => {
  it('matches weekly, monthly and specific-date rules', () => {
    expect(matchScheduleRule([saturday], '2026-10-03')).toBe(saturday)
    expect(matchScheduleRule([saturday], '2026-10-04')).toBeUndefined()
    const monthly = { ...saturday, schedule_kind: 'monthly', day_of_week: null, day_of_month: 15 }
    expect(matchScheduleRule([monthly], '2026-10-15')).toBe(monthly)
    const specific = { ...saturday, schedule_kind: 'specific_dates', day_of_week: null, occurrence_date: '2026-10-07' }
    expect(matchScheduleRule([specific], '2026-10-07')).toBe(specific)
  })

  it('plans the first N lesson dates from the start date within the session window', () => {
    expect(plannedLessonDates([saturday], {}, '2026-09-30', 3)).toEqual(['2026-10-03', '2026-10-10', '2026-10-17'])
    expect(plannedLessonDates([saturday], { start_date: '2026-10-08' }, '2026-09-30', 2)).toEqual(['2026-10-10', '2026-10-17'])
    expect(plannedLessonDates([saturday], { end_date: '2026-10-12' }, '2026-09-30', 5)).toEqual(['2026-10-03', '2026-10-10'])
    expect(plannedLessonDates([], {}, '2026-09-30', 5)).toEqual([])
  })

  it('uses the enrollment time zone for the default start date', () => {
    const lateUtc = new Date('2026-10-02T17:30:00Z')
    expect(todayIn('Asia/Taipei', lateUtc)).toBe('2026-10-03')
    expect(todayIn('UTC', lateUtc)).toBe('2026-10-02')
  })
})

describe('enrollment report provisioning contract', () => {
  it('syncs only this enrollment through sync_enrollment_reports', () => {
    const source = readFileSync(new URL('../routes/rest/enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('sync_enrollment_reports'")
    expect(source).not.toContain("rpc('provision_occurrence_reports'")
    expect(source).toContain("'/enrollments/:id/start-date-impact'")
    expect(source).toContain('ignoreDuplicates: true')
    // Back-dated starts must not skip lessons before the generated window.
    expect(source).toContain('if (planned.target_count > 0) await ensurePlannedLessons(')
    expect(source).not.toContain('if (planned.missing_count > 0) await ensurePlannedLessons(')
  })
})
