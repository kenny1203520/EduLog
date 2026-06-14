import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HolidayQueryService } from './HolidayQueryService'

const { fromMock } = vi.hoisted(() => ({
    fromMock: vi.fn()
}))

vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: fromMock
    }
}))

function createHolidayQuery(data: any[] = [], error: any = null) {
    const query: Record<string, any> = {}
    const chainMethods = ['select', 'lte', 'gte', 'eq', 'contains', 'or', 'limit']

    for (const method of chainMethods) {
        query[method] = vi.fn(() => query)
    }

    query.then = (resolve: (value: any) => unknown, reject: (reason?: any) => unknown) => {
        return Promise.resolve({ data, error }).then(resolve, reject)
    }

    return query
}

describe('HolidayQueryService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('treats multiple matching holidays as holiday instead of requiring a single row', async () => {
        const query = createHolidayQuery([{ id: 'holiday-1' }, { id: 'holiday-2' }])
        fromMock.mockReturnValue(query)

        await expect(HolidayQueryService.isHoliday('2026-06-01', 'classroom-1', 'session-1'))
            .resolves.toBe(true)

        expect(query.limit).toHaveBeenCalledWith(1)
        expect(query.or).toHaveBeenCalledWith(expect.stringContaining('class_session_ids.cs.{session-1}'))
    })

    it('returns false when checking holidays fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
        const query = createHolidayQuery([], { message: 'query failed' })
        fromMock.mockReturnValue(query)

        await expect(HolidayQueryService.isHoliday('2026-06-01'))
            .resolves.toBe(false)

        expect(consoleError).toHaveBeenCalledWith('Error checking holiday:', { message: 'query failed' })
        consoleError.mockRestore()
    })

    it('checks teacher leave by date, teacher, and scope', async () => {
        const query = createHolidayQuery([{ id: 'leave-1' }])
        fromMock.mockReturnValue(query)

        await expect(HolidayQueryService.isTeacherOnLeave('2026-06-01', 'teacher-1', 'classroom-1', 'session-1'))
            .resolves.toBe(true)

        expect(query.eq).toHaveBeenCalledWith('kind', 'teacher_leave')
        expect(query.contains).toHaveBeenCalledWith('teacher_ids', ['teacher-1'])
        expect(query.or).toHaveBeenCalledWith(expect.stringContaining('class_session_ids.cs.{session-1}'))
    })
})
