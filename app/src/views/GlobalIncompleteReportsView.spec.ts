import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('GlobalIncompleteReportsView scope filter', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(OccurrenceReportService.getGlobalIncompleteReports).mockResolvedValue([])
    })

    it('loads my present students by default and can switch to all reports', async () => {
        const wrapper = mount(GlobalIncompleteReportsView, {
            global: globalOptions
        })
        await flushPromises()

        expect(OccurrenceReportService.getGlobalIncompleteReports).toHaveBeenLastCalledWith('my_present')

        await wrapper.find('input[type="checkbox"]').setValue(false)
        await flushPromises()

        expect(OccurrenceReportService.getGlobalIncompleteReports).toHaveBeenLastCalledWith('all')

        await wrapper.find('input[type="checkbox"]').setValue(true)
        await flushPromises()

        expect(OccurrenceReportService.getGlobalIncompleteReports).toHaveBeenLastCalledWith('my_present')
    })
})
