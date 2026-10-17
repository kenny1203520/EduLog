import { describe, expect, it } from 'vitest'
import { paginateTeacherAssignments, partitionTeacherAssignments } from './teacherAssignmentHistory'

describe('teacher assignment history', () => {
    const assignments = [
        { teacher_id: 'current', effective_from: '2026-01-01', effective_to: null },
        { teacher_id: 'future', effective_from: '2026-10-01', effective_to: null },
        { teacher_id: 'past-old', effective_from: '2024-01-01', effective_to: '2024-12-31' },
        { teacher_id: 'past-new', effective_from: '2025-01-01', effective_to: '2025-12-31' }
    ]

    it('separates current and future records from history without dropping assignments', () => {
        const result = partitionTeacherAssignments(assignments, '2026-09-23')
        expect(result.currentAndUpcoming.map(({ config }) => config.teacher_id)).toEqual(['current', 'future'])
        expect(result.past.map(({ config }) => config.teacher_id)).toEqual(['past-new', 'past-old'])
        expect([...result.currentAndUpcoming, ...result.past]).toHaveLength(assignments.length)
    })

    it('paginates independently while retaining source indices for edits', () => {
        const entries = Array.from({ length: 21 }, (_, index) => ({ index, config: { effective_from: `2026-${String(index + 1).padStart(2, '0')}-01` } }))
        const first = paginateTeacherAssignments(entries, 1)
        const last = paginateTeacherAssignments(entries, 3)
        expect(first.items).toHaveLength(10)
        expect(first.pageCount).toBe(3)
        expect(last.items.map(item => item.index)).toEqual([20])
        expect(paginateTeacherAssignments(entries, 9).page).toBe(3)
    })
})
