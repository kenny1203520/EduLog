import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { ReportCommandService, toReportPatch } from './ReportCommandService'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/services/api/ApiV1Client')>()),
    apiV1Client: { post: postMock },
}))

const report = {
    id: 'r1', enrollment_id: 'e1', class_occurrence_id: 'o1', version: 3,
    created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
    last_edited_at: '2026-10-20T00:00:00Z', last_edited_by: 'u1',
    lesson_id: 'l1', is_completed: true, progress_letter: 'C-E', attendance_status: 'present', absence_reason: '',
    class_participation: 4, classroom_behavior: 3, content: '內容', content_document: null,
    contact_notes: '聯絡', contact_notes_document: null, class_notes: '筆記', class_notes_document: null, external_link: null,
} as unknown as OccurrenceReportDTO

describe('ReportCommandService.resolveConflict', () => {
    beforeEach(() => {
        postMock.mockReset()
        postMock.mockResolvedValue({ data: { ...report, version: 5 } })
    })

    it('sends only the editable fields the API accepts', async () => {
        await ReportCommandService.resolveConflict('r1', report, 'u1', 4)

        const [url, body] = postMock.mock.calls[0]
        expect(url).toBe('/reports/r1/conflicts/resolve')
        expect(body.expected_version).toBe(4)
        expect(Object.keys(body.report).sort()).toEqual([
            'absence_reason', 'attendance_status', 'class_notes', 'class_notes_document', 'class_participation',
            'classroom_behavior', 'contact_notes', 'contact_notes_document', 'content', 'content_document',
            'external_link', 'is_completed', 'lesson_id', 'progress_letter',
        ])
    })

    it('leaves out fields the resolved report does not carry', () => {
        expect(toReportPatch({ content: 'x' } as OccurrenceReportDTO)).toEqual({ content: 'x' })
    })
})
