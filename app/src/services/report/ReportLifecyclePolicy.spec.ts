import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { isFinalCompletedLesson } from './ReportLifecyclePolicy'

describe('ReportLifecyclePolicy final lesson completion', () => {
    it('completes only when a fully completed report references the highest-sequence lesson', () => {
        expect(isFinalCompletedLesson(true, 'lesson-final', 'lesson-final')).toBe(true)
        expect(isFinalCompletedLesson(false, 'lesson-final', 'lesson-final')).toBe(false)
        expect(isFinalCompletedLesson(true, 'lesson-before-final', 'lesson-final')).toBe(false)
        expect(isFinalCompletedLesson(true, null, 'lesson-final')).toBe(false)
    })

    it('does not depend on a chapter or progress-letter value', () => {
        const report = { is_completed: true, lesson_id: 'lesson-final', progress_letter: null, chapter: null }
        expect(isFinalCompletedLesson(report.is_completed, report.lesson_id, 'lesson-final')).toBe(true)
    })
})
