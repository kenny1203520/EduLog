export type RosterAttendanceFilter = 'all' | 'present' | 'absent' | 'pending'

export interface RosterEnrollmentLike {
    id?: string
    studentName?: string
}

export interface AttendanceReportLike {
    attendanceStatus?: string | null
}

export function getRosterEnrollments<T extends RosterEnrollmentLike>(
    enrollments: T[],
    reports: Map<string, AttendanceReportLike | null>,
    query: string,
    attendanceFilter: RosterAttendanceFilter
): { all: T[]; filtered: T[] } {
    // Roster membership is independent from report provisioning. A student
    // without a report must remain visible and counts as pending occupancy;
    // report actions can still be disabled by the caller when unavailable.
    const all = enrollments.filter(enrollment => Boolean(enrollment.id))
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const filtered = all.filter(enrollment => {
        if (normalizedQuery && !enrollment.studentName?.toLocaleLowerCase().includes(normalizedQuery)) return false
        const status = reports.get(enrollment.id!)?.attendanceStatus || 'pending'
        return attendanceFilter === 'all' || status === attendanceFilter
    })
    return { all, filtered }
}

export function countRosterAttendance<T extends RosterEnrollmentLike>(
    enrollments: T[],
    reports: Map<string, AttendanceReportLike | null>
) {
    return enrollments.reduce((counts, enrollment) => {
        const status = reports.get(enrollment.id!)?.attendanceStatus || 'pending'
        if (status === 'present') counts.present += 1
        else if (status === 'absent') counts.absent += 1
        else counts.pending += 1
        return counts
    }, { present: 0, pending: 0, absent: 0 })
}
