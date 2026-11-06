import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HolidayCommandService } from './HolidayCommandService'

const { createMock, removeMock } = vi.hoisted(() => ({ createMock: vi.fn(), removeMock: vi.fn() }))

vi.mock('@/services/api/ApiResourceClient', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiResourceClient')>(),
    apiResourceClient: { create: createMock, remove: removeMock, update: vi.fn() }
}))

// Report and occurrence side effects of a holiday (absent placeholders,
// teacher attendance) are applied by the API in the same transaction; the
// client only sends the holiday itself.
describe('HolidayCommandService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        createMock.mockResolvedValue({ data: { id: 'holiday-1', start_date: '2026-06-01', end_date: '2026-06-01', kind: 'closure' } })
    })

    it('creates a closure with empty scopes by default', async () => {
        await HolidayCommandService.createHoliday({ startDate: '2026-06-01', endDate: '2026-06-01', timeZone: 'Asia/Taipei' })

        expect(createMock).toHaveBeenCalledWith('holidays', {
            start_date: '2026-06-01',
            end_date: '2026-06-01',
            time_zone: 'Asia/Taipei',
            name: undefined,
            kind: 'closure',
            classroom_ids: [],
            class_session_ids: [],
            teacher_ids: []
        })
    })

    it('sends teacher leave with its session and teacher scope', async () => {
        await HolidayCommandService.createHoliday({
            startDate: '2026-06-01',
            endDate: '2026-06-14',
            timeZone: 'Asia/Taipei',
            kind: 'teacher_leave',
            classSessionIds: ['session-1'],
            teacherIds: ['teacher-1']
        })

        expect(createMock).toHaveBeenCalledWith('holidays', expect.objectContaining({
            kind: 'teacher_leave',
            class_session_ids: ['session-1'],
            teacher_ids: ['teacher-1']
        }))
    })

    it('deletes a holiday through the resource API', async () => {
        removeMock.mockResolvedValue({ data: null })
        await HolidayCommandService.deleteHoliday('holiday-1')
        expect(removeMock).toHaveBeenCalledWith('holidays', 'holiday-1')
    })
})
