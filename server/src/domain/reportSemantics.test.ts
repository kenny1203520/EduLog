import { describe, expect, it } from 'vitest'
import { initialReportAttendance, isIncompleteReport, isTeacherPresent, reportMissingFlags } from './reportSemantics.js'

describe('report domain semantics', () => {
  it('uses one completeness definition for dashboard and incomplete-report views', () => {
    const complete = { content: 'done', lesson_id: 'lesson-1', is_completed: true, class_participation: 5, classroom_behavior: 5 }
    expect(isIncompleteReport(complete)).toBe(false)
    expect(reportMissingFlags({ ...complete, class_participation: 0 })).toMatchObject({ missingParticipation: true, isMissing: true })
  })

  it('requires a positive explicit teacher attendance signal', () => {
    expect(isTeacherPresent('teacher-1', 'user-1', ['teacher-1'], { 'teacher-1': true })).toBe(true)
    expect(isTeacherPresent('teacher-1', 'user-1', ['teacher-1'], { 'teacher-1': false })).toBe(false)
    expect(isTeacherPresent('teacher-1', 'user-1', ['teacher-2'], { 'teacher-2': true })).toBe(false)
  })

  it('requires every report field and does not let completion skip other fields', () => {
    const complete = {
      content: 'done',
      lesson_id: 'lesson-1',
      is_completed: false,
      progress_letter: 'A',
      class_participation: 1,
      classroom_behavior: 1,
    }

    const cases = [
      ['content', { content: '   ' }, 'missingContent'],
      ['lesson', { lesson_id: null }, 'missingLesson'],
      ['progress', { is_completed: false, progress_letter: '  ' }, 'missingProgress'],
      ['participation', { class_participation: 0 }, 'missingParticipation'],
      ['behavior', { classroom_behavior: 0 }, 'missingBehavior'],
    ] as const

    for (const [, change, flag] of cases) {
      expect(reportMissingFlags({ ...complete, ...change })[flag]).toBe(true)
      expect(isIncompleteReport({ ...complete, ...change })).toBe(true)
    }

    expect(reportMissingFlags({ ...complete, is_completed: true, progress_letter: null })).toMatchObject({
      missingProgress: false,
      isMissing: false,
    })
    expect(reportMissingFlags({ ...complete, is_completed: true, content: '' })).toMatchObject({
      missingContent: true,
      isMissing: true,
    })
  })

  it('marks holiday and suspension reports as system-managed absence', () => {
    expect(initialReportAttendance({ holiday: true, suspended: false })).toEqual({ attendance_status: 'absent', absence_reason: 'holiday' })
    expect(initialReportAttendance({ holiday: false, suspended: true })).toEqual({ attendance_status: 'absent', absence_reason: 'suspension' })
    expect(initialReportAttendance({ holiday: false, suspended: false })).toEqual({ attendance_status: 'pending', absence_reason: null })
    expect(initialReportAttendance({ holiday: true, suspended: true })).toEqual({ attendance_status: 'absent', absence_reason: 'suspension' })
  })
})
