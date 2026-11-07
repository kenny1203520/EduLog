import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { OccurrenceReport, type OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { Enrollment } from '@/models/Enrollment'

const reports = vi.hoisted(() => ({ getReport: vi.fn(), resolveConflict: vi.fn() }))
vi.mock('@/services/occurrence/OccurrenceReportService', () => ({ OccurrenceReportService: reports }))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn() }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ reportError: vi.fn() }) }))
vi.mock('@/stores/useAuthStore', () => ({ useAuthStore: () => ({ user: { id: 'user' } }) }))

import { reportProgressChanged, useSessionReportEditor, type ReportEditorExpose } from './useSessionReportEditor'

const dto = (overrides: Partial<OccurrenceReportDTO> = {}) => ({
    id: 'report',
    enrollment_id: 'e1',
    class_occurrence_id: 'occ',
    version: 1,
    attendance_status: 'pending',
    is_completed: false,
    ...overrides,
}) as OccurrenceReportDTO

describe('session report editor', () => {
    let scope: ReturnType<typeof effectScope>
    const enrollment = { id: 'e1', courseId: 'course', studentName: 'Amy' } as Enrollment
    const todayOccurrence = ref<any>(null)
    const selectedDateKey = ref<string | null>('2026-11-07')
    const reportMap = ref(new Map<string, any>())
    const savingMap = ref(new Map<string, boolean>())
    const editor = ref<ReportEditorExpose | null>(null)
    const getLessonsForCourse = vi.fn()
    const onProgressChanged = vi.fn()

    beforeEach(() => {
        vi.resetAllMocks()
        scope = effectScope()
        todayOccurrence.value = { id: 'occ', occurrenceDate: new Date(2026, 10, 7) }
        selectedDateKey.value = '2026-11-07'
        reportMap.value = new Map([['e1', new OccurrenceReport(dto())]])
        editor.value = null
        getLessonsForCourse.mockResolvedValue([{ id: 'lesson' }])
    })
    afterEach(() => scope.stop())

    const setup = () => scope.run(() => useSessionReportEditor({
        todayOccurrence,
        selectedDateKey,
        enrollments: ref([enrollment]),
        rosterEnrollments: ref([enrollment]),
        reportMap,
        quickReportEditorRef: editor,
        savingMap,
        getLessonsForCourse,
        onProgressChanged,
    }))!

    it('opens the editor on the newest persisted report version', async () => {
        reports.getReport.mockResolvedValue(new OccurrenceReport(dto({ version: 3 })))
        const state = setup()
        await state.toggleSplitView('e1')

        expect(state.showSplitView.value).toBe(true)
        expect(state.selectedEditorReport.value?.version).toBe(3)
        expect(reportMap.value.get('e1').version).toBe(3)
        expect(state.courseLessons.value).toEqual([{ id: 'lesson' }])
        expect(savingMap.value.has('e1')).toBe(false)
    })

    it('does not open when the date changed while the report was loading', async () => {
        let finish: (value: OccurrenceReport) => void = () => {}
        reports.getReport.mockImplementation(() => new Promise(resolve => { finish = resolve }))
        const state = setup()
        const opening = state.toggleSplitView('e1')
        await vi.waitFor(() => expect(reports.getReport).toHaveBeenCalled())
        selectedDateKey.value = '2026-11-14'
        finish(new OccurrenceReport(dto({ version: 2 })))
        await opening

        expect(state.showSplitView.value).toBe(false)
    })

    it('stays on the current student when the open editor fails to save', async () => {
        reports.getReport.mockResolvedValue(new OccurrenceReport(dto()))
        const state = setup()
        await state.toggleSplitView('e1')
        editor.value = { saveNow: vi.fn().mockResolvedValue(false), replaceWithCanonicalReport: vi.fn() }

        await state.closeSplitView()
        expect(state.showSplitView.value).toBe(true)
        expect(state.selectedEnrollmentId.value).toBe('e1')
    })

    it('updates the card with a committed save and reports progress changes', async () => {
        reports.getReport.mockResolvedValue(new OccurrenceReport(dto()))
        const state = setup()
        await state.toggleSplitView('e1')

        state.handleSaveSuccess(dto({ version: 2, is_completed: true }), 'e1')
        expect(reportMap.value.get('e1').version).toBe(2)
        expect(onProgressChanged).toHaveBeenCalledWith('e1', todayOccurrence.value)
        // The editor keeps its own snapshot.
        expect(state.selectedEditorReport.value?.version).toBe(1)
    })

    it('detects progress-relevant changes', () => {
        const previous = new OccurrenceReport(dto({ lesson_id: 'l1', progress_letter: 'A' }))
        expect(reportProgressChanged(previous, dto({ lesson_id: 'l1', progress_letter: 'A' }))).toBe(false)
        expect(reportProgressChanged(previous, dto({ lesson_id: 'l2', progress_letter: 'A' }))).toBe(true)
        expect(reportProgressChanged(null, dto())).toBe(true)
    })
})
