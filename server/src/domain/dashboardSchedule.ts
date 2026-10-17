// Per-class mode resolved by public.resolve_dashboard_schedule_modes: every
// occurrence, only the classes the user teaches, or nothing at all.
export type DashboardScheduleMode = 'all' | 'assigned' | 'hidden'

export type TeacherSessionAssignment = {
  class_session_id: string
  effective_from: string
  effective_to: string | null
}

export type DashboardOccurrenceRow = {
  class_session_id: string
  occurrence_date: string
}

export function isAssignmentEffectiveOn(assignment: TeacherSessionAssignment, date: string) {
  return assignment.effective_from <= date && (assignment.effective_to == null || assignment.effective_to >= date)
}

// Teachers without the schedule-all permission see only the classes they are
// assigned to on the occurrence date, regardless of recorded attendance.
export function filterOccurrencesByAssignments<T extends DashboardOccurrenceRow>(rows: T[], assignments: TeacherSessionAssignment[]) {
  return rows.filter((row) => assignments.some((assignment) =>
    assignment.class_session_id === row.class_session_id && isAssignmentEffectiveOn(assignment, row.occurrence_date)))
}

// Classes without a resolved mode fall back to 'assigned'.
export function filterOccurrencesByScheduleModes<T extends DashboardOccurrenceRow>(rows: T[], modes: ReadonlyMap<string, DashboardScheduleMode>, assignments: TeacherSessionAssignment[]) {
  const assigned = filterOccurrencesByAssignments(rows, assignments)
  return rows.filter((row) => {
    const mode = modes.get(row.class_session_id) ?? 'assigned'
    return mode === 'all' || (mode === 'assigned' && assigned.includes(row))
  })
}
