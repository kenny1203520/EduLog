import { describe, expect, it } from 'vitest'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { TransferConflictDisplayContext } from '@/services/enrollment/EnrollmentTransferQueryService'
import { TransferReportConflictDisplayService } from './TransferReportConflictDisplayService'

const t = (key: string) => ({
    'report.completed': '已完成',
    'report.incomplete': '未完成',
    'report.editor.present': '出席',
    'report.editor.absent': '未出席',
    'report.editor.absence_reasons.sick_or_injured': '生病／受傷',
    'student.transfer_conflict.not_filled': '未填寫'
}[key] || key)

const context: TransferConflictDisplayContext = {
    occurrenceId: 'occurrence-id',
    occurrenceDate: '2026-08-03',
    startTime: '10:00:00',
    endTime: '11:00:00',
    sessionId: 'session-id',
    sessionName: '週一進階班',
    sessionTimeZone: 'Asia/Taipei',
    classroomId: 'classroom-id',
    classroomName: '101 教室',
    lessonId: 'lesson-id',
    lessonSequence: 3,
    lessonTitle: '分數加法'
}

function report(overrides: Partial<OccurrenceReportDTO> = {}): OccurrenceReportDTO {
    return {
        id: 'report-id',
        enrollment_id: 'enrollment-id',
        class_occurrence_id: 'occurrence-id',
        content: '',
        version: 1,
        ...overrides
    }
}

describe('TransferReportConflictDisplayService', () => {
    it('formats lesson and class context without exposing UUIDs', () => {
        const heading = TransferReportConflictDisplayService.formatContext(context, 'zh-TW', 'Asia/Taipei', t)
        expect(heading.title).toContain('週一進階班')
        expect(heading.details).toContain('101 教室')
        expect(heading.title + heading.details).not.toContain('occurrence-id')
        expect(TransferReportConflictDisplayService.formatLesson(context, t)).toBe('#3 分數加法')
    })

    it('localizes status and absence reason values', () => {
        expect(TransferReportConflictDisplayService.formatField(report({ is_completed: true }), context, 'is_completed', t))
            .toMatchObject({ kind: 'text', text: '已完成', tone: 'success' })
        expect(TransferReportConflictDisplayService.formatField(report({
            attendance_status: 'absent', absence_reason: 'sick_or_injured'
        }), context, 'attendance', t)).toMatchObject({ text: '未出席 · 生病／受傷', tone: 'danger' })
    })

    it('formats ratings, progress, links, rich content, and empty values', () => {
        expect(TransferReportConflictDisplayService.formatField(report({ class_participation: 4 }), context, 'class_participation', t))
            .toMatchObject({ kind: 'rating', rating: 4, text: '4/5' })
        expect(TransferReportConflictDisplayService.formatField(report({ progress_letter: 'A-C' }), context, 'progress_letter', t))
            .toMatchObject({ text: 'A → C' })
        expect(TransferReportConflictDisplayService.formatField(report({ external_link: 'https://example.com/reports/1' }), context, 'external_link', t))
            .toMatchObject({ kind: 'link', text: 'example.com', detail: '/reports/1' })
        expect(TransferReportConflictDisplayService.formatField(report({ content: 'Readable content' }), context, 'content', t))
            .toMatchObject({ kind: 'rich', content: 'Readable content' })
        expect(TransferReportConflictDisplayService.formatField(report(), context, 'content', t))
            .toMatchObject({ kind: 'text', text: '未填寫' })
    })
})
