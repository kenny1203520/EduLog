export type ReportCompletenessInput = {
  content?: string | null
  lesson_id?: string | null
  is_completed?: boolean | null
  progress_letter?: string | null
  class_participation?: number | null
  classroom_behavior?: number | null
}

export type ReportMissingFlags = {
  missingContent: boolean
  missingLesson: boolean
  missingProgress: boolean
  missingParticipation: boolean
  missingBehavior: boolean
  isMissing: boolean
}

export function reportMissingFlags(report: ReportCompletenessInput): ReportMissingFlags {
  const missingContent = !report.content?.trim()
  const missingLesson = !report.lesson_id
  const missingProgress = !(report.is_completed === true || Boolean(report.progress_letter?.trim()))
  const missingParticipation = !(report.class_participation != null && report.class_participation > 0)
  const missingBehavior = !(report.classroom_behavior != null && report.classroom_behavior > 0)
  return { missingContent, missingLesson, missingProgress, missingParticipation, missingBehavior, isMissing: missingContent || missingLesson || missingProgress || missingParticipation || missingBehavior }
}

export function isIncompleteReport(report: ReportCompletenessInput) {
  return reportMissingFlags(report).isMissing
}

export function isTeacherPresent(teacherId: string, userId: string, teacherIds: string[] = [], attendance: Record<string, boolean> = {}) {
  const identities = [teacherId, userId].filter(Boolean)
  if (!identities.some((identity) => teacherIds.includes(identity))) return false
  const observed = identities.filter((identity) => Object.prototype.hasOwnProperty.call(attendance, identity)).map((identity) => attendance[identity])
  return observed.includes(true) && !observed.includes(false)
}

export function initialReportAttendance(input: { holiday?: boolean; suspended?: boolean }) {
  // Suspension is more specific than a calendar closure and is the legacy
  // lifecycle policy's intentional precedence when both overlap.
  if (input.suspended) return { attendance_status: 'absent' as const, absence_reason: 'suspension' }
  if (input.holiday) return { attendance_status: 'absent' as const, absence_reason: 'holiday' }
  return { attendance_status: 'pending' as const, absence_reason: null }
}
