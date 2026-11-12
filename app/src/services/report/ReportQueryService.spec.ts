import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportQueryService, normalizeEnrollmentReportRelations } from './ReportQueryService'

const { getEnrollmentReportsMock, apiV1GetMock } = vi.hoisted(() => ({
    getEnrollmentReportsMock: vi.fn(),
    apiV1GetMock: vi.fn()
}))

vi.mock('@/services/api/PageApiService', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/api/PageApiService')>(),
    PageApiService: { ...(await importOriginal<typeof import('@/services/api/PageApiService')>()).PageApiService, getEnrollmentReports: getEnrollmentReportsMock }
}))
vi.mock('@/services/api/ApiV1Client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/api/ApiV1Client')>()
    return { ...actual, apiV1Client: { ...actual.apiV1Client, get: apiV1GetMock } }
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('ReportQueryService.getProgressSummaryReportsByEnrollments', () => {
    it('groups reports by enrollment_id in one request instead of one per enrollment', async () => {
        apiV1GetMock.mockResolvedValueOnce({ data: [
            { id: 'r1', enrollment_id: 'e1', lesson_id: 'l1', is_completed: true, progress_letter: 'A', attendance_status: 'present', class_occurrences: { occurrence_date: '2026-01-01' } },
            { id: 'r2', enrollment_id: 'e1', lesson_id: 'l2', is_completed: false, progress_letter: 'B', attendance_status: 'present', class_occurrences: { occurrence_date: '2026-01-08' } },
            { id: 'r3', enrollment_id: 'e2', lesson_id: 'l1', is_completed: true, progress_letter: 'A', attendance_status: 'absent', class_occurrences: { occurrence_date: '2026-01-01' } }
        ] })

        const result = await ReportQueryService.getProgressSummaryReportsByEnrollments(['e1', 'e2'])

        expect(apiV1GetMock).toHaveBeenCalledTimes(1)
        expect(apiV1GetMock).toHaveBeenCalledWith('/reports/progress-summary?enrollment_ids=e1%2Ce2&limit=1000&sort=-created_at')
        expect(result.get('e1')).toHaveLength(2)
        expect(result.get('e2')).toHaveLength(1)
        expect(result.get('e1')?.[0]?.lessonId).toBe('l1')
        expect(result.get('e2')?.[0]?.attendanceStatus).toBe('absent')
    })

    it('returns an empty map without querying when given no enrollment ids', async () => {
        const result = await ReportQueryService.getProgressSummaryReportsByEnrollments([])

        expect(apiV1GetMock).not.toHaveBeenCalled()
        expect(result.size).toBe(0)
    })

    it('surfaces API failures', async () => {
        apiV1GetMock.mockRejectedValueOnce(new Error('boom'))

        await expect(ReportQueryService.getProgressSummaryReportsByEnrollments(['e1'])).rejects.toThrow('boom')
    })
})

describe('ReportQueryService.getEnrollmentReportProgressContext', () => {
    it('requests only the selected enrollment report context through the authenticated API', async () => {
        const context = { enrollment_id: 'enrollment-1', occurrence_date: '2026-09-27', lessons: [], reports: [], latest_prior_report: null }
        apiV1GetMock.mockResolvedValueOnce({ data: context })

        await expect(ReportQueryService.getEnrollmentReportProgressContext('enrollment-1', 'occurrence-1', 'report-1')).resolves.toEqual(context)
        expect(apiV1GetMock).toHaveBeenCalledWith('/enrollments/enrollment-1/report-progress-context?occurrence_id=occurrence-1&report_id=report-1')
    })
})

