export interface TeacherAttendanceScopeInput {
    teacherId?: string | null
    teacherUserId?: string | null
    occurrenceTeacherIds?: string[] | null
    teacherAttendance?: Record<string, boolean> | null
}

export function isTeacherPresentForScope(input: TeacherAttendanceScopeInput): boolean {
    const teacherKeys = [input.teacherId, input.teacherUserId].filter(Boolean) as string[]
    if (teacherKeys.length === 0) return false

    const occurrenceTeacherIds = input.occurrenceTeacherIds || []
    const isAssigned = teacherKeys.some(key => occurrenceTeacherIds.includes(key))
    if (!isAssigned) return false

    const teacherAttendance = input.teacherAttendance || {}
    const attendanceValues = teacherKeys
        .filter(key => Object.prototype.hasOwnProperty.call(teacherAttendance, key))
        .map(key => teacherAttendance[key])

    if (attendanceValues.some(value => value === false)) return false
    return attendanceValues.some(value => value === true)
}
