import type { ClassSessionDTO } from './ClassSession'

export interface SessionEligibilityCriteria {
    courseId: string
    classroomId?: string | null
    excludeSessionId?: string | null
}

/**
 * Centralizes which class sessions can be selected for an enrollment.
 */
export class SessionEligibilityPolicy {
    static supportsCourse(session: ClassSessionDTO, courseId: string): boolean {
        return Boolean(courseId) && (session.course_ids || []).includes(courseId)
    }

    static isEligible(session: ClassSessionDTO, criteria: SessionEligibilityCriteria): boolean {
        if (!this.supportsCourse(session, criteria.courseId)) return false
        if (criteria.classroomId && session.classroom_id !== criteria.classroomId) return false
        if (criteria.excludeSessionId && session.id === criteria.excludeSessionId) return false
        return true
    }

    static filter(
        sessions: ClassSessionDTO[],
        criteria: SessionEligibilityCriteria
    ): ClassSessionDTO[] {
        return sessions.filter(session => this.isEligible(session, criteria))
    }

    static classroomIds(sessions: ClassSessionDTO[], courseId: string): Set<string> {
        return new Set(
            sessions
                .filter(session => this.supportsCourse(session, courseId))
                .map(session => session.classroom_id)
                .filter((id): id is string => Boolean(id))
        )
    }
}
