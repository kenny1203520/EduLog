import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OccurrenceQueryService } from './OccurrenceQueryService'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
    supabase: { from: fromMock }
}))

function row(date: string, id = date) {
    return {
        id,
        class_session_id: 'session-1',
        occurrence_date: date,
        status: 'scheduled',
        time_zone: 'Asia/Taipei'
    }
}

function query(result: { data: any; error: any }) {
    const chain: Record<string, any> = {}
    for (const method of ['select', 'eq', 'lte', 'lt', 'gt', 'order', 'limit']) {
        chain[method] = vi.fn(() => chain)
    }
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    return chain
}

describe('OccurrenceQueryService navigation', () => {
    beforeEach(() => vi.clearAllMocks())

    it('prefers today or the latest past occurrence', async () => {
        const previous = query({ data: row('2026-07-29'), error: null })
        fromMock.mockReturnValue(previous)

        const result = await OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29))
        expect(result?.id).toBe('2026-07-29')
        expect(previous.lte).toHaveBeenCalledWith('occurrence_date', '2026-07-29')
        expect(previous.order).toHaveBeenCalledWith('occurrence_date', { ascending: false })
        expect(fromMock).toHaveBeenCalledTimes(1)
    })

    it('falls back to the earliest future occurrence when there is no past occurrence', async () => {
        const previous = query({ data: null, error: null })
        const next = query({ data: row('2026-08-03'), error: null })
        fromMock.mockReturnValueOnce(previous).mockReturnValueOnce(next)

        const result = await OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29))
        expect(result?.id).toBe('2026-08-03')
        expect(next.gt).toHaveBeenCalledWith('occurrence_date', '2026-07-29')
        expect(next.order).toHaveBeenCalledWith('occurrence_date', { ascending: true })
    })

    it('loads actual adjacent occurrences and reports both navigation boundaries', async () => {
        const previous = query({ data: row('2026-07-20', 'previous'), error: null })
        const next = query({ data: row('2026-08-10', 'next'), error: null })
        fromMock.mockReturnValueOnce(previous).mockReturnValueOnce(next)

        const state = await OccurrenceQueryService.getOccurrenceNavigationState('session-1', new Date(2026, 6, 29))
        expect(state.previous?.id).toBe('previous')
        expect(state.next?.id).toBe('next')
        expect(previous.lt).toHaveBeenCalledWith('occurrence_date', '2026-07-29')
        expect(next.gt).toHaveBeenCalledWith('occurrence_date', '2026-07-29')
    })

    it('surfaces query failures so the page can render retry state', async () => {
        fromMock.mockReturnValue(query({ data: null, error: { message: 'offline' } }))
        await expect(OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29)))
            .rejects.toThrow('offline')
    })
})
