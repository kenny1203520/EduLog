import { describe, expect, it } from 'vitest'
import { findReportProgressGaps } from './reportProgressGaps.js'

const lessons = Array.from({ length: 12 }, (_, index) => ({
  id: `lesson-${index + 1}`,
  sequence: index + 1,
  title: `Lesson ${index + 1}`,
}))

describe('findReportProgressGaps', () => {
  it('does not report gaps outside the first and last recorded lessons', () => {
    expect(findReportProgressGaps(lessons, lessons.slice(3).map((lesson) => lesson.id))).toEqual([])
  })

  it('reports missing catalog lessons between recorded lessons', () => {
    expect(findReportProgressGaps(lessons, [
      ...lessons.slice(3, 5).map((lesson) => lesson.id),
      ...lessons.slice(6).map((lesson) => lesson.id),
    ])).toEqual([lessons[5]])
    expect(findReportProgressGaps(lessons, [
      ...lessons.slice(0, 5).map((lesson) => lesson.id),
      ...lessons.slice(6).map((lesson) => lesson.id),
    ])).toEqual([lessons[5]])
  })

  it('uses the current report lesson to close a gap without counting future reports', () => {
    expect(findReportProgressGaps(lessons, ['lesson-4', 'lesson-5', 'lesson-7', 'lesson-8'], 'lesson-6')).toEqual([])
  })
})
