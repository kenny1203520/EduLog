import { describe, expect, it } from 'vitest'
import { PermissionPolicyEvaluator, type RolePermissionPolicyDTO } from './Rbac'

const permissionId = 'reports.incomplete.receive'
const policies: RolePermissionPolicyDTO[] = [
    { role_id: 'teacher', permission_id: permissionId, scope_type: 'system', effect: 'allow' },
    { role_id: 'teacher', permission_id: permissionId, scope_type: 'classroom', scope_id: 'room-1', effect: 'deny' },
    { role_id: 'teacher', permission_id: permissionId, scope_type: 'class_session', scope_id: 'class-1', effect: 'allow' },
    { role_id: 'coach', permission_id: permissionId, scope_type: 'system', effect: 'deny' }
]

describe('PermissionPolicyEvaluator', () => {
    it('inherits the system policy when no more specific policy exists', () => {
        expect(PermissionPolicyEvaluator.resolveRole(policies, 'teacher', { classroomId: 'room-2' }))
            .toMatchObject({ effect: 'allow', source: 'system' })
    })

    it('uses classroom deny instead of the system allow', () => {
        expect(PermissionPolicyEvaluator.resolveRole(policies, 'teacher', { classroomId: 'room-1' }))
            .toMatchObject({ effect: 'deny', source: 'classroom' })
    })

    it('uses the class allow instead of its classroom deny', () => {
        expect(PermissionPolicyEvaluator.resolveRole(policies, 'teacher', {
            classroomId: 'room-1', classSessionId: 'class-1'
        })).toMatchObject({ effect: 'allow', source: 'class_session' })
    })

    it('restores inheritance when a local override is cleared', () => {
        const cleared = policies.filter(policy => policy.scope_type !== 'class_session')
        expect(PermissionPolicyEvaluator.resolveRole(cleared, 'teacher', {
            classroomId: 'room-1', classSessionId: 'class-1'
        })).toMatchObject({ effect: 'deny', source: 'classroom' })
    })

    it('gives an explicit deny priority across multiple roles', () => {
        const result = PermissionPolicyEvaluator.resolveUser([
            PermissionPolicyEvaluator.resolveRole(policies, 'teacher'),
            PermissionPolicyEvaluator.resolveRole(policies, 'coach')
        ])
        expect(result).toEqual({ allowed: false, denied: true })
    })
})
