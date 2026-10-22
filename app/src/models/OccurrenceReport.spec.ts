import { describe, expect, it } from 'vitest'
import { OccurrenceReport } from './OccurrenceReport'

describe('OccurrenceReport.applyDTO', () => {
    it('synchronizes every editable field from the authoritative saved row', () => {
        const report = new OccurrenceReport({
            id: 'report-1',
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'occurrence-1',
            content: 'old',
            version: 1
        })

        report.applyDTO({
            id: 'report-1',
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'occurrence-1',
            lesson_id: 'lesson-2',
            is_completed: true,
            progress_letter: 'B-D',
            attendance_status: 'present',
            absence_reason: '',
            class_participation: 4.5,
            classroom_behavior: 5,
            contact_notes: 'contact',
            class_notes: 'class',
            content: 'saved content',
            external_link: 'https://example.com/report',
            version: 2,
            updated_at: '2026-07-17T08:00:00.000Z'
        })

        expect(report).toMatchObject({
            lessonId: 'lesson-2',
            isCompleted: true,
            progressLetter: 'B-D',
            attendanceStatus: 'present',
            classParticipation: 4.5,
            classroomBehavior: 5,
            contactNotes: 'contact',
            classNotes: 'class',
            content: 'saved content',
            externalLink: 'https://example.com/report',
            version: 2
        })
        expect(report.updatedAt?.toISOString()).toBe('2026-07-17T08:00:00.000Z')
    })
})

describe('OccurrenceReport source identity', () => {
    it('keeps the read-only source identity through a DTO round trip', () => {
        const report = new OccurrenceReport({
            enrollment_id: 'e1', class_occurrence_id: 'o1', content: '', version: 1,
            source_origin: 'https://corp.orangeapple.co', source_admission_id: '123', source_report_id: '456',
        })
        const copy = new OccurrenceReport(report.toDTO())
        expect(copy.sourceOrigin).toBe('https://corp.orangeapple.co')
        expect(copy.sourceAdmissionId).toBe('123')
        expect(copy.sourceReportId).toBe('456')
    })

    it('defaults to no source identity for reports created in EduLog', () => {
        const report = new OccurrenceReport({ enrollment_id: 'e1', class_occurrence_id: 'o1', content: '', version: 1 })
        expect(report.sourceReportId).toBeNull()
    })
})
