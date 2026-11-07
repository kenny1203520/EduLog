import type { PermissionDTO, PolicyEffect, PolicyScope, RolePermissionPolicyDTO } from '@/models/Rbac'
import { schedulePolicyOverrides, type DashboardSchedulePolicies, type DashboardScheduleSelections } from '@/models/DashboardScheduleMode'
import { AuthorizationError } from '@/services/errors/AppError'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export const INCOMPLETE_REPORT_PERMISSION = 'reports.incomplete.receive'
export const DASHBOARD_SCHEDULE_ALL_PERMISSION = 'teaching.dashboard.schedule.all'
export const DASHBOARD_SCHEDULE_VIEW_PERMISSION = 'teaching.dashboard.schedule.view'
export interface PolicyScopeTarget { type: PolicyScope; id?: string | null }

export class PermissionPolicyService {
    static async canUpdateOccurrence(classSessionId: string): Promise<boolean> {
        try {
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
        return this.hasPermission('teaching.roles.manage')
    }

    /** Whether the signed-in user holds `permissionKey` at system scope. */
    static async hasPermission(permissionKey: string): Promise<boolean> {
        try {
            const path = `/rbac/capability?permission=${encodeURIComponent(permissionKey)}`
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
            const permission = await this.getPermission(permissionKey)
            await apiV1Client.patch(`/permissions/${encodeURIComponent(permission.id)}/policies`, { scope, policies })
        } catch (error) {
            if ((error as any)?.status === 401 || (error as any)?.status === 403 || (error as any)?.code === '42501') throw new AuthorizationError({ message: 'RBAC policy management was denied', cause: error })
            throw error
        }
    }

    /** Both permissions behind the four-state today's-schedule mode. */
    static async getDashboardSchedulePolicies(): Promise<DashboardSchedulePolicies> {
        const [allPermission, viewPermission] = await Promise.all([
            this.getPermission(DASHBOARD_SCHEDULE_ALL_PERMISSION),
            this.getPermission(DASHBOARD_SCHEDULE_VIEW_PERMISSION)
        ])
        const [all, view] = await Promise.all([this.getPolicies(allPermission.id), this.getPolicies(viewPermission.id)])
        return { all, view }
    }
    static async replaceDashboardScheduleModes(scope: PolicyScopeTarget, selections: DashboardScheduleSelections): Promise<void> {
        const overrides = schedulePolicyOverrides(selections)
        await this.replacePolicies(DASHBOARD_SCHEDULE_VIEW_PERMISSION, scope, overrides.view)
        await this.replacePolicies(DASHBOARD_SCHEDULE_ALL_PERMISSION, scope, overrides.all)
    }
}
