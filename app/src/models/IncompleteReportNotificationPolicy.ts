export type NotificationScopeType = 'global' | 'classroom' | 'class_session'

export interface IncompleteReportNotificationRule {
    id?: string
    scope_type: NotificationScopeType
    classroom_id?: string | null
    class_session_id?: string | null
    role_type_id: string
}

/** Resolves notification recipients using class session, classroom, then global precedence. */
export class IncompleteReportNotificationPolicy {
    static resolveRoleIds(
        rules: IncompleteReportNotificationRule[],
        classroomId?: string | null,
        classSessionId?: string | null
    ): string[] {
        const sessionRoles = classSessionId
            ? rules.filter(rule => rule.scope_type === 'class_session' && rule.class_session_id === classSessionId)
            : []
        if (sessionRoles.length > 0) return this.uniqueRoleIds(sessionRoles)

        const classroomRoles = classroomId
            ? rules.filter(rule => rule.scope_type === 'classroom' && rule.classroom_id === classroomId)
            : []
        if (classroomRoles.length > 0) return this.uniqueRoleIds(classroomRoles)

        return this.uniqueRoleIds(rules.filter(rule => rule.scope_type === 'global'))
    }

    private static uniqueRoleIds(rules: IncompleteReportNotificationRule[]): string[] {
        return [...new Set(rules.map(rule => rule.role_type_id))]
    }
}
