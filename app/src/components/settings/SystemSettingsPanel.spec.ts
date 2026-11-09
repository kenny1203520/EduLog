import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ errorKey: vi.fn(), reportError: vi.fn(), success: vi.fn() }) }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ locale: 'zh-TW', timeZone: 'Asia/Taipei' }) }))
const getRoles = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('@/services/rbac/RoleService', () => ({ RoleService: { getRoles, getCapabilities: vi.fn().mockResolvedValue({ epoch: 1 }) } }))
vi.mock('@/services/rbac/RoleAssignmentService', () => ({ RoleAssignmentService: { listSystemAssignments: vi.fn().mockResolvedValue({ data: [], total: 0 }) } }))

import SystemSettingsPanel from './SystemSettingsPanel.vue'

const stubs = {
    RolePermissionEditor: true, TeachingRolePermissionsPanel: true, PlatformTeachingRoleAssignmentsPanel: true,
    AuditLogPanel: true, AiAdminPanel: true, IncompleteReportNotificationSettings: true,
    DashboardScheduleVisibilitySettings: true, SearchableSelect: true, Pagination: true, AccountApprovalPanel: true,
}

function sectionLabels(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('nav button').map(button => button.text())
}

describe('SystemSettingsPanel sections', () => {
    it('shows a teaching-role manager only the teaching sections and skips system role loading', async () => {
        getRoles.mockClear()
        const wrapper = mount(SystemSettingsPanel, {
            props: { sections: { teaching: { roles: true, permissions: true }, system: {} } },
            global: { stubs, mocks: { $t: (key: string) => key } },
        })
        await flushPromises()
        expect(sectionLabels(wrapper)).toEqual([
            'rbac.system_sections.teaching_permissions',
            'rbac.system_sections.teaching_assignments',
            'rbac.system_sections.notifications',
            'rbac.system_sections.dashboard_schedule',
        ])
        expect(wrapper.findComponent({ name: 'TeachingRolePermissionsPanel' }).exists()).toBe(true)
        expect(getRoles).not.toHaveBeenCalled()
    })

    it('shows every section to a system owner', async () => {
        const wrapper = mount(SystemSettingsPanel, {
            props: { sections: { teaching: { roles: true, permissions: true }, system: { is_owner: true, ai_manage: true } } },
            global: { stubs, mocks: { $t: (key: string) => key } },
        })
        await flushPromises()
        expect(sectionLabels(wrapper)).toHaveLength(10)
    })
})
