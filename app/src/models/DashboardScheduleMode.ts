import { PermissionPolicyEvaluator, type PolicyContext, type PolicyEffect, type PolicyScope, type RolePermissionPolicyDTO } from '@/models/Rbac'

/**
 * Today's-schedule mode of one teaching role in one scope. It is stored as two
 * permissions (see 1000147_dashboard_schedule_scoped_visibility.sql):
 *   all      schedule.all = allow, schedule.view = allow
 *   assigned schedule.all = deny,  schedule.view = allow
 *   hidden   schedule.view = deny
 *   inherit  no policy at this scope
 */
export type DashboardScheduleMode = 'all' | 'assigned' | 'hidden'
export type DashboardScheduleSelection = DashboardScheduleMode | 'inherit'
export type DashboardScheduleSelections = Record<string, DashboardScheduleSelection>

export interface DashboardSchedulePolicies {
    all: RolePermissionPolicyDTO[]
    view: RolePermissionPolicyDTO[]
}

export interface DashboardScheduleScope {
    type: PolicyScope
    id?: string | null
}

export interface ResolvedDashboardScheduleMode {
    mode: DashboardScheduleMode | null
    source: PolicyScope | null
}

function atScope(policies: RolePermissionPolicyDTO[], roleId: string, scope: DashboardScheduleScope) {
    return policies.find(policy => policy.role_id === roleId
        && policy.scope_type === scope.type
        && (scope.type === 'system' || policy.scope_id === scope.id))?.effect
}

function modeFromEffects(view: PolicyEffect | null | undefined, all: PolicyEffect | null | undefined): DashboardScheduleMode | null {
    if (view === 'deny') return 'hidden'
    if (all === 'deny') return 'assigned'
    if (all === 'allow') return 'all'
    return null
}

/** The selection stored exactly at `scope` for a role. */
export function scheduleSelectionAt(policies: DashboardSchedulePolicies, roleId: string, scope: DashboardScheduleScope): DashboardScheduleSelection {
    return modeFromEffects(atScope(policies.view, roleId, scope), atScope(policies.all, roleId, scope)) ?? 'inherit'
}

export function scheduleSelectionsAt(policies: DashboardSchedulePolicies, roleIds: string[], scope: DashboardScheduleScope): DashboardScheduleSelections {
    return Object.fromEntries(roleIds.map(roleId => [roleId, scheduleSelectionAt(policies, roleId, scope)]))
}

/** Most specific mode for a role, mirroring resolve_dashboard_schedule_modes. */
export function resolveScheduleMode(policies: DashboardSchedulePolicies, roleId: string, context: PolicyContext = {}): ResolvedDashboardScheduleMode {
    const view = PermissionPolicyEvaluator.resolveRole(policies.view, roleId, context)
    const all = PermissionPolicyEvaluator.resolveRole(policies.all, roleId, context)
    const mode = modeFromEffects(view.effect, all.effect)
    if (!mode) return { mode: null, source: null }
    return { mode, source: mode === 'hidden' ? view.source : all.source }
}

/** Policies to write at one scope for each permission; 'inherit' roles are left out. */
export function schedulePolicyOverrides(selections: DashboardScheduleSelections) {
    const all: Array<{ role_id: string; effect: PolicyEffect }> = []
    const view: Array<{ role_id: string; effect: PolicyEffect }> = []
    for (const [roleId, selection] of Object.entries(selections)) {
        if (selection === 'all' || selection === 'assigned') {
            all.push({ role_id: roleId, effect: selection === 'all' ? 'allow' : 'deny' })
            view.push({ role_id: roleId, effect: 'allow' })
        } else if (selection === 'hidden') {
            view.push({ role_id: roleId, effect: 'deny' })
        }
    }
    return { all, view }
}
