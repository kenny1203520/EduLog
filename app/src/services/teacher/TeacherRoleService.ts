import { supabase } from '@/lib/supabase'
import type {
    IncompleteReportNotificationRule,
    NotificationScopeType
} from '@/models/IncompleteReportNotificationPolicy'

export interface TeacherRoleTypeDTO {
    id: string
    code?: string | null
    name: string
    is_system: boolean
    sort_order: number
}

export interface NotificationScope {
    type: NotificationScopeType
    id?: string | null
}

/** Manages teacher role types and incomplete-report recipient settings. */
export class TeacherRoleService {
    static async getRoleTypes(): Promise<TeacherRoleTypeDTO[]> {
        const { data, error } = await supabase
            .from('teacher_role_types')
            .select('*')
            .order('sort_order')
            .order('name')
        if (error) throw new Error(error.message)
        return (data as TeacherRoleTypeDTO[]) || []
    }

    static async createRoleType(name: string): Promise<TeacherRoleTypeDTO> {
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('ROLE_NAME_REQUIRED')
        const { data, error } = await supabase
            .from('teacher_role_types')
            .insert({ name: normalizedName, is_system: false })
            .select()
            .single()
        if (error) throw new Error(error.message)
        return data as TeacherRoleTypeDTO
    }

    static async deleteRoleType(id: string): Promise<void> {
        const { error } = await supabase
            .from('teacher_role_types')
            .delete()
            .eq('id', id)
            .eq('is_system', false)
        if (error) throw new Error(error.message)
    }

    static async getNotificationRules(): Promise<IncompleteReportNotificationRule[]> {
        const { data, error } = await supabase
            .from('incomplete_report_notification_rules')
            .select('*')
        if (error) throw new Error(error.message)
        return (data as IncompleteReportNotificationRule[]) || []
    }

    static async replaceNotificationRoles(scope: NotificationScope, roleTypeIds: string[]): Promise<void> {
        let deleteQuery = supabase
            .from('incomplete_report_notification_rules')
            .delete()
            .eq('scope_type', scope.type)

        if (scope.type === 'classroom') deleteQuery = deleteQuery.eq('classroom_id', scope.id)
        if (scope.type === 'class_session') deleteQuery = deleteQuery.eq('class_session_id', scope.id)

        const { error: deleteError } = await deleteQuery
        if (deleteError) throw new Error(deleteError.message)
        if (roleTypeIds.length === 0) return

        const records = roleTypeIds.map(roleTypeId => ({
            scope_type: scope.type,
            classroom_id: scope.type === 'classroom' ? scope.id : null,
            class_session_id: scope.type === 'class_session' ? scope.id : null,
            role_type_id: roleTypeId
        }))
        const { error } = await supabase.from('incomplete_report_notification_rules').insert(records)
        if (error) throw new Error(error.message)
    }
}
