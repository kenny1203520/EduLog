export type PolicyEffect = 'allow' | 'deny'
export type RbacDomain = 'system' | 'teaching'
export type PolicyScope = 'system' | 'classroom' | 'class_session'

/**
 * Permission keys of the AI report assistant. `generate` (teaching domain) is
 * allowed for teachers by default; `manage` and `logsViewAll` are system
 * permissions for AI settings and the site-wide generation log.
 */
export const AI_PERMISSIONS = {
    generate: 'teaching.ai.generate',
    manage: 'system.ai.manage',
    logsViewAll: 'system.ai.logs.view_all',
} as const

export type AiPermission = typeof AI_PERMISSIONS[keyof typeof AI_PERMISSIONS]

export interface RoleDTO {
    id: string
    code?: string | null
    name: string
    description?: string | null
    is_system: boolean
    sort_order: number
    domain?: RbacDomain
    teaching_id?: string | null
    is_builtin?: boolean
    is_protected?: boolean
    parent_role_id?: string | null
    created_at?: string
    updated_at?: string | null
}

export interface PermissionDTO {
    id: string
    key: string
    name: string
    description?: string | null
}

export interface RolePermissionPolicyDTO {
    id?: string
    role_id: string
    permission_id: string
    scope_type: PolicyScope
    scope_id?: string | null
    effect: PolicyEffect
}

/** Row returned by the canonical role-permission read model. */
export interface RolePermissionMatrixRow {
    permission_id: string
    permission_key: string
    resource: string
    action: string
    local_effect: PolicyEffect | null
    inherited_effect: PolicyEffect | null
    inherited_from_role_id?: string | null
    inherited_from_scope_type?: PolicyScope | null
    effective_effect: PolicyEffect | null
    denied: boolean
    epoch?: number
}

export interface EffectivePermissionResult {
    effect: PolicyEffect | null
    source: PolicyScope | null
    policy?: RolePermissionPolicyDTO
}

export interface RbacCapabilities {
    system?: Record<string, boolean>
    teaching?: Record<string, boolean>
    [key: string]: unknown
}

export interface SettingsOverview {
    preferences: { time_zone?: string | null; editor_settings?: Record<string, unknown> | null } | null
    capabilities: RbacCapabilities
    tabs: { personal: boolean; system: boolean }
    sections: Record<string, Record<string, boolean>>
}

export interface PolicyContext {
    classroomId?: string | null
    classSessionId?: string | null
}

/** Pure scoped-policy evaluator shared by settings UI and tests. */
export class PermissionPolicyEvaluator {
    static resolveRole(
        policies: RolePermissionPolicyDTO[],
        roleId: string,
        context: PolicyContext = {}
    ): EffectivePermissionResult {
        const candidates: Array<{ scope: PolicyScope; id?: string | null }> = [
            { scope: 'class_session', id: context.classSessionId },
            { scope: 'classroom', id: context.classroomId },
            { scope: 'system', id: null }
        ]

        for (const candidate of candidates) {
            if (candidate.scope !== 'system' && !candidate.id) continue
            const policy = policies.find(item => item.role_id === roleId
                && item.scope_type === candidate.scope
                && (candidate.scope === 'system' || item.scope_id === candidate.id))
            if (policy) return { effect: policy.effect, source: candidate.scope, policy }
        }

        return { effect: null, source: null }
    }

    static resolveUser(results: EffectivePermissionResult[]): { allowed: boolean; denied: boolean } {
        const denied = results.some(result => result.effect === 'deny')
        return { denied, allowed: !denied && results.some(result => result.effect === 'allow') }
    }
}
