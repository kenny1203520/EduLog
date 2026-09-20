import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import GlobalIncompleteReportsView from '@/views/GlobalIncompleteReportsView.vue'
import { ReportQueryService } from '@/services/report/ReportQueryService'

vi.mock('vue-i18n', () => ({
    createI18n: () => ({
        global: {
            locale: { value: 'zh-TW' },
            t: (key: string) => key
        }
    }),
    useI18n: () => ({
        locale: { value: 'zh-TW' },
        t: (key: string) => key
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
        vi.mocked(ReportQueryService.getGlobalIncompleteReportsPage).mockResolvedValue({ data: [], meta: { total: 0 }, request_id: 'r', trace_id: 't' })
    })
    it('always loads the policy-aware notification scope and renders no scope checkbox', async () => {
        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        expect(ReportQueryService.getGlobalIncompleteReportsPage).toHaveBeenCalledWith('my_notifications', expect.objectContaining({ limit: 25, offset: 0, sort: '-date' }))
        expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('all', expect.anything())
        expect(ReportQueryService.getGlobalIncompleteReportsPage).not.toHaveBeenCalledWith('my_present', expect.anything())
    })

    it('keeps every view load path fixed to my_notifications', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/views/GlobalIncompleteReportsView.vue'), 'utf8')
        expect(source).toContain("getGlobalIncompleteReportsPage('my_notifications'")
        expect(source).not.toContain('onlyMyPresentStudents')
        expect(source).not.toContain("getGlobalIncompleteReportsPage('all'")
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
})
