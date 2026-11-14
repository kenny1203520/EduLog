import type { PermissionDTO, PolicyEffect, PolicyScope, RolePermissionPolicyDTO } from '@/models/Rbac'
import { schedulePolicyOverrides, type DashboardSchedulePolicies, type DashboardScheduleSelections } from '@/models/DashboardScheduleMode'
import { AuthorizationError, ConflictError } from '@/services/errors/AppError'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export const INCOMPLETE_REPORT_PERMISSION = 'reports.incomplete.receive'
export const DASHBOARD_SCHEDULE_ALL_PERMISSION = 'teaching.dashboard.schedule.all'
export const DASHBOARD_SCHEDULE_VIEW_PERMISSION = 'teaching.dashboard.schedule.view'
export interface PolicyScopeTarget { type: PolicyScope; id?: string | null }

/** A local policy row of one permission, tagged with its key. */
export type KeyedPolicy = RolePermissionPolicyDTO & { permission_key: string }

/** Every scope's local policies of some permissions, read at one RBAC epoch. */
export interface PolicySnapshot {
    epoch: number
    permissionIds: Record<string, string>
    policies: KeyedPolicy[]
}

/** Desired local effect of one role for one permission at the save scope; null means inherit. */
export interface PolicyChange { role_id: string; permission_key: string; effect: PolicyEffect | null }

/** Selection of a role in a permission editor. */
export type PolicySelectionValue = PolicyEffect | 'inherit'

const MAX_SAVE_ATTEMPTS = 3

function isScope(policy: RolePermissionPolicyDTO, scope: PolicyScopeTarget) {
    return policy.scope_type === scope.type && (scope.type === 'system' || policy.scope_id === scope.id)
}

function effectAt(policies: KeyedPolicy[], change: Pick<PolicyChange, 'role_id' | 'permission_key'>, scope: PolicyScopeTarget): PolicyEffect | null {
    return policies.find(policy => policy.role_id === change.role_id
        && policy.permission_key === change.permission_key
        && isScope(policy, scope))?.effect ?? null
}

function errorCode(error: unknown) {
    return (error as { code?: string } | null)?.code
}

function toPublicError(error: unknown): unknown {
    const status = (error as { status?: number } | null)?.status
    const code = errorCode(error)
    if (status === 401 || status === 403 || code === '42501') return new AuthorizationError({ message: 'RBAC policy management was denied', cause: error })
    if (code === 'RBAC_VERSION_CONFLICT') return new ConflictError({ message: 'RBAC policies changed while saving', cause: error })
    return error
}

export class PermissionPolicyService {
    static async canManageSessionTeachers(classSessionId: string): Promise<boolean> {
        const results = await Promise.all([
            this.canInSession('teaching.class_sessions.update', classSessionId),
            this.canInSession('teaching.roles.manage', classSessionId),
        ])
        return results.every(Boolean)
    }

    static async canUpdateOccurrence(classSessionId: string): Promise<boolean> {
        return this.canInSession('teaching.occurrences.update', classSessionId)
    }