describe('ReportQueryService.getLinkedLessonReportHistory', () => {
    it('requests a bounded safe history page with course, search, and sort filters', async () => {
        const rows = [{
            id: 'report-1', class_occurrence_id: 'occurrence-1', lesson_id: 'lesson-b', course_id: 'course-b',
            course_name: 'Course B', lesson_sequence: 2, lesson_title: 'Lesson B2', progress_letter: 'C',
            is_completed: false, attendance_status: 'present', content: 'Shared note', occurrence_date: '2026-11-11',
        }]
        apiV1GetMock.mockResolvedValueOnce({ data: rows, meta: { total: 24 } })

        await expect(ReportQueryService.getLinkedLessonReportHistory('enrollment-b', {
            limit: 10, offset: 20, search: 'make up', courseId: 'course-b', sort: '-occurrence_date',
        })).resolves.toEqual({ data: rows, count: 24 })
        expect(apiV1GetMock).toHaveBeenCalledWith(
            '/enrollments/enrollment-b/linked-lesson-report-history?limit=10&offset=20&sort=-occurrence_date&search=make+up&course_id=course-b'
        )
    })
})

describe('ReportQueryService.getProgressGapsByEnrollments', () => {
    it('requests authorized batch summaries without loading report bodies', async () => {
        apiV1GetMock.mockResolvedValueOnce({ data: [
            { enrollment_id: 'enrollment-1', gaps: [{ id: 'lesson-6', sequence: 6, title: 'Lesson 6' }] },
            { enrollment_id: 'enrollment-2', gaps: [] }
        ] })

        const result = await ReportQueryService.getProgressGapsByEnrollments('occurrence-1', ['enrollment-1', 'enrollment-2'])

        expect(apiV1GetMock).toHaveBeenCalledWith('/occurrences/occurrence-1/report-progress-gaps?enrollment_ids=enrollment-1%2Cenrollment-2')
        expect(result.get('enrollment-1')).toEqual([{ id: 'lesson-6', sequence: 6, title: 'Lesson 6' }])
        expect(result.get('enrollment-2')).toEqual([])
    })

    it('splits large rosters into bounded API batches', async () => {
        apiV1GetMock.mockResolvedValue({ data: [] })
        const ids = Array.from({ length: 101 }, (_, index) => `enrollment-${index}`)

        await ReportQueryService.getProgressGapsByEnrollments('occurrence-1', ids)

        expect(apiV1GetMock).toHaveBeenCalledTimes(2)
        expect(apiV1GetMock.mock.calls[0][0]).toContain('enrollment_ids=')
        expect(decodeURIComponent(apiV1GetMock.mock.calls[0][0])).toContain(ids.slice(0, 100).join(','))
        expect(decodeURIComponent(apiV1GetMock.mock.calls[1][0])).toContain(ids[100])
    })
})

describe('ReportQueryService.getReportsByOccurrence', () => {
    it('reads every page of the authorized occurrence report list in v1 mode', async () => {
        apiV1GetMock
            .mockResolvedValueOnce({ data: Array.from({ length: 100 }, (_, index) => ({ id: `report-${index + 1}`, enrollment_id: `active-${index + 1}`, class_occurrence_id: 'occurrence-1', attendance_status: 'pending', version: 1 })), meta: { total: 101 } })
            .mockResolvedValueOnce({ data: [{ id: 'report-2', enrollment_id: 'completed', class_occurrence_id: 'occurrence-1', attendance_status: 'present', version: 4 }], meta: { total: 101 } })

        const reports = await ReportQueryService.getReportsByOccurrence('occurrence-1')

        expect(apiV1GetMock).toHaveBeenCalledTimes(2)
        expect(apiV1GetMock.mock.calls[0][0]).toContain('limit=100')
        expect(apiV1GetMock.mock.calls[0][0]).toContain('offset=0')
        expect(apiV1GetMock.mock.calls[1][0]).toContain('offset=100')
        expect(reports).toHaveLength(101)
        expect(reports[0]?.attendanceStatus).toBe('pending')
        expect(reports.at(-1)?.attendanceStatus).toBe('present')
    })
})

describe('ReportQueryService.getReportsWithDetails', () => {
    it('normalizes the plural API relation shape for the report list', async () => {
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
