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

  it('marks holiday and suspension reports as system-managed absence', () => {
    expect(initialReportAttendance({ holiday: true, suspended: false })).toEqual({ attendance_status: 'absent', absence_reason: 'holiday' })
    expect(initialReportAttendance({ holiday: false, suspended: true })).toEqual({ attendance_status: 'absent', absence_reason: 'suspension' })
    expect(initialReportAttendance({ holiday: false, suspended: false })).toEqual({ attendance_status: 'pending', absence_reason: null })
    expect(initialReportAttendance({ holiday: true, suspended: true })).toEqual({ attendance_status: 'absent', absence_reason: 'suspension' })
  })
})
