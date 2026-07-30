import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import StudentReportsView from './StudentReportsView.vue'

vi.mock('vue-router', () => ({
    useRoute: () => ({ params: {} }),
    useRouter: () => ({ back: vi.fn() })
}))

vi.mock('vue-i18n', () => ({
    createI18n: () => ({
        global: {
            locale: { value: 'en' },
            t: (key: string) => key
        }
    }),
    useI18n: () => ({
        locale: { value: 'en' },
        t: (key: string) => key
    })
}))

vi.mock('vue-toastification', () => ({
    useToast: () => ({
        success: vi.fn(),
        error: vi.fn()
    })
}))

vi.mock('@/stores/useAuthStore', () => ({
    useAuthStore: () => ({ user: null })
}))

vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => ({
        locale: 'en',
        timeZone: 'UTC'
    })
}))

vi.mock('@/lib/supabase', () => ({
    supabase: {
        channel: vi.fn(),
        removeChannel: vi.fn()
    }
}))

describe('StudentReportsView scheduled report filter', () => {
    it('is enabled by default and can be toggled off and on', async () => {
        const wrapper = mount(StudentReportsView, {
            global: {
                mocks: {
                    $t: (key: string) => key
                },
                stubs: {
                    OccurrenceCalendar: true,
                    ReportEditor: true,
                    ConflictModal: true,
                    ConfirmModal: true,
                    KodingCodeCheckModal: true
                }
            }
        })
        await flushPromises()

        const listButton = wrapper.findAll('button').find(button => button.text().includes('common.list'))
        expect(listButton).toBeDefined()
        await listButton!.trigger('click')
        await flushPromises()

        const filterButton = wrapper.find('button[aria-pressed]')
        expect(filterButton.attributes('aria-pressed')).toBe('true')

        await filterButton.trigger('click')
        expect(filterButton.attributes('aria-pressed')).toBe('false')

        await filterButton.trigger('click')
        expect(filterButton.attributes('aria-pressed')).toBe('true')
    })
})
