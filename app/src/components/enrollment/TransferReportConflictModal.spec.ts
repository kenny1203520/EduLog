import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransferReportConflictModal from './TransferReportConflictModal.vue'
import type { SingleLessonTransferConflict } from '@/services/enrollment/SingleLessonTransferConflictService'
import { copyToClipboard } from '@/utils/clipboard'

vi.mock('vue-i18n', async importOriginal => {
    const actual = await importOriginal<typeof import('vue-i18n')>()
    return {
        ...actual,
    useI18n: () => ({
        t: (key: string) => ({
            'student.transfer_conflict.not_filled': '未填寫',
            'student.transfer_conflict.no_source_report': '原課堂尚無報告，本次調課將保留目標報告。',
            'report.completed': '已完成',
            'report.incomplete': '未完成',
            'report.editor.present': '出席',
            'report.editor.absent': '未出席'
        }[key] || key)
    })
    }
})
vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => ({
        locale: 'zh-TW',
        timeZone: 'Asia/Taipei',
        editorFontScale: 100
    })
}))
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: vi.fn() }))

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
        lesson_id: 'source-lesson-id',
        content: 'source content',
        external_link: '',
        class_participation: 4,
        attendance_status: 'present',
        version: 2
    },
    targetReport: {
        id: 'target-report',
        enrollment_id: 'enrollment-1',
        class_occurrence_id: 'target-occurrence',
        lesson_id: 'target-lesson-id',
        content: 'target content',
        external_link: 'https://target.example/reports/1',
        class_participation: 2,
        attendance_status: 'absent',
        absence_reason: 'family_matter',
        version: 4
    },
    sourceContext: {
        occurrenceId: 'source-occurrence',
        occurrenceDate: '2026-08-03',
        startTime: '10:00:00',
        endTime: '11:00:00',
        sessionId: 'source-session',
        sessionName: '週一進階班',
        sessionTimeZone: 'Asia/Taipei',
        classroomId: 'source-classroom-id',
        classroomName: '101 教室',
        lessonId: 'source-lesson-id',
        lessonSequence: 3,
        lessonTitle: '分數加法'
    },
    targetContext: {
        occurrenceId: 'target-occurrence',
        occurrenceDate: '2026-08-05',
        startTime: '14:00:00',
        endTime: '15:00:00',
        sessionId: 'target-session',
        sessionName: '週三實作班',
        sessionTimeZone: 'Asia/Taipei',
        classroomId: 'target-classroom-id',
        classroomName: '202 教室',
        lessonId: 'target-lesson-id',
        lessonSequence: 4,
        lessonTitle: '分數減法'
    }
}

function mountModal(override: Partial<SingleLessonTransferConflict> = {}) {
    return mount(TransferReportConflictModal, {
        props: { conflict: { ...conflict, ...override } },
        global: {
            stubs: {
                RichTextViewer: { props: ['content'], template: '<div data-testid="rich-text">{{ content }}</div>' }
            }
        }
    })
}

describe('TransferReportConflictModal', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(copyToClipboard).mockResolvedValue(true)
    })

    it('shows readable lesson and class context while keeping UUIDs out of the primary display', () => {
        const wrapper = mountModal()
        const mainClone = wrapper.get('main').element.cloneNode(true) as HTMLElement
        mainClone.querySelector('[data-testid="technical-details"]')?.remove()
        const primaryText = mainClone.textContent || ''

        expect(primaryText).toContain('週一進階班')
        expect(primaryText).toContain('101 教室')
        expect(primaryText).toContain('#3 分數加法')
        expect(primaryText).toContain('#4 分數減法')
        expect(primaryText).not.toContain('source-lesson-id')
        expect(primaryText).not.toContain('source-occurrence')
        expect(wrapper.findAll('[data-testid="rich-text"]')).toHaveLength(2)
        expect(wrapper.text()).toContain('4/5')
    })

    it('defaults populated source fields to overwrite and preserves non-empty target fields', async () => {
        const wrapper = mountModal()
        expect((wrapper.get('input[name="content"][value="source"]').element as HTMLInputElement).checked).toBe(true)
        expect((wrapper.get('input[name="external_link"][value="target"]').element as HTMLInputElement).checked).toBe(true)

        await wrapper.get('footer button:last-child').trigger('click')
        const selections = wrapper.emitted('resolve')?.[0]?.[0] as Record<string, string>
        expect(selections.content).toBe('source')
        expect(selections.external_link).toBe('target')
    })

    it('keeps technical IDs collapsed and supports copying them', async () => {
        const wrapper = mountModal()
        const details = wrapper.get('[data-testid="technical-details"]')
        expect(details.attributes('open')).toBeUndefined()
        expect(details.text()).toContain('source-report')

        await details.find('button').trigger('click')
        expect(copyToClipboard).toHaveBeenCalledWith('source-report')
    })

    it('explains that the target report is preserved when no source report exists', () => {
        const wrapper = mountModal({ sourceReport: null })
        expect(wrapper.get('[data-testid="no-source-report"]').text())
            .toContain('原課堂尚無報告，本次調課將保留目標報告。')
        expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
    })

    it('lets the user preserve every target value or cancel the transfer', async () => {
        const wrapper = mountModal()
        await wrapper.findAll('main > template, main button').filter(button => button.element.tagName === 'BUTTON')[1]!.trigger('click')
        await wrapper.get('footer button:last-child').trigger('click')

        const selections = wrapper.emitted('resolve')?.[0]?.[0] as Record<string, string>
        expect(selections.content).toBe('target')
        expect(selections.external_link).toBe('target')
        await wrapper.get('footer button:first-child').trigger('click')
        expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
})
