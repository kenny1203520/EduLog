export type PolicyEffect = 'allow' | 'deny'
export type PolicyScope = 'system' | 'classroom' | 'class_session'

export interface RoleDTO {
    id: string
    code?: string | null
    name: string
    description?: string | null
    is_system: boolean
    sort_order: number
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

export interface EffectivePermissionResult {
    effect: PolicyEffect | null
    source: PolicyScope | null
    policy?: RolePermissionPolicyDTO
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
