import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardScheduleVisibilitySettings from './DashboardScheduleVisibilitySettings.vue'

const { canManageRbac, getDashboardSchedulePolicies, saveDashboardScheduleModes, getRoles, toastSuccess } = vi.hoisted(() => ({
    canManageRbac: vi.fn(),
    getDashboardSchedulePolicies: vi.fn(),
    saveDashboardScheduleModes: vi.fn(),
    getRoles: vi.fn(),
    toastSuccess: vi.fn()
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: toastSuccess }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ reportError: vi.fn() }) }))
vi.mock('@/services/rbac/RoleService', () => ({ RoleService: { getRoles } }))
vi.mock('@/services/rbac/PermissionPolicyService', () => ({
    PermissionPolicyService: { canManageRbac, getDashboardSchedulePolicies, saveDashboardScheduleModes }
}))

const global = { mocks: { $t: (key: string) => key } }
// Button order in each role group: inherit, all, assigned, hidden.
const groupButtons = (wrapper: ReturnType<typeof mount>, index: number) => wrapper.findAll('[role="group"]')[index]!.findAll('button')

describe('DashboardScheduleVisibilitySettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        canManageRbac.mockResolvedValue(true)
        getRoles.mockResolvedValue([
            { id: 'manager', code: 'teaching_manager', name: 'Teaching Manager', is_system: true, sort_order: 1 },
            { id: 'teacher', code: 'teacher', name: 'Teacher', is_system: true, sort_order: 2 }
        ])
        getDashboardSchedulePolicies.mockResolvedValue({
            all: [
                { role_id: 'manager', permission_id: 'all', scope_type: 'system', effect: 'allow' },
                { role_id: 'teacher', permission_id: 'all', scope_type: 'classroom', scope_id: 'room-1', effect: 'allow' }
            ],
            view: []
        })
        saveDashboardScheduleModes.mockResolvedValue(undefined)
    })

    it('shows each role\'s system-scope mode with the four schedule choices', async () => {
        const wrapper = mount(DashboardScheduleVisibilitySettings, { global })
        await flushPromises()

        expect(getDashboardSchedulePolicies).toHaveBeenCalled()
        expect(wrapper.text()).toContain('settings.dashboard_schedule.title')
        expect(groupButtons(wrapper, 0).map(button => button.text())).toEqual([
            'settings.dashboard_schedule.inherit',
            'settings.dashboard_schedule.all',
            'settings.dashboard_schedule.assigned',
            'settings.dashboard_schedule.hidden'
        ])
        expect(groupButtons(wrapper, 0)[1]!.attributes('aria-pressed')).toBe('true')
        // A classroom policy does not count as the system-scope selection.
        expect(groupButtons(wrapper, 1)[0]!.attributes('aria-pressed')).toBe('true')
    })

    it('saves the selected modes at system scope', async () => {
        const wrapper = mount(DashboardScheduleVisibilitySettings, { global })
        await flushPromises()

        await groupButtons(wrapper, 1)[3]!.trigger('click')
        await wrapper.findAll('button').find(button => button.text() === 'common.save')!.trigger('click')
        await flushPromises()

        expect(saveDashboardScheduleModes).toHaveBeenCalledWith({ type: 'system', id: null }, { manager: 'all', teacher: 'hidden' }, expect.objectContaining({ all: expect.any(Array), view: [] }))
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
