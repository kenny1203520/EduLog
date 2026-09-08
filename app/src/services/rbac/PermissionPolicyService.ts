import { supabase } from '@/lib/supabase'
import type { PermissionDTO, PolicyEffect, PolicyScope, RolePermissionPolicyDTO } from '@/models/Rbac'
import { AuthorizationError } from '@/services/errors/AppError'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

export const INCOMPLETE_REPORT_PERMISSION = 'reports.incomplete.receive'
export const RBAC_MANAGE_PERMISSION = 'rbac.manage'

export interface PolicyScopeTarget {
    type: PolicyScope
    id?: string | null
}

export class PermissionPolicyService {
    static async canManageRbac(): Promise<boolean> {
        try {
            if (getApiV1Mode() === 'v1') {
                const response = await apiV1Client.get<{ allowed: boolean }>(`/rbac/capability?permission=${encodeURIComponent(RBAC_MANAGE_PERMISSION)}`)
                return response.data?.allowed === true
            }
            const { data: userResult, error: userError } = await supabase.auth.getUser()
            if (userError || !userResult.user) return false

            const { data, error } = await supabase.rpc('resolve_user_permission', {
                p_user_id: userResult.user.id,
                p_permission_key: RBAC_MANAGE_PERMISSION,
                p_classroom_id: null,
                p_class_session_id: null
            })
            if (error) {
                console.warn('Unable to resolve RBAC management capability; keeping policy controls read-only.', {
                    code: error.code || 'permission_check_failed'
                })
                return false
            }

            const result = Array.isArray(data) ? data[0] : data
            return Boolean(result?.is_allowed && !result?.is_denied)
        } catch {
            console.warn('Unable to resolve RBAC management capability; keeping policy controls read-only.')
            return false
        }
    }

    static async getPermission(key: string): Promise<PermissionDTO> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiResourceClient.list<PermissionDTO>('permissions', { search: key, perPage: 100, mode: 'v1' })
            const permission = result.data?.find((item) => item.key === key)
            if (!permission) throw new Error('Permission was not found')
            return permission
        }
        const { data, error } = await supabase.from('permissions').select('*').eq('key', key).single()
        if (error) throw new Error(error.message)
        return data as PermissionDTO
    }

    static async getPolicies(permissionId: string): Promise<RolePermissionPolicyDTO[]> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiV1Client.get<RolePermissionPolicyDTO[]>(`/permissions/${encodeURIComponent(permissionId)}/policies`)
            return result.data || []
        }
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
        if (getApiV1Mode() === 'v1') {
            const permission = await this.getPermission(permissionKey)
            await apiV1Client.patch(`/permissions/${encodeURIComponent(permission.id)}/policies`, { scope, policies })
            return
        }
        const { error } = await supabase.rpc('replace_role_permission_policies', {
            p_permission_key: permissionKey,
            p_scope_type: scope.type,
            p_scope_id: scope.type === 'system' ? null : scope.id,
            p_policies: policies
        })
        if (error) {
            if (error.code === '42501' || (error as any).status === 401 || (error as any).status === 403) {
                throw new AuthorizationError({
                    message: 'RBAC policy management was denied',
                    cause: error
                })
            }
            throw new Error(error.message)
        }
    }
}
