import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/SessionDetailsView.vue'), 'utf8')

describe('SessionDetails responsive and loading contract', () => {
    it('renders retry state separately from the initialized classroom content', () => {
        expect(source).toContain('v-if="occurrenceLoadError"')
        expect(source).toContain('@click="loadData"')
        expect(source).toContain('v-else class="session-workspace__grid grid')
    })

    it('uses actual adjacent occurrence navigation and disables boundaries', () => {
        expect(source).toContain("moveOccurrence('previous')")
        expect(source).toContain("moveOccurrence('next')")
        expect(source).toContain(':disabled="!previousOccurrence || isOccurrenceLoading"')
        expect(source).toContain(':disabled="!nextOccurrence || isOccurrenceLoading"')
        expect(source).not.toContain('moveWeek(')
    })

    it('keeps the session identity, metadata and display controls responsive', () => {
        expect(source).toContain('flex min-w-0 flex-col gap-4 xl:flex-row')
        expect(source).toContain('grid-cols-[minmax(0,1fr)_auto]')
        expect(source).toContain('grid-cols-[auto_minmax(0,1fr)]')
        expect(source).toContain('[overflow-wrap:anywhere]')
        expect(source).toContain('sm:max-w-md xl:w-[22rem]')
        expect(source).toContain("t('classroom.session_time_zone')")
        expect(source).toContain("t('common.display_time_zone')")
        expect(source).not.toContain('<div class="w-56">')
    })

    it('uses the available class-page width to switch to a usable split view', () => {
        expect(source).toContain('container-name: session-workspace')
        expect(source).toContain('@container session-workspace (min-width: 1100px)')
        expect(source).toContain('grid-template-columns: minmax(520px, 1fr) minmax(480px, 560px)')
        expect(source).toContain('max-height: calc(100dvh - 6rem)')
        expect(source).toContain("'session-workspace__grid--editing': showSplitView")
        expect(source).toContain("'session-workspace__class-column--editing': showSplitView")
        expect(source).not.toContain('xl:grid-cols-[minmax(560px,1fr)_minmax(420px,560px)]')
        expect(source).not.toContain("'hidden xl:block': showSplitView")
        expect(source).not.toContain("window.matchMedia('(max-width: 1279px)')")
    })

    it('returns to the edited student after every successful editor close', () => {
        expect(source).toContain('const enrollmentIdToRestore = selectedEnrollmentId.value')
        expect(source).toContain('await nextTick()')
        expect(source).toContain('if (enrollmentIdToRestore) scrollToEnrollment(enrollmentIdToRestore)')
        expect(source).toContain("target?.scrollIntoView({ behavior: 'smooth', block: 'center' })")
        expect(source).toContain('await closeSplitView()')
        expect(source).not.toContain('classViewScrollY')
        expect(source).not.toContain('window.scrollTo(')
    })

    it('uses occupied attendance for capacity while keeping roster totals separate', () => {
        expect(source).toContain('const occupiedRosterCount = computed(() => attendanceCounts.value.present + attendanceCounts.value.pending)')
        expect(source).toContain('(occupiedRosterCount / (session?.capacity || 1))')
        expect(source).toContain('{{ allRosterEnrollments.length }}')
    })

    it('applies attendance save results only to their active occurrence and report version', () => {
        expect(source).toContain('const request = ++reportLoadRequest')
        expect(source).toContain('request !== reportLoadRequest || todayOccurrence.value?.id !== occurrenceId')
        expect(source).toContain('if (!result.success || !result.updatedReport)')
        expect(source).toContain('shouldApplyCommittedReport(updatedReport, current, enrId, occurrenceId)')
    })
})
