import type { ClassOccurrence } from '@/models/ClassOccurrence'

/** How a calendar day relates to a class's lessons. */
export type ClassDayKind = 'held' | 'upcoming' | 'cancelled' | 'none'

/** Report progress for a lesson: every report complete, some, or none yet. */
export type ReportCompletionLevel = 'complete' | 'partial' | 'none'

/**
 * Classifies a date (YYYY-MM-DD) for the class calendar.
 *
 * - `cancelled`: the lesson exists but was cancelled or rescheduled.
 * - `held`: the lesson is today or earlier and was conducted (or completed).
 * - `upcoming`: a lesson exists that has not been held yet, or the schedule
 *   rules plan one on a future date that has not been generated yet.
 * - `none`: no lesson; the calendar disables these days.
 */
export function classifyClassDay(
    date: string,
    today: string,
    occurrences: ClassOccurrence[],
    isPlannedDate: ((date: string) => boolean) | null
): ClassDayKind {
    if (occurrences.length) {
        const active = occurrences.filter(occurrence => occurrence.status !== 'cancelled' && occurrence.status !== 'rescheduled')
        if (!active.length) return 'cancelled'
        const held = active.some(occurrence => occurrence.status === 'completed' || (date <= today && occurrence.isConducted))
        return held ? 'held' : 'upcoming'
    }
    if (date >= today && isPlannedDate?.(date)) return 'upcoming'
    return 'none'
}

/** Summarizes a lesson's report counts; null when the lesson has no reports. */
export function reportCompletionLevel(counts: { total: number; completed: number } | undefined): ReportCompletionLevel | null {
    if (!counts || counts.total === 0) return null
    if (counts.completed >= counts.total) return 'complete'
    return counts.completed > 0 ? 'partial' : 'none'
}
