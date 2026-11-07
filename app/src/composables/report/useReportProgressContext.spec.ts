import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { Lesson } from '@/models/Course'

const reports = vi.hoisted(() => ({ getEnrollmentReportProgressContext: vi.fn() }))
vi.mock('@/services/report/ReportQueryService', () => ({ ReportQueryService: reports }))
vi.mock('@/services/report/ReportCommandService', () => ({ ReportCommandService: reports }))
vi.mock('vue-i18n', async importOriginal => ({
    ...(await importOriginal<typeof import('vue-i18n')>()),
    useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }),
}))

import { useReportProgressContext } from './useReportProgressContext'

const lessons = [
    { id: 'l1', sequence: 1, title: 'Intro' },
    { id: 'l2', sequence: 2, title: 'Loops' },
    { id: 'l3', sequence: 3, title: 'Lists' },
] as Lesson[]

describe('report progress context', () => {
    let scope: ReturnType<typeof effectScope>
    const reportId = ref<string | undefined>('report')
    const selectedLessonId = ref('l3')

    beforeEach(() => {
        vi.resetAllMocks()
        scope = effectScope()
        reportId.value = 'report'
        selectedLessonId.value = 'l3'
    })
    afterEach(() => scope.stop())

    const setup = () => scope.run(() => useReportProgressContext({
        enrollmentId: () => 'enrollment',
        classOccurrenceId: () => 'occurrence',
        reportId: () => reportId.value,
        availableLessons: () => lessons,
        selectedLessonId,
    }))!

    it('lists skipped lessons and the previous report', async () => {
        reports.getEnrollmentReportProgressContext.mockResolvedValue({
            reports: [{ lesson_id: 'l1' }],
            latest_prior_report: { id: 'prior', lesson_id: 'l1', progress_letter: 'C', is_completed: true },
        })
        const progress = setup()
        await vi.waitFor(() => expect(progress.progressContextLoading.value).toBe(false))

        expect(progress.progressGaps.value.map(lesson => lesson.id)).toEqual(['l2'])
        expect(progress.previousProgressReport.value?.lesson.title).toBe('Intro')
        expect(progress.focusPreviousProgressReport()).toBe(true)
        expect(progress.focusedProgressReport.value).toEqual({ id: 'prior', lesson: lessons[0] })
        expect(progress.progressSummary.value).toContain('report.editor.progress_check.summary_gaps')
    })

    it('shows the error state and ignores a stale response', async () => {
        let resolveFirst: (value: unknown) => void = () => {}
        reports.getEnrollmentReportProgressContext
            .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
            .mockRejectedValueOnce(new Error('offline'))
        const progress = setup()
        reportId.value = 'other'
        await nextTick()
        await vi.waitFor(() => expect(progress.progressContextError.value).toBe(true))
        resolveFirst({ reports: [], latest_prior_report: null })
        await nextTick()

        expect(progress.progressContextError.value).toBe(true)
        expect(progress.progressSummary.value).toBe('report.editor.progress_check.load_error')
    })

    it('does nothing without a report', async () => {
        reportId.value = undefined
        const progress = setup()
        await nextTick()
        expect(reports.getEnrollmentReportProgressContext).not.toHaveBeenCalled()
        expect(progress.focusPreviousProgressReport()).toBe(false)
    })
})
