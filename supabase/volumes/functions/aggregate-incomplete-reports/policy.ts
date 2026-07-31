export interface PermissionDecision {
  is_allowed: boolean
  is_denied: boolean
  policy_configured: boolean
}

export function isTeacherPresentForScope(
  teacherId: string,
  teacherUserId: string | null | undefined,
  occurrenceTeacherIds: string[] = [],
  teacherAttendance: Record<string, boolean> = {},
): boolean {
  const teacherKeys = [teacherId, teacherUserId].filter(Boolean) as string[]
  const isAssigned = teacherKeys.some((key) => occurrenceTeacherIds.includes(key))
  if (!isAssigned) return false

  const attendanceValues = teacherKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(teacherAttendance, key))
    .map((key) => teacherAttendance[key])

  if (attendanceValues.some((value) => value === false)) return false
  return attendanceValues.some((value) => value === true)
}

export function canReceiveIncompleteReportNotification(
  isPresent: boolean,
  decision: PermissionDecision,
): boolean {
  if (!isPresent) return false
  if (!decision.policy_configured) return false
  return decision.is_allowed && !decision.is_denied
}
