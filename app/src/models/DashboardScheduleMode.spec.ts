import { describe, expect, it } from 'vitest'
import type { RolePermissionPolicyDTO } from '@/models/Rbac'
import { resolveScheduleMode, scheduleSelectionAt, schedulePolicyOverrides, type DashboardSchedulePolicies } from './DashboardScheduleMode'

const policy = (permission_id: 'all' | 'view', role_id: string, scope_type: RolePermissionPolicyDTO['scope_type'], scope_id: string | null, effect: 'allow' | 'deny'): RolePermissionPolicyDTO =>
    ({ permission_id, role_id, scope_type, scope_id, effect })

function policiesFrom(rows: RolePermissionPolicyDTO[]): DashboardSchedulePolicies {
    return { all: rows.filter(row => row.permission_id === 'all'), view: rows.filter(row => row.permission_id === 'view') }
}

describe('dashboard schedule modes', () => {
    it('round-trips every selection through the two stored permissions', () => {
        const overrides = schedulePolicyOverrides({ a: 'all', b: 'assigned', c: 'hidden', d: 'inherit' })
        expect(overrides.all).toEqual([{ role_id: 'a', effect: 'allow' }, { role_id: 'b', effect: 'deny' }])
        expect(overrides.view).toEqual([{ role_id: 'a', effect: 'allow' }, { role_id: 'b', effect: 'allow' }, { role_id: 'c', effect: 'deny' }])

        const stored = policiesFrom([
            ...overrides.all.map(row => policy('all', row.role_id, 'classroom', 'room', row.effect)),
            ...overrides.view.map(row => policy('view', row.role_id, 'classroom', 'room', row.effect))
        ])
        const scope = { type: 'classroom' as const, id: 'room' }
        expect(['a', 'b', 'c', 'd'].map(role => scheduleSelectionAt(stored, role, scope))).toEqual(['all', 'assigned', 'hidden', 'inherit'])
    })

    it('lets a more specific scope lift a hidden classroom', () => {
        const stored = policiesFrom([
            policy('view', 'r', 'classroom', 'room', 'deny'),
            policy('view', 'r', 'class_session', 'class', 'allow'),
            policy('all', 'r', 'class_session', 'class', 'allow')
        ])
        expect(resolveScheduleMode(stored, 'r', { classroomId: 'room' })).toEqual({ mode: 'hidden', source: 'classroom' })
        expect(resolveScheduleMode(stored, 'r', { classroomId: 'room', classSessionId: 'class' })).toEqual({ mode: 'all', source: 'class_session' })
        expect(resolveScheduleMode(stored, 'other', { classroomId: 'room' })).toEqual({ mode: null, source: null })
    })
})
