import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ScopedRolePolicyEditor from './ScopedRolePolicyEditor.vue'
import type { RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const roles: RoleDTO[] = [
    { id: 'teacher', name: 'Teacher', is_system: true, sort_order: 1 },
    { id: 'coach', name: 'Coach', is_system: true, sort_order: 2 }
]
const policies: RolePermissionPolicyDTO[] = [
    { role_id: 'teacher', permission_id: 'permission', scope_type: 'system', effect: 'allow' },
    { role_id: 'coach', permission_id: 'permission', scope_type: 'classroom', scope_id: 'room-1', effect: 'deny' }
]

const global = { mocks: { $t: (key: string) => key }, stubs: {} }

describe('ScopedRolePolicyEditor', () => {
    it('shows inherited results and emits a single role override without mutating other roles', async () => {
        const wrapper = mount(ScopedRolePolicyEditor, {
            props: {
                roles,
                policies,
                scopeType: 'class_session',
                scopeId: 'session-1',
                classroomId: 'room-1',
                classSessionId: 'session-1',
                modelValue: { teacher: 'inherit', coach: 'inherit' }
            },
            global
        })

        expect(wrapper.text()).toContain('settings.incomplete_notifications.allow')
        expect(wrapper.text()).toContain('settings.incomplete_notifications.deny')

        const teacherGroup = wrapper.findAll('[role="group"]')[0]
        await teacherGroup.findAll('button')[2].trigger('click')
        expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({ teacher: 'deny', coach: 'inherit' })
    })

    it('disables all policy controls when the scope cannot be saved', () => {
        const wrapper = mount(ScopedRolePolicyEditor, {
            props: {
                roles,
                policies,
                scopeType: 'classroom',
                modelValue: { teacher: 'inherit', coach: 'inherit' },
                disabled: true
            },
            global
        })
        expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    })
})
