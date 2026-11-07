import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'

const { getMock, postMock, resourceGetMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    postMock: vi.fn(),
    resourceGetMock: vi.fn()
}))

vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { get: getMock, post: postMock }
}))
vi.mock('@/services/api/ApiResourceClient', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiResourceClient')>(),
    apiResourceClient: { get: resourceGetMock, list: vi.fn() }
}))

beforeEach(() => {
    vi.clearAllMocks()
})

describe('EnrollmentTransferQueryService conflict display context', () => {
    it('normalizes occurrence, class, classroom, and lesson metadata', async () => {
        getMock.mockResolvedValue({
            data: {
                id: 'occurrence-1',
                occurrence_date: '2026-08-03',
                class_session_id: 'session-1',
                original_start_time: '09:00:00',
                original_end_time: '10:00:00',
                actual_start_time: '09:15:00',
                actual_end_time: null,
                class_sessions: [{
                    id: 'session-1',
                    name: 'Monday class',
                    start_time: '09:00:00',
                    end_time: '10:00:00',
                    time_zone: 'Asia/Taipei',
                    classroom_id: 'room-1',
                    classrooms: [{ id: 'room-1', name: 'Room 101' }]
                }]
            }
        })
        resourceGetMock.mockResolvedValue({ data: { id: 'lesson-1', sequence: 3, title: 'Fractions' } })

        await expect(EnrollmentTransferQueryService.getTransferConflictDisplayContext('occurrence-1', 'lesson-1'))
            .resolves.toEqual({
                occurrenceId: 'occurrence-1',
                occurrenceDate: '2026-08-03',
                startTime: '09:15:00',
                endTime: '10:00:00',
                sessionId: 'session-1',
                sessionName: 'Monday class',
                sessionTimeZone: 'Asia/Taipei',
                classroomId: 'room-1',
                classroomName: 'Room 101',
                lessonId: 'lesson-1',
                lessonSequence: 3,
                lessonTitle: 'Fractions'
            })
        expect(getMock).toHaveBeenCalledWith('/occurrences/occurrence-1')
        expect(resourceGetMock).toHaveBeenCalledWith('lessons', 'lesson-1')
    })

    it('returns readable-context fallbacks without querying a missing lesson', async () => {
        getMock.mockResolvedValue({
            data: {
                id: 'occurrence-2',
                occurrence_date: '2026-08-05',
                class_session_id: 'session-2',
                class_sessions: null
            }
        })

        const context = await EnrollmentTransferQueryService.getTransferConflictDisplayContext('occurrence-2')
        expect(context).toMatchObject({
            occurrenceId: 'occurrence-2',
            sessionId: 'session-2',
            sessionName: null,
            lessonTitle: null
        })
        expect(resourceGetMock).not.toHaveBeenCalled()
    })
})

describe('EnrollmentTransferQueryService single lesson transfer history', () => {
    it('reads the protected history endpoint and maps its DTO unchanged', async () => {
        const row = {
            id: 'transfer-1',
            created_at: '2026-08-08T05:30:00Z',
            cancelled_at: null,
            course_display_name: 'Scratch Advanced',
            source_occurrence_date: '2026-08-08',
            source_start_time: '10:00:00',
            source_end_time: '12:00:00',
            source_session_name: 'Original class',
            source_classroom_name: 'Room 201',
            target_occurrence_date: '2026-08-09',
            target_start_time: '13:00:00',
            target_end_time: '15:00:00',
            target_session_name: 'Make-up class',
            target_classroom_name: 'Room 202'
        }
        getMock.mockResolvedValue({ data: [row] })

        await expect(EnrollmentTransferQueryService.getSingleLessonTransferHistory('enrollment-1'))
            .resolves.toEqual([row])
        expect(getMock).toHaveBeenCalledWith('/enrollments/enrollment-1/transfer-history')
    })
})

describe('EnrollmentTransferQueryService effective single lesson targets', () => {
    it('uses the protected effective-target endpoint and preserves report state', async () => {
        const row = {
            transfer_id: 'transfer-1',
            source_occurrence_id: 'occurrence-a',
            target_occurrence_id: 'occurrence-b',
            is_effective_target: true,
            target_report_id: null
        }
        getMock.mockResolvedValue({ data: [row] })

        await expect(EnrollmentTransferQueryService.getEffectiveSingleLessonTransferTargets('enrollment-1'))
            .resolves.toEqual([row])
        expect(getMock).toHaveBeenCalledWith('/enrollments/enrollment-1/effective-transfer-targets')
    })

    it('repairs only through the guarded endpoint', async () => {
        postMock.mockResolvedValue({ data: { report_id: 'report-1' } })

        await expect(EnrollmentTransferQueryService.repairSingleLessonTransferReport('enrollment-1', 'occurrence-b'))
            .resolves.toBe('report-1')
        expect(postMock).toHaveBeenCalledWith('/enrollments/enrollment-1/repair-transfer-report', {
            target_occurrence_id: 'occurrence-b'
        })
    })
})
