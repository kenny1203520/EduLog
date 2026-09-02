import { describe, expect, it } from 'vitest'
import { mergeReportConflict } from './ReportConflictMerge'
import type { OccurrenceReportDTO, ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { createTextEditorContent } from '@/components/common/text-editor/content'

const text = (value: string) => createTextEditorContent(value)
const base: ReportDraftSnapshot = {
    lessonId: 'lesson-1', isCompleted: false, progressLetter: 'A-B', attendanceStatus: 'present', absenceReason: null,
    classParticipation: 3, classroomBehavior: 3, contactNotes: 'base contact', contactNotesDocument: text('base contact').richText,
    classNotes: 'base class', classNotesDocument: text('base class').richText, content: 'base content', contentDocument: text('base content').richText, externalLink: ''
}
const server = (overrides: Partial<OccurrenceReportDTO> = {}): OccurrenceReportDTO => ({
    id: 'report-1', enrollment_id: 'enrollment-1', class_occurrence_id: 'occurrence-1', lesson_id: base.lessonId,
    is_completed: base.isCompleted, progress_letter: base.progressLetter, attendance_status: base.attendanceStatus,
    absence_reason: base.absenceReason, class_participation: base.classParticipation, classroom_behavior: base.classroomBehavior,
    contact_notes: base.contactNotes, contact_notes_document: base.contactNotesDocument, class_notes: base.classNotes,
    class_notes_document: base.classNotesDocument, content: base.content, content_document: base.contentDocument,
    external_link: base.externalLink, version: 2, ...overrides
})

describe('mergeReportConflict', () => {
    it('merges text when collaboration has already converged and reports metadata conflicts', () => {
        const local = { ...base, content: 'local merged', contentDocument: text('local merged').richText, classParticipation: 5 }
        const result = mergeReportConflict(base, local, server({ content: 'remote text', class_participation: 4 }), true)
        expect(result.payload.content).toBe('local merged')
        expect(result.mergedTextFields).toContain('content')
        expect(result.conflictFields).toContain('classParticipation')
    })

    it('does not silently overwrite concurrent plain-text edits without collaboration', () => {
        const local = { ...base, content: 'local text', contentDocument: text('local text').richText }
        const result = mergeReportConflict(base, local, server({ content: 'remote text' }), false)
        expect(result.payload.content).toBeUndefined()
        expect(result.conflictFields).toContain('content')
    })
})
