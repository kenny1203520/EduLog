import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HolidayQueryService } from './HolidayQueryService'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { get: getMock }
}))

function checkedQuery(): URLSearchParams {
    const path = String(getMock.mock.calls[0][0])
    expect(path.startsWith('/holidays/check?')).toBe(true)
    return new URLSearchParams(path.slice('/holidays/check?'.length))
}

describe('HolidayQueryService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('checks a holiday by date and scope through the server', async () => {
        getMock.mockResolvedValue({ data: { matched: true } })

        await expect(HolidayQueryService.isHoliday('2026-06-01', 'classroom-1', 'session-1'))
            .resolves.toBe(true)

        const query = checkedQuery()
        expect(query.get('date')).toBe('2026-06-01')
        expect(query.get('classroom_id')).toBe('classroom-1')
        expect(query.get('class_session_id')).toBe('session-1')
        expect(query.has('teacher_id')).toBe(false)
    })

    it('surfaces check failures instead of treating the date as a normal day', async () => {
        getMock.mockRejectedValue(new Error('query failed'))

        await expect(HolidayQueryService.isHoliday('2026-06-01')).rejects.toThrow('query failed')
    })

    it('checks teacher leave by date, teacher, and scope', async () => {
        getMock.mockResolvedValue({ data: { matched: true } })

        await expect(HolidayQueryService.isTeacherOnLeave('2026-06-01', 'teacher-1', 'classroom-1', 'session-1'))
            .resolves.toBe(true)

        const query = checkedQuery()
        expect(query.get('teacher_id')).toBe('teacher-1')
        expect(query.get('class_session_id')).toBe('session-1')
    })
})
