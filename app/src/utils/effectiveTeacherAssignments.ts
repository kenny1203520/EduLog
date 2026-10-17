import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'

/** Active assignments for a class date, with one row per teacher. When legacy
 * overlapping ranges exist, the latest effective assignment determines the role. */
export function getEffectiveTeacherAssignments(
    assignments: SessionTeacherAssignmentDTO[],
    date: string
): SessionTeacherAssignmentDTO[] {
    const byTeacher = new Map<string, SessionTeacherAssignmentDTO>()
    const activeAssignments = assignments
        .filter(assignment => date >= assignment.effective_from && (!assignment.effective_to || date <= assignment.effective_to))
        .sort((left, right) => right.effective_from.localeCompare(left.effective_from))
    for (const assignment of activeAssignments) {
        if (!assignment.id) continue
        if (!byTeacher.has(assignment.id)) byTeacher.set(assignment.id, assignment)
    }
    return [...byTeacher.values()]
}
