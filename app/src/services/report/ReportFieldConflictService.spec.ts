import { describe, expect, it } from 'vitest'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import {
    createDefaultTransferFieldSelections,
    findReportConflictingFields,
    isReportValueEmpty,
    transferFieldDiffers
} from './ReportFieldConflictService'

function report(overrides: Partial<OccurrenceReportDTO> = {}): OccurrenceReportDTO {
    return {
        enrollment_id: 'enrollment-1',
        class_occurrence_id: 'occurrence-1',
        content: '',
        version: 1,
        ...overrides
    }
}

describe('ReportFieldConflictService', () => {
    it('shares exact field conflict detection with the report editor', () => {
        const source = report({ content: 'source', attendance_status: 'present' })
        const target = report({ content: 'target', attendance_status: 'absent' })

        expect(findReportConflictingFields(source, target)).toEqual(
            expect.arrayContaining(['content', 'attendance_status'])
        )
    })

    it('keeps target values when the source field is empty', () => {
        const selections = createDefaultTransferFieldSelections(
            report({
                content: '',
                content_document: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
                external_link: undefined
            }),
            report({ content: 'target content', external_link: 'https://example.com' })
        )

        expect(selections.content).toBe('target')
        expect(selections.external_link).toBe('target')
    })

    it('defaults populated source fields to overwrite, including false and zero', () => {
        const source = report({ is_completed: false, class_participation: 0, content: 'source' })
        const selections = createDefaultTransferFieldSelections(source, report({ content: 'target' }))

        expect(isReportValueEmpty(false)).toBe(false)
        expect(isReportValueEmpty(0)).toBe(false)
        expect(selections.is_completed).toBe('source')
        expect(selections.class_participation).toBe('source')
        expect(selections.content).toBe('source')
    })

    it('compares attendance reason and rich-text documents as logical fields', () => {
        const source = report({
            attendance_status: 'absent',
            absence_reason: 'sick',
            content: 'same',
            content_document: { type: 'doc', content: [] }
        })
        const target = report({
            attendance_status: 'absent',
            absence_reason: 'travel',
            content: 'same',
            content_document: { type: 'doc', content: [{ type: 'paragraph' }] }
        })

        expect(transferFieldDiffers(source, target, 'attendance')).toBe(true)
        expect(transferFieldDiffers(source, target, 'content')).toBe(true)
    })
})
