export type AttendanceReportStatus = 'present' | 'absent' | 'pending'

const ATTENDANCE_REPORT_STATUSES: ReadonlySet<string> = new Set([
    'present',
    'absent',
    'pending'
])

/** Returns whether a list item represents a report with an attendance status. */
export function isAttendanceReportStatus(status: unknown): status is AttendanceReportStatus {
    return typeof status === 'string' && ATTENDANCE_REPORT_STATUSES.has(status)
}
