import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardScheduleVisibilitySettings from './DashboardScheduleVisibilitySettings.vue'

const { canManageRbac, getPermission, getPolicies, replacePolicies, getRoles, toastSuccess } = vi.hoisted(() => ({
    canManageRbac: vi.fn(),
    getPermission: vi.fn(),
    getPolicies: vi.fn(),
    replacePolicies: vi.fn(),
    getRoles: vi.fn(),
    toastSuccess: vi.fn()
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: toastSuccess }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ reportError: vi.fn() }) }))
vi.mock('@/services/rbac/RoleService', () => ({ RoleService: { getRoles } }))
vi.mock('@/services/rbac/PermissionPolicyService', () => ({
    DASHBOARD_SCHEDULE_ALL_PERMISSION: 'teaching.dashboard.schedule.all',
    PermissionPolicyService: { canManageRbac, getPermission, getPolicies, replacePolicies }
}))

const global = { mocks: { $t: (key: string) => key } }

describe('DashboardScheduleVisibilitySettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        canManageRbac.mockResolvedValue(true)
        getRoles.mockResolvedValue([
            { id: 'manager', code: 'teaching_manager', name: 'Teaching Manager', is_system: true, sort_order: 1 },
            { id: 'teacher', code: 'teacher', name: 'Teacher', is_system: true, sort_order: 2 }
        ])
        getPermission.mockResolvedValue({ id: 'perm-1', key: 'teaching.dashboard.schedule.all' })
        getPolicies.mockResolvedValue([
            { role_id: 'manager', permission_id: 'perm-1', scope_type: 'system', effect: 'allow' },
            { role_id: 'teacher', permission_id: 'perm-1', scope_type: 'classroom', scope_id: 'room-1', effect: 'allow' }
        ])
        replacePolicies.mockResolvedValue(undefined)
    })

    it('loads system-scope policies for the dashboard schedule permission with dashboard labels', async () => {
        const wrapper = mount(DashboardScheduleVisibilitySettings, { global })
        await flushPromises()

        expect(getPermission).toHaveBeenCalledWith('teaching.dashboard.schedule.all')
        expect(getPolicies).toHaveBeenCalledWith('perm-1')
        expect(wrapper.text()).toContain('settings.dashboard_schedule.title')
        expect(wrapper.text()).toContain('settings.dashboard_schedule.allow')
        expect(wrapper.text()).not.toContain('settings.incomplete_notifications')
        const managerButtons = wrapper.findAll('[role="group"]')[0]!.findAll('button')
        expect(managerButtons[1]!.attributes('aria-pressed')).toBe('true')
    })

    it('saves only explicit overrides at system scope', async () => {
        const wrapper = mount(DashboardScheduleVisibilitySettings, { global })
        await flushPromises()

        await wrapper.findAll('[role="group"]')[1]!.findAll('button')[2]!.trigger('click')
        const save = wrapper.findAll('button').find(button => button.text() === 'common.save')!
        await save.trigger('click')
        await flushPromises()

        expect(replacePolicies).toHaveBeenCalledWith(
            'teaching.dashboard.schedule.all',
            { type: 'system', id: null },
            [{ role_id: 'manager', effect: 'allow' }, { role_id: 'teacher', effect: 'deny' }]
        )
        expect(toastSuccess).toHaveBeenCalledWith('settings.dashboard_schedule.saved')
    })

    it('is read-only without RBAC management permission', async () => {
        canManageRbac.mockResolvedValue(false)
        const wrapper = mount(DashboardScheduleVisibilitySettings, { global })
        await flushPromises()

        expect(wrapper.text()).toContain('errors.permission_required_for_settings')
        expect(wrapper.findAll('button').some(button => button.text() === 'common.save')).toBe(false)
        expect(wrapper.findAll('[role="group"] button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    })
})
