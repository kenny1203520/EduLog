import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccurrenceReportDTO, ReportLessonEntryDTO } from '@/models/OccurrenceReport'
import { ReportCommandService, toReportPatch } from './ReportCommandService'

const { patchMock } = vi.hoisted(() => ({ patchMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/api/ApiV1Client')>()
    return {
        ...actual,
        apiV1Client: { ...actual.apiV1Client, patch: patchMock },
    }
})

const entry: ReportLessonEntryDTO = {
    id: 'entry-b',
    enrollment_id: 'enrollment-b',
    course_id: 'course-b',
    course_name: 'Course B',
    lesson_id: 'lesson-b',
    lesson_sequence: 2,
    lesson_title: 'Lesson B2',
    is_completed: false,
    progress_letter: 'B',
}

beforeEach(() => vi.clearAllMocks())

describe('ReportCommandService lesson entry serialization', () => {
    it('sends the complete API lesson-entry schema on a normal report save', async () => {
        patchMock.mockResolvedValueOnce({ data: { version: 5 } })

        const result = await ReportCommandService.saveReport('report-a', 4, undefined, {
            lessonEntries: [entry],
            primaryLessonEntryId: entry.id,
        })

        expect(result.success).toBe(true)
        expect(patchMock).toHaveBeenCalledWith('/reports/report-a', {
            lesson_entries: [{
                id: 'entry-b',
                enrollment_id: 'enrollment-b',
                course_id: 'course-b',
                lesson_id: 'lesson-b',
                is_completed: false,
                progress_letter: 'B',
            }],
            primary_lesson_entry_id: 'entry-b',
            expected_version: 4,
        })
    })

    it('keeps the conflict-resolution patch aligned with the same API schema', () => {
        const report: OccurrenceReportDTO = {
            enrollment_id: 'enrollment-a',
            class_occurrence_id: 'occurrence-a',
            lesson_entries: [entry],
            primary_lesson_entry_id: entry.id,
            content: '',
            version: 5,
        }

        expect(toReportPatch(report)).toMatchObject({
            lesson_entries: [{
                id: 'entry-b', enrollment_id: 'enrollment-b', course_id: 'course-b', lesson_id: 'lesson-b',
                is_completed: false, progress_letter: 'B',
            }],
            primary_lesson_entry_id: 'entry-b',
        })
    })

    it('omits lesson entries for legacy saves that do not include the new field', async () => {
        patchMock.mockResolvedValueOnce({ data: { version: 6 } })

        await ReportCommandService.saveReport('legacy-report', 5, undefined, { content: 'Legacy single-lesson client' })

        expect(patchMock).toHaveBeenCalledWith('/reports/legacy-report', {
            content: 'Legacy single-lesson client',
            content_document: expect.any(Object),
            expected_version: 5,
        })
        expect(patchMock.mock.calls[0]?.[1]).not.toHaveProperty('lesson_entries')
    })
})
