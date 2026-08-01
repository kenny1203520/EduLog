import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import TransferReportConflictModal from './TransferReportConflictModal.vue'
import type { SingleLessonTransferConflict } from '@/services/enrollment/SingleLessonTransferConflictService'

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key: string) => key })
}))

const conflict: SingleLessonTransferConflict = {
    enrollmentId: 'enrollment-1',
    sourceOccurrenceId: 'source-occurrence',
    targetOccurrenceId: 'target-occurrence',
    sourceSessionId: 'source-session',
    targetSessionId: 'target-session',
    sourceReport: {
        id: 'source-report',
        enrollment_id: 'enrollment-1',
        class_occurrence_id: 'source-occurrence',
        content: 'source content',
        external_link: '',
        version: 2
    },
    targetReport: {
        id: 'target-report',
        enrollment_id: 'enrollment-1',
        class_occurrence_id: 'target-occurrence',
        content: 'target content',
        external_link: 'https://target.example',
        version: 4
    }
}

describe('TransferReportConflictModal', () => {
    it('defaults populated source fields to overwrite and preserves non-empty target fields', async () => {
        const wrapper = mount(TransferReportConflictModal, { props: { conflict } })

        const contentSource = wrapper.get('input[name="content"][value="source"]')
        const externalTarget = wrapper.get('input[name="external_link"][value="target"]')
        expect((contentSource.element as HTMLInputElement).checked).toBe(true)
        expect((externalTarget.element as HTMLInputElement).checked).toBe(true)

        await wrapper.get('footer button:last-child').trigger('click')
        const selections = wrapper.emitted('resolve')?.[0]?.[0] as Record<string, string>
        expect(selections.content).toBe('source')
        expect(selections.external_link).toBe('target')
    })

    it('lets the user preserve every target value or cancel the transfer', async () => {
        const wrapper = mount(TransferReportConflictModal, { props: { conflict } })
        await wrapper.findAll('main button')[1]!.trigger('click')
        await wrapper.get('footer button:last-child').trigger('click')

        const selections = wrapper.emitted('resolve')?.[0]?.[0] as Record<string, string>
        expect(selections.content).toBe('target')
        expect(selections.external_link).toBe('target')

        await wrapper.get('footer button:first-child').trigger('click')
        expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
})
