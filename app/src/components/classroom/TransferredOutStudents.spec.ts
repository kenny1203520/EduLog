import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TransferredOutStudents from './TransferredOutStudents.vue'
import type { OccurrenceLessonTransfer } from '@/services/enrollment/EnrollmentTransferQueryService'

vi.mock('vue-i18n', async importOriginal => ({
    ...await importOriginal<typeof import('vue-i18n')>(),
    useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key}:${JSON.stringify(params)}` : key }),
}))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ locale: 'zh-TW' }) }))

const transfer: OccurrenceLessonTransfer = {
    direction: 'out',
    transfer_id: 'transfer-1',
    enrollment_id: 'enrollment-1',
    student_name: '李同學',
    other_occurrence_id: 'occurrence-62',
    other_occurrence_date: '2026-10-03',
    other_start_time: '13:30:00',
    other_end_time: '15:30:00',
    other_session_id: 'session-62',
    other_session_name: '樹林菁英週六',
    other_classroom_name: '樹林',
    can_cancel: true
}

describe('TransferredOutStudents', () => {
    it('describes where the student was transferred and offers cancel', async () => {
        const wrapper = mount(TransferredOutStudents, { props: { transfers: [transfer] } })

        expect(wrapper.text()).toContain('李同學')
        expect(wrapper.text()).toContain('"date":"2026/10/03(六)"')
        expect(wrapper.text()).toContain('"session":"樹林菁英週六"')
        expect(wrapper.text()).toContain('"time":"13:30–15:30"')

        const buttons = wrapper.findAll('button')
        await buttons[1]!.trigger('click')
        expect(wrapper.emitted('cancel')?.[0]).toEqual([transfer])
        await buttons[0]!.trigger('click')
        expect(wrapper.emitted('open')?.[0]).toEqual([transfer])
    })

    it('hides the cancel action when the user may not cancel', () => {
        const wrapper = mount(TransferredOutStudents, { props: { transfers: [{ ...transfer, can_cancel: false }] } })
        expect(wrapper.findAll('button')).toHaveLength(1)
    })

    it('renders nothing without outgoing transfers', () => {
        const wrapper = mount(TransferredOutStudents, { props: { transfers: [] } })
        expect(wrapper.find('section').exists()).toBe(false)
    })
})
