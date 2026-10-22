/**
 * Read model for where an enrollment was taught over time: its class history
 * segments, the class transfer log, single-lesson transfers (make-ups) and
 * the class each report was written in.
 */

/** Where a report sits relative to the student's class history on its date. */
export type ReportPlacement = 'regular' | 'makeup_in' | 'retained_after_transfer' | 'outside'

export const REPORT_PLACEMENTS: readonly ReportPlacement[] = ['regular', 'makeup_in', 'retained_after_transfer', 'outside']

export interface ClassTimelineSegment {
    class_session_id: string
    class_session_name: string | null
    classroom_id: string | null
    effective_from: string
    effective_to: string | null
}

export interface ClassTimelineReportChange {
    report_id: string
    action: 'moved' | 'retained' | 'created' | 'deleted'
    from_occurrence_id: string | null
    to_occurrence_id: string | null
    from_date: string | null
    to_date: string | null
}

export interface ClassTimelineTransfer {
    id: string
    from_class_session_id: string | null
    from_class_session_name: string | null
    to_class_session_id: string | null
    to_class_session_name: string | null
    effective_date: string
    note: string | null
    source: 'transfer' | 'migrated'
    report_changes: ClassTimelineReportChange[]
    created_by: string | null
    created_at: string
}

export interface ClassTimelineLessonTransfer {
    id: string
    source_occurrence_id: string
    source_date: string
    source_class_session_id: string
    target_occurrence_id: string
    target_date: string
    target_class_session_id: string
    target_class_session_name: string | null
    created_at: string
}

export interface ClassTimelineReport {
    id: string
    occurrence_id: string
    occurrence_date: string
    class_session_id: string
    class_session_name: string | null
    is_completed: boolean | null
    is_blank: boolean
    placement: ReportPlacement
}

export interface ClassTimelineData {
    enrollment_id: string
    segments: ClassTimelineSegment[]
    transfers: ClassTimelineTransfer[]
    lesson_transfers: ClassTimelineLessonTransfer[]
    reports: ClassTimelineReport[]
}

export type RosterFlagKind = 'makeup_in' | 'makeup_out' | 'transfer_in'

export interface RosterFlag {
    date: string
    enrollment_id: string
    student_id: string | null
    student_name: string | null
    flag: RosterFlagKind
}

export interface RosterFlagCount {
    makeupIn: number
    transferIn: number
}

/** Students who joined a class on each date (make-ups in and class transfers in); dates with neither are left out. */
export function countJoinFlagsByDate(flags: RosterFlag[]): Record<string, RosterFlagCount> {
    const counts: Record<string, RosterFlagCount> = {}
    for (const flag of flags) {
        if (flag.flag === 'makeup_out') continue
        const entry = counts[flag.date] ?? { makeupIn: 0, transferIn: 0 }
        if (flag.flag === 'makeup_in') entry.makeupIn++
        else entry.transferIn++
        counts[flag.date] = entry
    }
    return counts
}

/** Number of palette slots used by classColorIndex. */
export const CLASS_COLOR_COUNT = 6

/** A stable palette slot for a class, so the same class keeps its colour everywhere. */
export function classColorIndex(classSessionId: string, order: string[]): number {
    const position = order.indexOf(classSessionId)
    if (position >= 0) return position % CLASS_COLOR_COUNT
    let hash = 0
    for (const char of classSessionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return hash % CLASS_COLOR_COUNT
}

function dayNumber(date: string): number {
    return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000)
}

export interface TimelineLayoutSegment extends ClassTimelineSegment {
    /** Left edge and width in percent of the timeline. */
    left: number
    width: number
    colorIndex: number
}

export interface TimelineLayoutPoint<T> {
    item: T
    left: number
}

export interface TimelineLayout {
    start: string
    end: string
    segments: TimelineLayoutSegment[]
    reports: Array<TimelineLayoutPoint<ClassTimelineReport>>
    transfers: Array<TimelineLayoutPoint<ClassTimelineTransfer>>
}

/**
 * Positions the segments, reports and transfer markers on one horizontal axis
 * from the first segment (or report) to the later of `today` and the last
 * report. Open segments run to the end of the axis.
 */
export function layoutTimeline(data: ClassTimelineData, today: string): TimelineLayout {
    const dates = [
        ...data.segments.map(segment => segment.effective_from),
        ...data.reports.map(report => report.occurrence_date),
    ]
    const ends = [
        today,
        ...data.segments.map(segment => segment.effective_to).filter((value): value is string => Boolean(value)),
        ...data.reports.map(report => report.occurrence_date),
    ]
    const start = dates.length ? dates.reduce((min, value) => value < min ? value : min) : today
    const end = ends.reduce((max, value) => value > max ? value : max)
    const first = dayNumber(start)
    const span = Math.max(dayNumber(end) - first + 1, 1)
    const position = (date: string) => Math.min(Math.max(((dayNumber(date) - first) / span) * 100, 0), 100)
    const order = [...new Set(data.segments.map(segment => segment.class_session_id))]

    return {
        start,
        end,
        segments: data.segments.map(segment => {
            const left = position(segment.effective_from)
            const right = segment.effective_to ? ((dayNumber(segment.effective_to) - first + 1) / span) * 100 : 100
            return { ...segment, left, width: Math.max(Math.min(right, 100) - left, 0.5), colorIndex: classColorIndex(segment.class_session_id, order) }
        }),
        reports: data.reports.map(report => ({ item: report, left: position(report.occurrence_date) })),
        transfers: data.transfers
            .filter(transfer => transfer.source === 'transfer' || transfer.source === 'migrated')
            .map(transfer => ({ item: transfer, left: position(transfer.effective_date) })),
    }
}

/** The class an enrollment belonged to on a date, from its history segments. */
export function segmentOn(segments: ClassTimelineSegment[], date: string): ClassTimelineSegment | null {
    return segments.find(segment => segment.effective_from <= date && (!segment.effective_to || segment.effective_to >= date)) ?? null
}
