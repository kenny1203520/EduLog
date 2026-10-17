import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassroomManagementPanel from './ClassroomManagementPanel.vue'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'
import type { RoleDTO } from '@/models/Rbac'

vi.mock('vue-i18n', async importOriginal => ({
    ...await importOriginal<typeof import('vue-i18n')>(),
    useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('@/services/rbac/PermissionPolicyService', () => ({
    INCOMPLETE_REPORT_PERMISSION: 'reports.incomplete.receive',
    PermissionPolicyService: { replacePolicies: vi.fn(), replaceDashboardScheduleModes: vi.fn(), canManageRbac: vi.fn().mockResolvedValue(true) }
}))

const roles: RoleDTO[] = [{ id: 'teacher', name: 'Teacher', is_system: true, sort_order: 1 }]
const sessions = [
    { id: 'session-a', name: 'Alpha', classroom_id: 'room-1', time_zone: 'Asia/Taipei', session_type: 'regular' as const, schedule_rules: [], course_ids: [], capacity: 10 },
    { id: 'session-b', name: 'Beta', classroom_id: 'room-1', time_zone: 'Asia/Taipei', session_type: 'regular' as const, schedule_rules: [], course_ids: [], capacity: 10 }
]

function createWrapper(initialTab: 'sessions' | 'notifications' = 'sessions') {
    return mount(ClassroomManagementPanel, {
        props: {
            room: { name: 'Room 1' }, roomId: 'room-1', sessions, roles, policies: [],
            roomSelections: { teacher: 'inherit' }, initialTab,
            schedulePolicies: { all: [], view: [] }, roomScheduleSelections: { teacher: 'inherit' }
        },
        global: { mocks: { $t: (key: string) => key } },
        attachTo: document.body
    })
}

describe('ClassroomManagementPanel', () => {
    beforeEach(() => vi.clearAllMocks())

    it('searches child classes and saves an independent class policy', async () => {
        const wrapper = createWrapper()
        await wrapper.get('input[type="search"]').setValue('Beta')
        expect(wrapper.text()).not.toContain('Alpha')
        expect(wrapper.text()).toContain('Beta')

        await wrapper.findAll('article > button')[0].trigger('click')
        const [notificationGroup, scheduleGroup] = wrapper.findAll('[role="group"]')
        await notificationGroup!.findAll('button')[1]!.trigger('click')
        // Schedule choices: inherit, all, assigned, hidden.
        await scheduleGroup!.findAll('button')[3]!.trigger('click')
        const save = wrapper.findAll('button').find(button => button.text().includes('classroom.save_notification_settings'))!
        await save.trigger('click')
        await flushPromises()

        expect(PermissionPolicyService.replacePolicies).toHaveBeenCalledWith(
            'reports.incomplete.receive',
            { type: 'class_session', id: 'session-b' },
            [{ role_id: 'teacher', effect: 'allow' }]
        )
        expect(PermissionPolicyService.replaceDashboardScheduleModes).toHaveBeenCalledWith(
            { type: 'class_session', id: 'session-b' },
            { teacher: 'hidden' }
        )
        wrapper.unmount()
    })

    it('shows report notifications and the today schedule as two sections of the room role settings', async () => {
        const wrapper = createWrapper('notifications')
        await flushPromises()
        expect(wrapper.text()).toContain('settings.incomplete_notifications.title')
        expect(wrapper.text()).toContain('settings.dashboard_schedule.title')

        const scheduleGroup = wrapper.findAll('[role="group"]')[1]!
        await scheduleGroup.findAll('button')[2]!.trigger('click')
        expect(wrapper.emitted('update:roomScheduleSelections')?.at(-1)).toEqual([{ teacher: 'assigned' }])
        wrapper.unmount()
    })

    it('requires save, discard, or cancel before leaving a dirty class policy', async () => {
        const wrapper = createWrapper()
        await wrapper.findAll('article > button')[0].trigger('click')
        await wrapper.findAll('[role="group"] button')[2].trigger('click')
        const close = wrapper.find('header button')
        await close.trigger('click')
        expect(wrapper.text()).toContain('classroom.unsaved_notification_title')

        const discard = wrapper.findAll('button').find(button => button.text().includes('common.discard'))!
        await discard.trigger('click')
        expect(wrapper.emitted('close')).toHaveLength(1)
        wrapper.unmount()
    })
    it('does not send policy mutations for a non-admin user', async () => {
        vi.mocked(PermissionPolicyService.canManageRbac).mockResolvedValue(false)
        const wrapper = createWrapper()
        await flushPromises()
        await wrapper.findAll('article > button')[0].trigger('click')
        const policyButtons = wrapper.findAll('[role="group"] button')
        expect(policyButtons.every(button => button.attributes('disabled') !== undefined)).toBe(true)
        expect(wrapper.findAll('button').some(button => button.text().includes('classroom.save_notification_settings'))).toBe(false)
        expect(PermissionPolicyService.replacePolicies).not.toHaveBeenCalled()
        expect(PermissionPolicyService.replaceDashboardScheduleModes).not.toHaveBeenCalled()
        wrapper.unmount()
    })})
