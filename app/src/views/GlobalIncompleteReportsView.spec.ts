import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import GlobalIncompleteReportsView from '@/views/GlobalIncompleteReportsView.vue'
import { ReportQueryService } from '@/services/report/ReportQueryService'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'

const { routeQuery, routerReplace } = vi.hoisted(() => ({
    routeQuery: {} as Record<string, string>,
    routerReplace: vi.fn()
}))

vi.mock('vue-router', () => ({
    useRoute: () => ({ query: routeQuery }),
    useRouter: () => ({ replace: routerReplace })
}))

vi.mock('@/services/rbac/PermissionPolicyService', () => ({
    PermissionPolicyService: {
        hasPermission: vi.fn()
    }
}))

vi.mock('vue-i18n', () => ({
    createI18n: () => ({
        global: {
            locale: { value: 'zh-TW' },
            t: (key: string) => key
        }
    }),
    useI18n: () => ({
        locale: { value: 'zh-TW' },
        t: (key: string) => key,
        te: () => false
    })
}))

vi.mock('vue-toastification', () => ({
    useToast: () => ({
        success: vi.fn(),
        error: vi.fn()
    })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => ({
        locale: 'zh-TW',
        timeZone: 'Asia/Taipei'
    })
}))

vi.mock('@/services/api/ApiDataClient', () => ({
    apiDataClient: {
        from: vi.fn()
    }
}))

vi.mock('@/services/report/ReportQueryService', () => ({
    ReportQueryService: {
        getGlobalIncompleteReportsPage: vi.fn()
    }
}))

const globalOptions = {
    mocks: {
        $t: (key: string) => key
    },
    stubs: {
        BasePageHeader: {
            template: '<div><slot name="icon" /><slot name="actions" /><slot /></div>'
        },
        ConfirmModal: true,
        ReportEditor: true,
        RouterLink: true
    }
}

describe('GlobalIncompleteReportsView notification scope', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        for (const key of Object.keys(routeQuery)) delete routeQuery[key]
        vi.mocked(PermissionPolicyService.hasPermission).mockResolvedValue(false)
        vi.mocked(ReportQueryService.getGlobalIncompleteReportsPage).mockResolvedValue({ data: [], meta: { total: 0 }, request_id: 'r', trace_id: 't' })
    })
    it('defaults to the policy-aware notification scope and hides the switch without teaching.reports.list', async () => {
        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenCalledWith('my_notifications', expect.objectContaining({ limit: 25, offset: 0, sort: '-date' }))
        expect(PermissionPolicyService.hasPermission).toHaveBeenCalledWith('teaching.reports.list')
        expect(wrapper.find('[data-testid="incomplete-scope-switch"]').exists()).toBe(false)
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('all', expect.anything())
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('my_present', expect.anything())
    })

    it('switches to the all scope from page one and records it in the URL', async () => {
        vi.mocked(PermissionPolicyService.hasPermission).mockResolvedValue(true)
        vi.mocked(ReportQueryService.getGlobalIncompleteReportsPage)
            .mockResolvedValue({ data: [], meta: { total: 30 }, request_id: 'r', trace_id: 't' })
        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()
        ;(wrapper.vm as any).goToPage(1)
        await flushPromises()
        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenLastCalledWith('my_notifications', expect.objectContaining({ offset: 25 }))

        await wrapper.find('[data-scope="all"]').trigger('click')
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenLastCalledWith('all', expect.objectContaining({ limit: 25, offset: 0 }))
        expect(routerReplace).toHaveBeenLastCalledWith({ query: { scope: 'all' } })

        await wrapper.find('[data-scope="my_notifications"]').trigger('click')
        await flushPromises()
        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenLastCalledWith('my_notifications', expect.objectContaining({ offset: 0 }))
        expect(routerReplace).toHaveBeenLastCalledWith({ query: { scope: undefined } })
    })

    it('restores ?scope=all on refresh when permitted', async () => {
        routeQuery.scope = 'all'
        vi.mocked(PermissionPolicyService.hasPermission).mockResolvedValue(true)
        mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenCalledTimes(1)
        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenCalledWith('all', expect.objectContaining({ offset: 0 }))
    })

    it('falls back to my_notifications for ?scope=all without teaching.reports.list', async () => {
        routeQuery.scope = 'all'
        mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenCalledWith('my_notifications', expect.anything())
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('all', expect.anything())
        expect(routerReplace).toHaveBeenCalledWith({ query: { scope: undefined } })
    })

    it('never queries the attended-teacher scope', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/views/GlobalIncompleteReportsView.vue'), 'utf8')
        expect(source).toContain("route.query.scope === 'all' ? 'all' : 'my_notifications'")
        expect(source).not.toContain('onlyMyPresentStudents')
        expect(source).not.toContain('my_present')
    })

    it('clears notification data when the policy-aware endpoint fails', async () => {
        vi.mocked(ReportQueryService.getGlobalIncompleteReportsPage)
            .mockResolvedValueOnce({ data: [{ id: 'report-1', studentName: 'Student', className: 'Class' }], meta: { total: 1 }, request_id: 'r', trace_id: 't' })
            .mockRejectedValueOnce(new Error('policy endpoint unavailable'))

        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()
        expect(wrapper.text()).toContain('Student')

        await (wrapper.vm as any).loadReports(false)
        await flushPromises()

        expect(wrapper.text()).not.toContain('Student')
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('my_present', expect.anything())
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('all', expect.anything())
    })

    it('uses the server total and preserves page parameters for subsequent loads', async () => {
        vi.mocked(ReportQueryService.getGlobalIncompleteReportsPage)
            .mockResolvedValueOnce({
                data: [],
                meta: { limit: 25, offset: 0, total: 26, sort: '-date' },
                request_id: 'r',
                trace_id: 't'
            })
            .mockResolvedValueOnce({
                data: [],
                meta: { limit: 25, offset: 25, total: 26, sort: '-date' },
                request_id: 'r2',
                trace_id: 't2'
            })

        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        ;(wrapper.vm as any).goToPage(1)
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenLastCalledWith('my_notifications', expect.objectContaining({
            limit: 25,
            offset: 25,
            sort: '-date'
        }))
    })
})
