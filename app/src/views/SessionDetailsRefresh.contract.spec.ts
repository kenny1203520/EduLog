import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The class page is split into the view, its composables and its section components.
// The contract covers the page as a whole, so it reads all of them.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const SESSION_DETAILS_FILES = [
    'src/views/SessionDetailsView.vue',
    'src/composables/session/useSessionWorkspace.ts',
    'src/composables/session/useSessionReportEditor.ts',
    'src/composables/session/useSessionRealtime.ts',
    'src/composables/session/useStudentProgress.ts',
    'src/composables/session/useSessionCalendar.ts',
    'src/components/classroom/SessionHeader.vue',
    'src/components/classroom/OccurrenceNavigatorCard.vue',
]
const source = SESSION_DETAILS_FILES.map(read).join('\n')

describe('SessionDetails background refresh contract', () => {
    it('keeps the open editor on its own report snapshot while cards receive canonical updates', () => {
        expect(source).toContain('const selectedEditorReportSnapshot = ref<OccurrenceReport | null>(null)')
        expect(source).toContain('v-if="selectedEditorReport"')
        expect(source).toContain(':initial-content="selectedEditorReport?.content"')
        expect(source).toContain('reportMap.value = new Map(reportMap.value).set(enrollmentId, incomingReport)')
        expect(source).toContain('shouldApplyCommittedReport(incomingReport, report, enrollmentId, occurrenceId)')
    })

    it('uses a read-only report refresh for report events and preserves lesson options', () => {
        expect(source).toContain("options.createMissing === false")
        expect(source).toContain('OccurrenceReportService.getReportsByOccurrence(occurrenceId)')
        expect(source).toContain('await loadReportsForCurrentOccurrence({ createMissing: false })')
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
        expect(source).toContain('<RealtimeStatusBadge')
        // SessionHeader re-emits the badge's retry as retry-realtime.
        expect(source).toContain('@retry="emit(\'retry-realtime\')"')
        expect(source).toContain('@retry-realtime="retryRealtimeAction"')
        // Sessions created from schedule rules have null start_time/end_time.
        expect(source).not.toContain('session.start_time.slice(0, 5)')
        expect(source).toContain('{{ sessionTimeLabel }}')
    })

    it('saves and closes the old editor before changing the selected occurrence date', () => {
        expect(source).toContain("if (validDate !== selectedDateKey.value && showSplitView.value)")
        expect(source).toContain("saveNow({ reason: 'switch' })")
        expect(source).toContain('selectedEditorReportSnapshot.value = null')
    })
})
