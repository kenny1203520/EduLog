import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HolidayCommandService } from './HolidayCommandService'

const { fromMock } = vi.hoisted(() => ({
    fromMock: vi.fn()
}))

vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: fromMock
    }
}))

type SupabaseResult = {
    data?: any
    error?: any
}

function createQuery(result: SupabaseResult) {
    const query: Record<string, any> = {}
    const chainMethods = ['insert', 'update', 'delete', 'select', 'eq', 'gte', 'lte', 'in']

    for (const method of chainMethods) {
        query[method] = vi.fn(() => query)
    }

    query.single = vi.fn(() => Promise.resolve(result))
    query.maybeSingle = vi.fn(() => Promise.resolve(result))
    query.then = (resolve: (value: SupabaseResult) => unknown, reject: (reason?: any) => unknown) => {
        return Promise.resolve(result).then(resolve, reject)
    }

    return query
}

function queueQueries(...queries: Array<Record<string, any>>) {
    fromMock.mockImplementation(() => {
        const query = queries.shift()
        if (!query) throw new Error('Unexpected Supabase query')
        return query
    })
}

describe('HolidayCommandService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('rejects createHoliday when holiday report sync fails', async () => {
        const createHolidayQuery = createQuery({
            data: {
                id: 'holiday-1',
                start_date: '2026-06-01',
                end_date: '2026-06-01',
                time_zone: 'Asia/Taipei',
                classroom_ids: [],
                class_session_ids: []
            }
        })
        const occurrencesQuery = createQuery({
            data: [{
                id: 'occurrence-1',
                teacher_ids: ['teacher-1'],
                class_session_id: 'session-1',
                occurrence_date: '2026-06-01',
                class_sessions: { classroom_id: 'classroom-1' }
            }]
        })
        const reportSyncQuery = createQuery({
            error: { message: 'report update failed' }
        })

        queueQueries(createHolidayQuery, occurrencesQuery, reportSyncQuery)

        await expect(HolidayCommandService.createHoliday({
            startDate: '2026-06-01',
            endDate: '2026-06-01',
            timeZone: 'Asia/Taipei'
        })).rejects.toThrow('Failed to sync reports for holiday: report update failed')

        expect(fromMock).toHaveBeenCalledWith('occurrence_reports')
    })

    it('rejects deleteHoliday when releasing holiday-controlled reports fails', async () => {
        const fetchExistingHolidayQuery = createQuery({
            data: {
                id: 'holiday-1',
                start_date: '2026-06-01',
                end_date: '2026-06-01',
                time_zone: 'Asia/Taipei',
                classroom_ids: [],
                class_session_ids: []
            }
        })
        const deleteHolidayQuery = createQuery({})
        const occurrencesQuery = createQuery({
            data: [{
                id: 'occurrence-1',
                teacher_ids: ['teacher-1'],
                class_session_id: 'session-1',
                occurrence_date: '2026-06-01',
                class_sessions: { classroom_id: 'classroom-1' }
            }]
        })
        const remainingHolidaysQuery = createQuery({ data: [] })
        const reportReleaseQuery = createQuery({
            error: { message: 'release update failed' }
        })

        queueQueries(
            fetchExistingHolidayQuery,
            deleteHolidayQuery,
            occurrencesQuery,
            remainingHolidaysQuery,
            reportReleaseQuery
        )

        await expect(HolidayCommandService.deleteHoliday('holiday-1'))
            .rejects.toThrow('Failed to release reports after holiday removal: release update failed')

        expect(fromMock).toHaveBeenCalledWith('occurrence_reports')
    })
})
