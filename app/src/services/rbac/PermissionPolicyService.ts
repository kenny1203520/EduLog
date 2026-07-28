import { supabase } from '@/lib/supabase'
import type { PermissionDTO, PolicyEffect, PolicyScope, RolePermissionPolicyDTO } from '@/models/Rbac'

export const INCOMPLETE_REPORT_PERMISSION = 'reports.incomplete.receive'

export interface PolicyScopeTarget {
    type: PolicyScope
    id?: string | null
}

export class PermissionPolicyService {
    static async getPermission(key: string): Promise<PermissionDTO> {
        const { data, error } = await supabase.from('permissions').select('*').eq('key', key).single()
        if (error) throw new Error(error.message)
        return data as PermissionDTO
    }

    static async getPolicies(permissionId: string): Promise<RolePermissionPolicyDTO[]> {
        const { data, error } = await supabase
            .from('role_permission_policies')
            .select('*')
            .eq('permission_id', permissionId)
        if (error) throw new Error(error.message)
        return (data as RolePermissionPolicyDTO[]) || []
    }

    static async replacePolicies(
        permissionKey: string,
        scope: PolicyScopeTarget,
        policies: Array<{ role_id: string; effect: PolicyEffect }>
    ): Promise<void> {
        const { error } = await supabase.rpc('replace_role_permission_policies', {
            p_permission_key: permissionKey,
            p_scope_type: scope.type,
            p_scope_id: scope.type === 'system' ? null : scope.id,
            p_policies: policies
        })
        if (error) throw new Error(error.message)
    }
}
