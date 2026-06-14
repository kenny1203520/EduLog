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

    it('syncs closure holidays by incrementing affected report versions', async () => {
        const createHolidayQuery = createQuery({
            data: {
                id: 'holiday-1',
                start_date: '2026-06-01',
                end_date: '2026-06-01',
                time_zone: 'Asia/Taipei',
                kind: 'closure',
                classroom_ids: [],
                class_session_ids: [],
                teacher_ids: []
            }
        })
        const occurrencesQuery = createQuery({
            data: [{
                id: 'occurrence-1',
                teacher_ids: ['teacher-1'],
                teacher_attendance: { 'teacher-1': true },
                class_session_id: 'session-1',
                occurrence_date: '2026-06-01',
                class_sessions: { classroom_id: 'classroom-1' }
            }]
        })
        const reportFetchQuery = createQuery({ data: [{ id: 'report-1', version: 2 }] })
        const reportUpdateQuery = createQuery({})
        const occurrenceUpdateQuery = createQuery({})

        queueQueries(createHolidayQuery, occurrencesQuery, reportFetchQuery, reportUpdateQuery, occurrenceUpdateQuery)

        await HolidayCommandService.createHoliday({
            startDate: '2026-06-01',
            endDate: '2026-06-01',
            timeZone: 'Asia/Taipei'
        })

        expect(reportUpdateQuery.update).toHaveBeenCalledWith({
            attendance_status: 'absent',
            absence_reason: 'holiday',
            version: 3
        })
        expect(occurrenceUpdateQuery.update).toHaveBeenCalledWith({
            is_conducted: false,
            teacher_attendance: { 'teacher-1': false }
        })
    })

    it('restores closure holidays by incrementing affected report versions', async () => {
        const fetchExistingHolidayQuery = createQuery({
            data: {
                id: 'holiday-1',
                start_date: '2026-06-01',
                end_date: '2026-06-01',
                time_zone: 'Asia/Taipei',
                kind: 'closure',
                classroom_ids: [],
                class_session_ids: [],
                teacher_ids: []
            }
        })
        const deleteHolidayQuery = createQuery({})
        const occurrencesQuery = createQuery({
            data: [{
                id: 'occurrence-1',
                teacher_ids: ['teacher-1'],
                teacher_attendance: { 'teacher-1': false },
                class_session_id: 'session-1',
                occurrence_date: '2026-06-01',
                class_sessions: { classroom_id: 'classroom-1' }
            }]
        })
        const remainingHolidaysQuery = createQuery({ data: [] })
        const reportFetchQuery = createQuery({ data: [{ id: 'report-1', version: 4 }] })
        const reportUpdateQuery = createQuery({})
        const occurrenceUpdateQuery = createQuery({})

        queueQueries(
            fetchExistingHolidayQuery,
            deleteHolidayQuery,
            occurrencesQuery,
            remainingHolidaysQuery,
            reportFetchQuery,
            reportUpdateQuery,
            occurrenceUpdateQuery
        )

        await HolidayCommandService.deleteHoliday('holiday-1')

        expect(reportUpdateQuery.update).toHaveBeenCalledWith({
            attendance_status: 'pending',
            absence_reason: null,
            version: 5
        })
        expect(occurrenceUpdateQuery.update).toHaveBeenCalledWith({
            is_conducted: true,
            teacher_attendance: { 'teacher-1': true }
        })
    })

    it('syncs teacher leave without touching student reports or class conducted state', async () => {
        const createHolidayQuery = createQuery({
            data: {
                id: 'holiday-1',
                start_date: '2026-06-01',
                end_date: '2026-06-14',
                time_zone: 'Asia/Taipei',
                kind: 'teacher_leave',
                classroom_ids: [],
                class_session_ids: ['session-1'],
                teacher_ids: ['teacher-1']
            }
        })
        const occurrencesQuery = createQuery({
            data: [{
                id: 'occurrence-1',
                teacher_ids: ['teacher-1', 'teacher-2'],
                teacher_attendance: { 'teacher-1': true, 'teacher-2': true },
                class_session_id: 'session-1',
                occurrence_date: '2026-06-01',
                class_sessions: { classroom_id: 'classroom-1' }
            }]
        })
        const occurrenceUpdateQuery = createQuery({})

        queueQueries(createHolidayQuery, occurrencesQuery, occurrenceUpdateQuery)

        await HolidayCommandService.createHoliday({
            startDate: '2026-06-01',
            endDate: '2026-06-14',
            timeZone: 'Asia/Taipei',
            kind: 'teacher_leave',
            classSessionIds: ['session-1'],
            teacherIds: ['teacher-1']
        })

        expect(fromMock).not.toHaveBeenCalledWith('occurrence_reports')
        expect(occurrenceUpdateQuery.update).toHaveBeenCalledWith({
            teacher_attendance: { 'teacher-1': false, 'teacher-2': true }
        })
    })
})
