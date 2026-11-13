import { computed, ref, type Ref } from 'vue'
import { calendarGridRange, withoutRange, type CalendarDateRange } from '@/models/ClassCalendarDay'
import { countJoinFlagsByDate, type RosterFlag } from '@/models/ClassTimeline'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/dateUtils'
import { EnrollmentTransferQueryService } from '@/services/enrollment/EnrollmentTransferQueryService'
import { OccurrenceQueryService } from '@/services/occurrence/OccurrenceQueryService'

interface SessionCalendarSource {
    sessionId: string
    selectedDateKey: Ref<string | null>
    reportError: (error: unknown) => void
}

/**
 * The class's occurrences, loaded one month grid at a time, plus the
 * report-completion dots and roster join flags the calendar shows for them.
 */
export function useSessionCalendar(source: SessionCalendarSource) {
    const { sessionId, selectedDateKey } = source

    const sessionOccurrences = ref<ClassOccurrence[]>([])
    const reportCompletionByDate = ref<Record<string, { total: number; completed: number }>>({})
    const rosterFlagsByDate = ref<Record<string, RosterFlag[]>>({})
    const joinFlagsByDate = computed(() => countJoinFlagsByDate(Object.values(rosterFlagsByDate.value).flat()))
    // The month grid the calendar shows; occurrences load per grid, not per year.
    const visibleCalendarRange = ref<CalendarDateRange | null>(null)
    const failedCompletionRanges = ref<Record<string, boolean>>({})
    const rangeKey = (range: CalendarDateRange) => `${range.start}|${range.end}`
    const completionFailed = computed(() => Boolean(visibleCalendarRange.value && failedCompletionRanges.value[rangeKey(visibleCalendarRange.value)]))
    let completionSequence = 0
    const completionRequests = new Map<string, number>()
    const loadedOccurrenceRanges = new Map<string, Promise<void>>()

    function findOccurrenceByDate(date: Date): ClassOccurrence | undefined {
        const target = DateUtils.formatLocalDate(date)
        return sessionOccurrences.value.find(occ => DateUtils.formatLocalDate(occ.occurrenceDate) === target)
    }

    async function loadReportCompletion(range: CalendarDateRange) {
        const key = rangeKey(range)
        const request = ++completionSequence
        completionRequests.set(key, request)
        try {
            const completion = await OccurrenceQueryService.getReportCompletionByDate(sessionId, range.start, range.end)
            if (completionRequests.get(key) !== request) return
            reportCompletionByDate.value = { ...withoutRange(reportCompletionByDate.value, range), ...completion }
            delete failedCompletionRanges.value[key]
        } catch (error) {
            if (completionRequests.get(key) !== request) return
            failedCompletionRanges.value[key] = true
            reportCompletionByDate.value = withoutRange(reportCompletionByDate.value, range)
            console.error('Failed to load report completion:', error)
        } finally {
            if (completionRequests.get(key) === request) completionRequests.delete(key)
        }
    }

    function retryReportCompletion() {
        const range = visibleCalendarRange.value
        if (range && !completionRequests.has(rangeKey(range))) void loadReportCompletion(range)
    }

    async function loadRosterFlags(range: CalendarDateRange) {
        try {
            const flags = await EnrollmentTransferQueryService.getClassRosterFlags(sessionId, range.start, range.end)
            const byDate: Record<string, RosterFlag[]> = {}
            for (const flag of flags) (byDate[flag.date] ??= []).push(flag)
            rosterFlagsByDate.value = { ...withoutRange(rosterFlagsByDate.value, range), ...byDate }
        } catch (error) {
            // The transfer badges are informational; the calendar works without them.
            console.error('Failed to load roster flags:', error)
        }
    }

    /**
     * Loads one date range of the class's lessons and replaces that range in
     * sessionOccurrences, then refreshes the report-completion dots and roster
     * flags for it. A range already loaded is reused unless `force` is set.
     */
    function loadOccurrenceRange(range: CalendarDateRange, force = false): Promise<void> {
        const key = `${range.start}|${range.end}`
        const cached = loadedOccurrenceRanges.get(key)
        if (cached && !force) return cached
        const task = (async () => {
            const occurrences = await OccurrenceQueryService.getOccurrencesByDateRange(
                DateUtils.parseLocalDate(range.start)!, DateUtils.parseLocalDate(range.end)!, [sessionId]
            )
            const outside = sessionOccurrences.value.filter(occurrence => {
                const date = DateUtils.formatLocalDate(occurrence.occurrenceDate)
                return date < range.start || date > range.end
            })
            sessionOccurrences.value = [...outside, ...occurrences]
                .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime())
            void loadReportCompletion(range)
            void loadRosterFlags(range)
        })()
        loadedOccurrenceRanges.set(key, task)
        task.catch(() => {
            if (loadedOccurrenceRanges.get(key) === task) loadedOccurrenceRanges.delete(key)
        })
        return task
    }

    /** Reloads the month grid around `anchorDate` and the grid the calendar shows. */
    async function loadSessionOccurrences(anchorDate: Date): Promise<void> {
        const anchorRange = calendarGridRange(anchorDate)
        const visible = visibleCalendarRange.value
        await Promise.all([
            loadOccurrenceRange(anchorRange, true),
            ...(visible && (visible.start !== anchorRange.start || visible.end !== anchorRange.end) ? [loadOccurrenceRange(visible, true)] : []),
        ])
    }

    function handleCalendarRangeChange(range: CalendarDateRange) {
        visibleCalendarRange.value = range
        loadOccurrenceRange(range).catch(error => {
            console.error('Failed to load class calendar range:', error)
            source.reportError(error)
        })
    }

    /** Students whose class transfer into this class takes effect on the selected date. */
    const classTransferInIds = computed(() => new Set((rosterFlagsByDate.value[selectedDateKey.value || ''] ?? [])
        .filter(flag => flag.flag === 'transfer_in')
        .map(flag => flag.enrollment_id)))

    return {
        sessionOccurrences,
        reportCompletionByDate,
        completionFailed,
        retryReportCompletion,
        joinFlagsByDate,
        classTransferInIds,
        findOccurrenceByDate,
        loadSessionOccurrences,
        handleCalendarRangeChange,
    }
}
