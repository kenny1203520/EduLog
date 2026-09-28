import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/SessionDetailsView.vue'), 'utf8')

describe('SessionDetails background refresh contract', () => {
    it('keeps the open editor on its own report snapshot while cards receive canonical updates', () => {
        expect(source).toContain('const selectedEditorReportSnapshot = ref<OccurrenceReport | null>(null)')
        expect(source).toContain('v-if="selectedEditorReport"')
        expect(source).toContain(':initial-content="selectedEditorReport?.content"')
        expect(source).toContain('reportMap.value = new Map(reportMap.value).set(enrollmentId, new OccurrenceReport(updatedReport))')
        expect(source).toContain('if (report && report.id === updatedReport.id && report.version > updatedReport.version) return')
    })

    it('uses a read-only report refresh for report events and preserves lesson options', () => {
        expect(source).toContain("options.createMissing === false")
        expect(source).toContain('OccurrenceReportService.getReportsByOccurrence(occurrenceId)')
        expect(source).toContain('await loadReportsForCurrentOccurrence({ createMissing: !options.reportOnly })')
        expect(source).toContain('loadWorkspaceRoster(selectedDate, true)')
        expect(source).toContain('loadMissingLessons: !options.reportOnly')
        expect(source).toContain('let lessonLoadPromises = new Map<string, Promise<Lesson[]>>()')
        expect(source).not.toContain('courseLessonsByCourseId.value = {}')
        expect(source).not.toContain('courseLessons.value = []')
    })

    it('coalesces realtime invalidations into serialized refresh passes without per-save toasts', () => {
        expect(source).toContain('if (realtimeRefreshTimer || realtimeRefreshRunning) return')
        expect(source).toContain('pendingRealtimeInvalidations.splice(0)')
        expect(source).toContain('const reportOnly = relevantEvents.every(payload => payload.change === \'report\')')
        expect(source).toContain('if (pendingRealtimeInvalidations.length && !realtimeRefreshTimer)')
        expect(source).not.toContain("toast.info(t('classroom.live_update_applied'))")
        expect(source).toContain('class="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs"')
    })

    it('saves and closes the old editor before changing the selected occurrence date', () => {
        expect(source).toContain("if (validDate !== selectedDateKey.value && showSplitView.value)")
        expect(source).toContain("saveNow({ reason: 'switch' })")
        expect(source).toContain('selectedEditorReportSnapshot.value = null')
    })
})
