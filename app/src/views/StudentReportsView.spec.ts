import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import StudentReportsView from './StudentReportsView.vue'

const source = readFileSync(resolve(process.cwd(), 'src/views/StudentReportsView.vue'), 'utf8')
const panel = vi.hoisted(() => ({ value: false }))
vi.mock('@/composables/useExtensionPanel', () => ({ inExtensionPanel: () => panel.value, extensionPanelOrigin: () => null }))

vi.mock('vue-router', () => ({
    useRoute: () => ({ params: {}, query: {} }),
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

vi.mock('@/services/api/ApiDataClient', () => ({
    apiDataClient: {
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

    it('keeps the calendar on the selected report month and wraps class metadata', () => {
        expect(source).toContain(':model-value="selectedOccurrence?.occurrenceDate || null"')
        expect(source).toContain('grid-cols-1 gap-4 text-sm text-gray-600 sm:grid-cols-2')
        expect(source).toContain('break-words whitespace-normal font-medium text-gray-800')
        expect(source).not.toContain('font-medium truncate')
    })

    it('adds effective transfer targets without reports and excludes every active source', () => {
        expect(source).toContain('getEffectiveSingleLessonTransferTargets(enrollmentId)')
        expect(source).toContain('.filter(target => target.is_effective_target)')
        expect(source).toContain('target.is_effective_target && target.source_occurrence_id === occ.id')
        expect(source).toContain('isMissingTransferredOccurrence(occurrence.id)')
        expect(source).toContain('repairSingleLessonTransferReport')
    })

    it('never lets a failed or forbidden transfer-target lookup blank out the report list', () => {
        // getEffectiveSingleLessonTransferTargets is enrichment only (it overlays
        // active single-lesson transfers on the schedule); a RPC failure --
        // notably SINGLE_LESSON_TRANSFER_FORBIDDEN on an enrollment with no
        // transfer rows -- must never abort the whole occurrence load, since that
        // used to leave occurrences.value permanently empty while the incomplete-
        // reports banner (which reads allReports directly) still showed entries.
        const loadOccurrencesBody = source.slice(
            source.indexOf('async function loadOccurrences()'),
            source.indexOf('async function selectOccurrence(')
        )
        expect(loadOccurrencesBody).toContain('effectiveTransferTargets.value = await EnrollmentService.getEffectiveSingleLessonTransferTargets(enrollmentId)')
        expect(loadOccurrencesBody).toContain('effectiveTransferTargets.value = []')
        expect(loadOccurrencesBody).toContain("loadError.value = t('report.list_load_error')")
        // The transfer-targets call must be wrapped in its own try/catch, isolated
        // from the outer function-level catch that used to blank the whole list.
        const transferTargetsCallIndex = loadOccurrencesBody.indexOf(
            'effectiveTransferTargets.value = await EnrollmentService.getEffectiveSingleLessonTransferTargets(enrollmentId)'
        )
        const innerTryIndex = loadOccurrencesBody.lastIndexOf('try {', transferTargetsCallIndex)
        const innerCatchIndex = loadOccurrencesBody.indexOf('} catch (transferTargetsError) {', transferTargetsCallIndex)
        expect(innerTryIndex).toBeGreaterThanOrEqual(0)
        expect(innerCatchIndex).toBeGreaterThan(transferTargetsCallIndex)
    })

    it('shows every fetched report even when its occurrence is missing from the merged schedule', () => {
        // allReportDisplay used to be built by mapping occurrences.value only, so
        // any report whose class_occurrence_id had no matching entry there (e.g.
        // because occurrences.value was incomplete) was silently dropped even
        // though it existed in allReports.value.
        const allReportDisplayBody = source.slice(
            source.indexOf('const allReportDisplay = computed(() => {'),
            source.indexOf('const existingReportIds = computed(() => {')
        )
        expect(allReportDisplayBody).toContain('mergedOccurrenceIds.has(r.class_occurrence_id)')
        expect(allReportDisplayBody).toContain('const orphanReports = allReports.value')
        expect(allReportDisplayBody).toContain('[...mergedList, ...orphanReports]')
    })

    it('in the extension side panel shows only the lesson switcher and the editor area', async () => {
        panel.value = true
        try {
            const wrapper = mount(StudentReportsView, {
                global: {
                    mocks: { $t: (key: string) => key },
                    stubs: { OccurrenceCalendar: true, ReportEditor: true, ConflictModal: true, ConfirmModal: true, KodingCodeCheckModal: true, EnrollmentHistoryPanel: true, PanelOccurrenceBar: true }
                }
            })
            await flushPromises()
            expect(wrapper.find('panel-occurrence-bar-stub').exists()).toBe(true)
            expect(wrapper.findAll('button').some(button => button.text().includes('common.list'))).toBe(false)
            expect(wrapper.findAll('button').some(button => button.text().includes('common.back'))).toBe(false)
            expect(wrapper.find('occurrence-calendar-stub').exists()).toBe(false)
            expect(wrapper.classes()).toContain('p-3')
            wrapper.unmount()
        } finally { panel.value = false }
    })

    it('in the side panel opens scrolled to the editor, keeps 回填 at the bottom and passes compact to the editor', () => {
        expect(source).toContain("watch(() => [loading.value, selectedReport.value?.id] as const")
        expect(source).toContain("editorAnchor.value?.scrollIntoView?.({ block: 'start'")
        expect(source).toContain('v-if="sourceFillAvailable && panel" data-testid="source-fill"')
        expect(source).toContain('sticky bottom-0')
        expect(source).toContain(':show-manual-save="!panel" :compact="panel"')
        // The occurrence info card and the source history stay out of the panel.
        expect(source).toContain('<EnrollmentHistoryPanel v-if="route.params.enrollmentId && !panel"')
    })

    it('guards the historical class_session lookup against a missing joined session', () => {
        // ReportQueryService.getReportsWithDetails did not select class_session.id,
        // so occData.class_session.id was always undefined, and would throw a
        // TypeError (into the same swallow-all catch) if class_session were ever
        // null for a historical occurrence.
        expect(source).toContain('class_session_id: occData.class_session?.id')
    })
})
