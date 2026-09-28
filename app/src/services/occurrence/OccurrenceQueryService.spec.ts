import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OccurrenceQueryService } from './OccurrenceQueryService'

const { fromMock, apiV1GetMock, apiModeMock } = vi.hoisted(() => ({
    fromMock: vi.fn(),
    apiV1GetMock: vi.fn(),
    apiModeMock: vi.fn()
}))

vi.mock('@/services/api/ApiDataClient', () => ({
    apiDataClient: { from: fromMock }
}))
vi.mock('@/services/api/ApiV1Client', () => ({
    apiV1Client: { get: apiV1GetMock }
}))
vi.mock('@/services/api/ApiModeClient', () => ({
    getApiV1Mode: apiModeMock
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
    beforeEach(() => {
        vi.clearAllMocks()
        apiModeMock.mockReturnValue('mock')
    })

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

    it('queries an exact session date through the supported v1 occurrence parameters', async () => {
        apiModeMock.mockReturnValue('v1')
        apiV1GetMock.mockResolvedValue({ data: [row('2026-09-06', 'occurrence-1')] })

        const result = await OccurrenceQueryService.getOccurrenceBySessionAndDate('session-1', '2026-09-06')

        expect(result?.id).toBe('occurrence-1')
        expect(apiV1GetMock).toHaveBeenCalledWith(
            '/occurrences?class_session_id=session-1&date=2026-09-06&limit=1&sort=-created_at'
        )
        expect(fromMock).not.toHaveBeenCalled()
    })

    it('returns null when the session has no occurrence on the requested date', async () => {
        apiModeMock.mockReturnValue('v1')
        apiV1GetMock.mockResolvedValue({ data: [] })

        await expect(OccurrenceQueryService.getOccurrenceBySessionAndDate('session-1', '2026-09-06'))
            .resolves.toBeNull()
    })
})
