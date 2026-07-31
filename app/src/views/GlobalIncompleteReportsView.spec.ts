import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import GlobalIncompleteReportsView from '@/views/GlobalIncompleteReportsView.vue'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'

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

vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: vi.fn()
    }
}))

vi.mock('@/services/occurrence/OccurrenceReportService', () => ({
    OccurrenceReportService: {
        getGlobalIncompleteReports: vi.fn()
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
        vi.mocked(OccurrenceReportService.getGlobalIncompleteReports).mockResolvedValue([])
    })
    it('always loads the policy-aware notification scope and renders no scope checkbox', async () => {
        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()

        expect(OccurrenceReportService.getGlobalIncompleteReports).toHaveBeenCalledWith('my_notifications')
        expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
        expect(OccurrenceReportService.getGlobalIncompleteReports).not.toHaveBeenCalledWith('all')
        expect(OccurrenceReportService.getGlobalIncompleteReports).not.toHaveBeenCalledWith('my_present')
    })

    it('keeps every view load path fixed to my_notifications', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/views/GlobalIncompleteReportsView.vue'), 'utf8')
        expect(source).toContain("getGlobalIncompleteReports('my_notifications')")
        expect(source).not.toContain('onlyMyPresentStudents')
        expect(source).not.toContain("getGlobalIncompleteReports('all')")
    })

    it('clears notification data when the policy-aware endpoint fails', async () => {
        vi.mocked(OccurrenceReportService.getGlobalIncompleteReports)
            .mockResolvedValueOnce([{ id: 'report-1', studentName: 'Student', className: 'Class' }])
            .mockRejectedValueOnce(new Error('policy endpoint unavailable'))

        const wrapper = mount(GlobalIncompleteReportsView, { global: globalOptions })
        await flushPromises()
        expect(wrapper.text()).toContain('Student')

        await (wrapper.vm as any).loadReports(false)
        await flushPromises()

        expect(wrapper.text()).not.toContain('Student')
        expect(OccurrenceReportService.getGlobalIncompleteReports).not.toHaveBeenCalledWith('my_present')
        expect(OccurrenceReportService.getGlobalIncompleteReports).not.toHaveBeenCalledWith('all')
    })
})
