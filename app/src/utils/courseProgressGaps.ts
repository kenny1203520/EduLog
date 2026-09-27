export interface OrderedLesson {
    id: string
    sequence: number
    title: string
}

/** Find missing catalog lessons strictly between the first and last recorded lessons. */
export function findCourseProgressGaps(lessons: OrderedLesson[], recordedLessonIds: Iterable<string>, selectedLessonId?: string | null): OrderedLesson[] {
    const recorded = new Set(recordedLessonIds)
    if (selectedLessonId) recorded.add(selectedLessonId)
    const catalog = lessons
        .filter((lesson) => lesson.id)
        .slice()
        .sort((a, b) => a.sequence - b.sequence)
    const recordedIndexes = catalog
        .map((lesson, index) => recorded.has(lesson.id) ? index : -1)
        .filter((index) => index >= 0)
    if (recordedIndexes.length < 2) return []
    const first = recordedIndexes[0]
    const last = recordedIndexes.at(-1)!
    return catalog.slice(first, last + 1).filter((lesson, offset) => !recorded.has(lesson.id) && first + offset > first)
}
