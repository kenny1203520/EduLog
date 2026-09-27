import { describe, expect, it } from 'vitest'
import { findCourseProgressGaps } from './courseProgressGaps'

const lessons = Array.from({ length: 12 }, (_, index) => ({ id: `lesson-${index + 1}`, sequence: index + 1, title: `Lesson ${index + 1}` }))
const ids = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => `lesson-${start + index}`)

describe('findCourseProgressGaps', () => {
    it('does not report unrecorded lessons before or after the recorded range', () => {
        expect(findCourseProgressGaps(lessons, ids(4, 12))).toEqual([])
    })

    it('reports a missing lesson inside a recorded range', () => {
        expect(findCourseProgressGaps(lessons, [...ids(4, 5), ...ids(7, 12)]).map((lesson) => lesson.sequence)).toEqual([6])
        expect(findCourseProgressGaps(lessons, [...ids(1, 5), ...ids(7, 12)]).map((lesson) => lesson.sequence)).toEqual([6])
    })

    it('counts the editor selection and ignores report lesson IDs outside the catalog', () => {
        expect(findCourseProgressGaps(lessons, ['not-in-course'], 'lesson-6')).toEqual([])
        expect(findCourseProgressGaps(lessons, [...ids(4, 5), ...ids(7, 12)], 'lesson-6')).toEqual([])
    })
})
