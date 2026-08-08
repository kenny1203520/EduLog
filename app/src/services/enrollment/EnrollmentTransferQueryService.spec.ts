import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'

const { fromMock, rpcMock, occurrenceChain, lessonChain } = vi.hoisted(() => {
    const occurrenceChain: any = {
        select: vi.fn(),
        eq: vi.fn(),
        single: vi.fn()
    }
    occurrenceChain.select.mockReturnValue(occurrenceChain)
    occurrenceChain.eq.mockReturnValue(occurrenceChain)

    const lessonChain: any = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn()
    }
    lessonChain.select.mockReturnValue(lessonChain)
    lessonChain.eq.mockReturnValue(lessonChain)

    return {
        occurrenceChain,
        lessonChain,
        fromMock: vi.fn((table: string) => table === 'class_occurrences' ? occurrenceChain : lessonChain),
        rpcMock: vi.fn()
    }
})

vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock, rpc: rpcMock } }))

describe('EnrollmentTransferQueryService conflict display context', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        occurrenceChain.select.mockReturnValue(occurrenceChain)
        occurrenceChain.eq.mockReturnValue(occurrenceChain)
        lessonChain.select.mockReturnValue(lessonChain)
        lessonChain.eq.mockReturnValue(lessonChain)
    })

    it('normalizes occurrence, class, classroom, and lesson metadata', async () => {
        occurrenceChain.single.mockResolvedValue({
            data: {
                id: 'occurrence-1',
                occurrence_date: '2026-08-03',
                class_session_id: 'session-1',
                original_start_time: '09:00:00',
                original_end_time: '10:00:00',
                actual_start_time: '09:15:00',
                actual_end_time: null,
                class_session: [{
                    id: 'session-1',
                    name: 'Monday class',
                    start_time: '09:00:00',
                    end_time: '10:00:00',
                    time_zone: 'Asia/Taipei',
                    classroom_id: 'room-1',
                    classroom: [{ id: 'room-1', name: 'Room 101' }]
                }]
            },
            error: null
        })
        lessonChain.maybeSingle.mockResolvedValue({
            data: { id: 'lesson-1', sequence: 3, title: 'Fractions' },
            error: null
        })

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
    })

    it('returns readable-context fallbacks without querying a missing lesson', async () => {
        occurrenceChain.single.mockResolvedValue({
            data: {
                id: 'occurrence-2',
                occurrence_date: '2026-08-05',
                class_session_id: 'session-2',
                class_session: null
            },
            error: null
        })

        const context = await EnrollmentTransferQueryService.getTransferConflictDisplayContext('occurrence-2')
        expect(context).toMatchObject({
            occurrenceId: 'occurrence-2',
            sessionId: 'session-2',
            sessionName: null,
            lessonTitle: null
        })
        expect(lessonChain.maybeSingle).not.toHaveBeenCalled()
    })
})

describe('EnrollmentTransferQueryService single lesson transfer history', () => {
    it('queries the protected RPC and maps its DTO unchanged', async () => {
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
        rpcMock.mockResolvedValue({ data: [row], error: null })

        await expect(EnrollmentTransferQueryService.getSingleLessonTransferHistory('enrollment-1'))
            .resolves.toEqual([row])
        expect(rpcMock).toHaveBeenCalledWith('get_single_lesson_transfer_history', {
            p_enrollment_id: 'enrollment-1'
        })
    })
})
