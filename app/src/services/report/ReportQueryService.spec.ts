import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportQueryService } from './ReportQueryService'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: { from: fromMock } }))

beforeEach(() => {
    vi.clearAllMocks()
})

function selectQuery(result: { data?: any; error?: any }) {
    const chain: Record<string, any> = {}
    chain.select = vi.fn(() => chain)
    chain.in = vi.fn(() => Promise.resolve(result))
    return chain
}

describe('ReportQueryService.getProgressSummaryReportsByEnrollments', () => {
    it('groups reports by enrollment_id in one request instead of one per enrollment', async () => {
        const query = selectQuery({
            data: [
                { id: 'r1', enrollment_id: 'e1', lesson_id: 'l1', is_completed: true, progress_letter: 'A', attendance_status: 'present', class_occurrence: { occurrence_date: '2026-01-01' } },
                { id: 'r2', enrollment_id: 'e1', lesson_id: 'l2', is_completed: false, progress_letter: 'B', attendance_status: 'present', class_occurrence: { occurrence_date: '2026-01-08' } },
                { id: 'r3', enrollment_id: 'e2', lesson_id: 'l1', is_completed: true, progress_letter: 'A', attendance_status: 'absent', class_occurrence: { occurrence_date: '2026-01-01' } }
            ],
            error: null
        })
        fromMock.mockReturnValueOnce(query)

        const result = await ReportQueryService.getProgressSummaryReportsByEnrollments(['e1', 'e2'])

        expect(fromMock).toHaveBeenCalledTimes(1)
        expect(query.in).toHaveBeenCalledWith('enrollment_id', ['e1', 'e2'])
        expect(result.get('e1')).toHaveLength(2)
        expect(result.get('e2')).toHaveLength(1)
        expect(result.get('e1')?.[0]?.lessonId).toBe('l1')
        expect(result.get('e2')?.[0]?.attendanceStatus).toBe('absent')
    })

    it('returns an empty map without querying when given no enrollment ids', async () => {
        const result = await ReportQueryService.getProgressSummaryReportsByEnrollments([])

        expect(fromMock).not.toHaveBeenCalled()
        expect(result.size).toBe(0)
    })

    it('throws a descriptive error when the query fails', async () => {
        fromMock.mockReturnValueOnce(selectQuery({ data: null, error: { message: 'boom' } }))

        await expect(ReportQueryService.getProgressSummaryReportsByEnrollments(['e1']))
            .rejects.toThrow('Failed to fetch progress summary reports: boom')
    })
})