    private static async canInSession(permission: string, classSessionId: string): Promise<boolean> {
        try {
            const query = new URLSearchParams({
                permission,
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

    /** Local policies of `permissionKeys` in every scope, with the epoch they were read at. */
    static async getPolicySnapshot(permissionKeys: string[]): Promise<PolicySnapshot> {
        const query = new URLSearchParams()
        for (const key of permissionKeys) query.append('permission_key', key)
        const response = await apiV1Client.get<KeyedPolicy[]>(`/roles/permission-policies?${query.toString()}`)
        const meta = response.meta ?? {}
        const permissions = (meta.permissions ?? []) as Array<{ id: string; key: string }>
        return {
            epoch: Number(meta.epoch),
            permissionIds: Object.fromEntries(permissions.map(permission => [permission.key, permission.id])),
            policies: response.data ?? []
        }
    }

    /** Local policies of one permission in every scope. */
    static async getPolicies(permissionKey: string): Promise<KeyedPolicy[]> {
        return (await this.getPolicySnapshot([permissionKey])).policies
    }

    /** Both permissions behind the four-state today's-schedule mode. */
    static async getDashboardSchedulePolicies(): Promise<DashboardSchedulePolicies> {
        const snapshot = await this.getPolicySnapshot([DASHBOARD_SCHEDULE_ALL_PERMISSION, DASHBOARD_SCHEDULE_VIEW_PERMISSION])
        return {
            all: snapshot.policies.filter(policy => policy.permission_key === DASHBOARD_SCHEDULE_ALL_PERMISSION),
            view: snapshot.policies.filter(policy => policy.permission_key === DASHBOARD_SCHEDULE_VIEW_PERMISSION)
        }
    }

    /** Changes that set one permission's selection for each role. */
    static selectionChanges(permissionKey: string, selections: Record<string, PolicySelectionValue>): PolicyChange[] {
        return Object.entries(selections).map(([role_id, selection]) => ({
            role_id,
            permission_key: permissionKey,
            effect: selection === 'allow' || selection === 'deny' ? selection : null
        }))
    }

    /** Changes that set each role's today's-schedule mode. */
    static scheduleModeChanges(selections: DashboardScheduleSelections): PolicyChange[] {
        const overrides = schedulePolicyOverrides(selections)
        return Object.keys(selections).flatMap(role_id => [
            { role_id, permission_key: DASHBOARD_SCHEDULE_VIEW_PERMISSION, effect: overrides.view.find(item => item.role_id === role_id)?.effect ?? null },
            { role_id, permission_key: DASHBOARD_SCHEDULE_ALL_PERMISSION, effect: overrides.all.find(item => item.role_id === role_id)?.effect ?? null }
        ])
    }

    /** The schedule policies as keyed rows, for use as a save baseline. */
    static scheduleBaseline(policies: DashboardSchedulePolicies): KeyedPolicy[] {
        return [
            ...policies.all.map(policy => ({ ...policy, permission_key: DASHBOARD_SCHEDULE_ALL_PERMISSION })),
            ...policies.view.map(policy => ({ ...policy, permission_key: DASHBOARD_SCHEDULE_VIEW_PERMISSION }))
        ]
    }

    /** Saves each role's today's-schedule mode at `scope`. */
    static async saveDashboardScheduleModes(scope: PolicyScopeTarget, selections: DashboardScheduleSelections, baseline: DashboardSchedulePolicies): Promise<void> {
        await this.applyPolicyChanges(scope, this.scheduleModeChanges(selections), this.scheduleBaseline(baseline))
    }

    /**
     * Saves `changes` at `scope` through PATCH /roles/:id/permissions, one
     * request per role, passing each response's epoch to the next request.
     *
     * Only cells that differ from `baseline` (the policies the editor showed)
     * are sent, so roles and permissions the user did not touch are left as
     * they are. When the epoch is stale the latest policies are read again:
     * if another user changed one of the edited cells the save stops with a
     * ConflictError, otherwise it retries with the new epoch.
     */
    static async applyPolicyChanges(scope: PolicyScopeTarget, changes: PolicyChange[], baseline: KeyedPolicy[]): Promise<void> {
        const target = { type: scope.type, id: scope.type === 'system' ? null : scope.id ?? null }
        const pending = changes.filter(change => effectAt(baseline, change, target) !== change.effect)
        if (!pending.length) return
        const keys = [...new Set(pending.map(change => change.permission_key))]
        try {
            for (let attempt = 1; ; attempt++) {
                const latest = await this.getPolicySnapshot(keys)
                const remaining = pending.filter(change => effectAt(latest.policies, change, target) !== change.effect)
                if (remaining.some(change => effectAt(latest.policies, change, target) !== effectAt(baseline, change, target))) {
                    throw new ConflictError({ message: 'Another user changed the same RBAC policy' })
                }
                try {
                    await this.patchRoles(target, remaining, latest)
                    return
                } catch (error) {
                    if (errorCode(error) !== 'RBAC_VERSION_CONFLICT' || attempt >= MAX_SAVE_ATTEMPTS) throw error
                }
            }
        } catch (error) {
            throw toPublicError(error)
        }
    }

    private static async patchRoles(scope: PolicyScopeTarget, changes: PolicyChange[], snapshot: PolicySnapshot) {
        const byRole = new Map<string, PolicyChange[]>()
        for (const change of changes) byRole.set(change.role_id, [...byRole.get(change.role_id) ?? [], change])
        let epoch = snapshot.epoch
        for (const [roleId, roleChanges] of byRole) {
            const response = await apiV1Client.patch<{ epoch: number }>(`/roles/${encodeURIComponent(roleId)}/permissions`, {
                scope_type: scope.type,
                scope_id: scope.id ?? null,
                expected_epoch: epoch,
                changes: roleChanges.map(change => {
                    const permissionId = snapshot.permissionIds[change.permission_key]
                    if (!permissionId) throw new Error(`Permission was not found: ${change.permission_key}`)
                    return { permission_id: permissionId, effect: change.effect }
                })
            })
            epoch = Number(response.data.epoch)
        }
    }
}
