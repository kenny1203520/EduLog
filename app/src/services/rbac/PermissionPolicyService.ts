import type { PermissionDTO, PolicyEffect, PolicyScope, RolePermissionPolicyDTO } from '@/models/Rbac'
import { AuthorizationError } from '@/services/errors/AppError'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiDataClient } from '@/services/api/ApiDataClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export const INCOMPLETE_REPORT_PERMISSION = 'reports.incomplete.receive'
export interface PolicyScopeTarget { type: PolicyScope; id?: string | null }

export class PermissionPolicyService {
    static async canUpdateOccurrence(classSessionId: string): Promise<boolean> {
        try {
            if (getApiV1Mode() === 'mock') {
                const user = await apiDataClient.auth.getUser()
                if (user.error || !user.data.user) return false
                const result = await apiDataClient.rpc('resolve_user_permission', {
                    p_user_id: user.data.user.id,
                    p_permission_key: 'teaching.occurrences.update',
                    p_class_session_id: classSessionId
                })
                const row = Array.isArray(result.data) ? result.data[0] : result.data
                return !result.error && row?.is_allowed === true && row?.is_denied !== true
            }
            const query = new URLSearchParams({
                permission: 'teaching.occurrences.update',
                class_session_id: classSessionId
            })
            return (await apiV1Client.get<{ allowed: boolean }>(`/rbac/capability?${query.toString()}`)).data?.allowed === true
        } catch {
            return false
        }
    }

    static async canManageRbac(): Promise<boolean> {
        if (getApiV1Mode() === 'mock') {
            const user = await apiDataClient.auth.getUser()
            if (user.error || !user.data.user) return false
            const result = await apiDataClient.rpc('resolve_user_permission', { p_user_id: user.data.user.id, p_permission_key: 'teaching.roles.manage' })
            const row = Array.isArray(result.data) ? result.data[0] : result.data
            return !result.error && row?.is_allowed === true && row?.is_denied !== true
        }
        try {
            const path = `/rbac/capability?permission=${encodeURIComponent('teaching.roles.manage')}`
            return (await apiV1Client.get<{ allowed: boolean }>(path)).data?.allowed === true
        } catch { return false }
    }
    static async getPermission(key: string): Promise<PermissionDTO> {
        const result = await apiResourceClient.list<PermissionDTO>('permissions', { search: key, perPage: 100 })
        const permission = result.data?.find((item) => item.key === key)
        if (!permission) throw new Error('Permission was not found')
        return permission
    }
    static async getPolicies(permissionId: string): Promise<RolePermissionPolicyDTO[]> {
        return (await apiV1Client.get<RolePermissionPolicyDTO[]>(`/permissions/${encodeURIComponent(permissionId)}/policies`)).data || []
    }
    static async replacePolicies(permissionKey: string, scope: PolicyScopeTarget, policies: Array<{ role_id: string; effect: PolicyEffect }>): Promise<void> {
        try {
            if (getApiV1Mode() === 'mock') {
                const result = await apiDataClient.rpc('replace_role_permission_policies', { p_permission_key: permissionKey, p_scope_type: scope.type, p_scope_id: scope.type === 'system' ? null : scope.id, p_policies: policies })
                if (result.error) throw result.error
                return
            }
            const permission = await this.getPermission(permissionKey)
            await apiV1Client.patch(`/permissions/${encodeURIComponent(permission.id)}/policies`, { scope, policies })
        } catch (error) {
            if ((error as any)?.status === 401 || (error as any)?.status === 403 || (error as any)?.code === '42501') throw new AuthorizationError({ message: 'RBAC policy management was denied', cause: error })
            throw error
        }
    }
}
