export interface ProgressGapLesson {
  id: string
  sequence: number
  title: string
}

/** Return only missing catalog lessons strictly between recorded lesson bounds. */
export function findReportProgressGaps(
  lessons: ProgressGapLesson[],
  recordedLessonIds: Iterable<string>,
  selectedLessonId?: string | null,
): ProgressGapLesson[] {
  const recorded = new Set(recordedLessonIds)
  if (selectedLessonId) recorded.add(selectedLessonId)

  const catalog = lessons.filter((lesson) => Boolean(lesson.id)).slice().sort((a, b) => a.sequence - b.sequence)
  const recordedIndexes = catalog
    .map((lesson, index) => recorded.has(lesson.id) ? index : -1)
    .filter((index) => index >= 0)
  if (recordedIndexes.length < 2) return []

  const first = recordedIndexes[0]
  const last = recordedIndexes.at(-1)!
  return catalog.slice(first + 1, last).filter((lesson) => !recorded.has(lesson.id))
}
