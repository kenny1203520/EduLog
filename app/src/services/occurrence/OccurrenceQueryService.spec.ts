import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OccurrenceQueryService } from './OccurrenceQueryService'

const { apiV1GetMock } = vi.hoisted(() => ({ apiV1GetMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', () => ({
    apiV1Client: { get: apiV1GetMock }
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

describe('OccurrenceQueryService navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('asks the server for the preferred occurrence on the local reference date', async () => {
        apiV1GetMock.mockResolvedValue({ data: row('2026-07-29') })

        const result = await OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29))
        expect(result?.id).toBe('2026-07-29')
        expect(apiV1GetMock).toHaveBeenCalledWith('/occurrences/session-1/preferred?date=2026-07-29')
    })

    it('returns null when the session has no preferred occurrence', async () => {
        apiV1GetMock.mockResolvedValue({ data: null })
        await expect(OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29))).resolves.toBeNull()
    })

    it('loads actual adjacent occurrences and reports both navigation boundaries', async () => {
        apiV1GetMock.mockResolvedValue({ data: { previous: row('2026-07-20', 'previous'), next: row('2026-08-10', 'next') } })

        const state = await OccurrenceQueryService.getOccurrenceNavigationState('session-1', new Date(2026, 6, 29))
        expect(state.previous?.id).toBe('previous')
        expect(state.next?.id).toBe('next')
        expect(apiV1GetMock).toHaveBeenCalledWith('/occurrences/session-1/navigation?date=2026-07-29')
    })

    it('surfaces query failures so the page can render retry state', async () => {
        apiV1GetMock.mockRejectedValue(new Error('offline'))
        await expect(OccurrenceQueryService.getPreferredOccurrence('session-1', new Date(2026, 6, 29)))
            .rejects.toThrow('offline')
    })

    it('queries an exact session date through the supported v1 occurrence parameters', async () => {
        apiV1GetMock.mockResolvedValue({ data: [row('2026-09-06', 'occurrence-1')] })

        const result = await OccurrenceQueryService.getOccurrenceBySessionAndDate('session-1', '2026-09-06')

        expect(result?.id).toBe('occurrence-1')
        expect(apiV1GetMock).toHaveBeenCalledWith(
            '/occurrences?class_session_id=session-1&date=2026-09-06&limit=1&sort=-created_at'
        )
    })

    it('returns null when the session has no occurrence on the requested date', async () => {
        apiV1GetMock.mockResolvedValue({ data: [] })

        await expect(OccurrenceQueryService.getOccurrenceBySessionAndDate('session-1', '2026-09-06'))
            .resolves.toBeNull()
    })
})

describe('OccurrenceQueryService calendar range', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('loads a session calendar through session_ids and maps the successful response', async () => {
        const sessionId = '10000000-0000-4000-8000-000000000002'
        apiV1GetMock.mockResolvedValue({
            data: [{
                ...row('2026-08-12', 'calendar-occurrence'),
                class_session_id: sessionId,
                class_sessions: {
                    id: sessionId,
                    name: 'Algebra',
                    time_zone: 'Asia/Taipei',
                    classrooms: { id: 'classroom-1', name: 'Room 1', color: '#22aa88' }
                }
            }],
            meta: { total: 1 }
        })

        const occurrences = await OccurrenceQueryService.getOccurrencesByDateRange(
            new Date(2026, 7, 1),
            new Date(2026, 7, 31),
            [sessionId]
        )

        expect(apiV1GetMock).toHaveBeenCalledWith(
            `/occurrences?start=2026-08-01&end=2026-08-31&limit=100&offset=0&sort=occurrence_date&session_ids=${sessionId}`
        )
        expect(occurrences).toHaveLength(1)
        expect(occurrences[0]).toMatchObject({
            id: 'calendar-occurrence',
            classSessionId: sessionId,
            sessionName: 'Algebra',
            classroomName: 'Room 1',
            classroomColor: '#22aa88'
        })
        expect(occurrences[0]?.formatDate(occurrences[0].occurrenceDate)).toBe('2026-08-12')
    })
})
