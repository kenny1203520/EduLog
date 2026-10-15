import { describe, expect, it } from 'vitest'
import { filterOccurrencesByAssignments, isAssignmentEffectiveOn, type TeacherSessionAssignment } from './dashboardSchedule.js'

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
})
