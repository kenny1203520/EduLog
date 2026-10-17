import { describe, expect, it } from 'vitest'
import { filterOccurrencesByAssignments, filterOccurrencesByScheduleModes, isAssignmentEffectiveOn, type DashboardScheduleMode, type TeacherSessionAssignment } from './dashboardSchedule.js'

const assignments: TeacherSessionAssignment[] = [
  { class_session_id: 'session-a', effective_from: '2026-09-01', effective_to: null },
  { class_session_id: 'session-b', effective_from: '2026-09-01', effective_to: '2026-10-15' },
]

describe('dashboard schedule visibility', () => {
  it('treats assignment dates as inclusive and open-ended when effective_to is null', () => {
    expect(isAssignmentEffectiveOn(assignments[0]!, '2026-09-01')).toBe(true)
    expect(isAssignmentEffectiveOn(assignments[0]!, '2030-01-01')).toBe(true)
    expect(isAssignmentEffectiveOn(assignments[1]!, '2026-10-15')).toBe(true)
    expect(isAssignmentEffectiveOn(assignments[1]!, '2026-10-16')).toBe(false)
    expect(isAssignmentEffectiveOn(assignments[0]!, '2026-08-31')).toBe(false)
  })

  it('keeps only occurrences of sessions the teacher is assigned to on that date, regardless of attendance', () => {
    const rows = [
      { id: 'assigned', class_session_id: 'session-a', occurrence_date: '2026-10-16', teacher_attendance: {} },
      { id: 'assignment-ended', class_session_id: 'session-b', occurrence_date: '2026-10-16', teacher_attendance: {} },
      { id: 'still-assigned', class_session_id: 'session-b', occurrence_date: '2026-10-15', teacher_attendance: { other: true } },
      { id: 'unassigned', class_session_id: 'session-c', occurrence_date: '2026-10-16', teacher_attendance: {} },
    ]
    expect(filterOccurrencesByAssignments(rows, assignments).map((row) => row.id)).toEqual(['assigned', 'still-assigned'])
  })

  it('shows every class in "all", only taught classes in "assigned" and falls back to "assigned"', () => {
    const rows = [
      { id: 'all-taught', class_session_id: 'session-a', occurrence_date: '2026-10-16' },
      { id: 'all-other', class_session_id: 'session-c', occurrence_date: '2026-10-16' },
      { id: 'assigned-taught', class_session_id: 'session-b', occurrence_date: '2026-10-15' },
      { id: 'assigned-other', class_session_id: 'session-d', occurrence_date: '2026-10-16' },
      { id: 'unresolved-other', class_session_id: 'session-e', occurrence_date: '2026-10-16' },
    ]
    const modes = new Map<string, DashboardScheduleMode>([['session-a', 'all'], ['session-c', 'all'], ['session-b', 'assigned'], ['session-d', 'assigned']])
    expect(filterOccurrencesByScheduleModes(rows, modes, assignments).map((row) => row.id)).toEqual(['all-taught', 'all-other', 'assigned-taught'])
  })

  it('hides a class in "hidden" even when the user teaches it', () => {
    const rows = [{ id: 'hidden-taught', class_session_id: 'session-a', occurrence_date: '2026-10-16' }]
    expect(filterOccurrencesByScheduleModes(rows, new Map([['session-a', 'hidden' as const]]), assignments)).toEqual([])
  })
})
