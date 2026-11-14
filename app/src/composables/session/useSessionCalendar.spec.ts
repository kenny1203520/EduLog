import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSessionCalendar } from './useSessionCalendar'

const occurrence = vi.hoisted(() => ({ getReportCompletionByDate: vi.fn(), getOccurrencesByDateRange: vi.fn() }))
vi.mock('@/services/occurrence/OccurrenceQueryService', () => ({ OccurrenceQueryService: occurrence }))
vi.mock('@/services/enrollment/EnrollmentTransferQueryService', () => ({
    EnrollmentTransferQueryService: { getClassRosterFlags: vi.fn().mockResolvedValue([]) },
}))

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

it('keeps class dates usable when completion fails and retries just the markers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const date = '2026-11-13'
    const lesson = { occurrenceDate: new Date(2026, 10, 13) }
    occurrence.getOccurrencesByDateRange.mockResolvedValue([lesson])
    occurrence.getReportCompletionByDate.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ [date]: { total: 2, completed: 1 } })
    const calendar = useSessionCalendar({ sessionId: 'session', selectedDateKey: ref(date), reportError: vi.fn() })
    calendar.handleCalendarRangeChange({ start: '2026-11-01', end: '2026-11-30' })
    await flushPromises()
    expect(calendar.findOccurrenceByDate(lesson.occurrenceDate)).toEqual(lesson)
    expect(calendar.completionFailed.value).toBe(true)
    expect(calendar.reportCompletionByDate.value[date]).toBeUndefined()
    calendar.retryReportCompletion()
    await flushPromises()
    expect(calendar.completionFailed.value).toBe(false)
    expect(calendar.reportCompletionByDate.value[date]).toEqual({ total: 2, completed: 1 })
    expect(occurrence.getOccurrencesByDateRange).toHaveBeenCalledTimes(1)
})
