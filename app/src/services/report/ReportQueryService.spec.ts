import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportQueryService, normalizeEnrollmentReportRelations } from './ReportQueryService'

const { fromMock, apiModeMock, getEnrollmentReportsMock } = vi.hoisted(() => ({
    fromMock: vi.fn(),
    apiModeMock: vi.fn(() => 'legacy'),
    getEnrollmentReportsMock: vi.fn()
}))

vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: { from: fromMock } }))
vi.mock('@/services/api/ApiModeClient', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/api/ApiModeClient')>(),
    getApiV1Mode: apiModeMock
}))
vi.mock('@/services/api/PageApiService', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/api/PageApiService')>(),
    PageApiService: { ...(await importOriginal<typeof import('@/services/api/PageApiService')>()).PageApiService, getEnrollmentReports: getEnrollmentReportsMock }
}))

beforeEach(() => {
    vi.clearAllMocks()
    apiModeMock.mockReturnValue('legacy')
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

describe('ReportQueryService.getReportsWithDetails', () => {
    it('normalizes the plural API relation shape for the report list', async () => {
        apiModeMock.mockReturnValue('v1')
        getEnrollmentReportsMock.mockResolvedValue({
            data: {
                reports: [{
                    id: 'report-1',
                    class_occurrence_id: 'occurrence-1',
                    class_occurrences: [{
                        occurrence_date: '2026-09-26',
                        class_session_id: 'session-1',
                        class_sessions: [{
                            id: 'session-1',
                            name: 'Saturday class',
                            classrooms: [{ id: 'classroom-1', name: 'Main classroom' }]
                        }]
                    }],
                    lessons: [{ id: 'lesson-1', title: 'Lesson 1', sequence: 1 }]
                }]
            }
        })

        const reports = await ReportQueryService.getReportsWithDetails('enrollment-1')

        expect(getEnrollmentReportsMock).toHaveBeenCalledWith('enrollment-1', {
            limit: 100,
            offset: 0,
            sort: '-occurrence_date'
        })
        expect(reports[0]).toMatchObject({
            class_occurrence: {
                occurrence_date: '2026-09-26',
                class_session: {
                    id: 'session-1',
                    name: 'Saturday class',
                    classroom: { id: 'classroom-1', name: 'Main classroom' }
                }
            },
            lesson: { id: 'lesson-1', title: 'Lesson 1', sequence: 1 }
        })
    })

    it('keeps missing relations nullable and accepts already singular relations', () => {
        expect(normalizeEnrollmentReportRelations({ id: 'missing' })).toEqual({
            id: 'missing',
            class_occurrence: null,
            lesson: null
        })
        expect(normalizeEnrollmentReportRelations({
            class_occurrence: { class_session: { classroom: { name: 'Room' } } },
            lesson: { title: 'Existing shape' }
        })).toMatchObject({
            class_occurrence: { class_session: { classroom: { name: 'Room' } } },
            lesson: { title: 'Existing shape' }
        })
    })
})
