import { describe, expect, it } from 'vitest'
import {
    buildStudentProgressSummary,
    buildTodayCourseSummary,
    getCycleEnd,
    getCycleStart,
    pickHighestProgressReport,
} from './StudentProgressSummary'
import type { Enrollment } from './Enrollment'
import type { Lesson } from './Course'
import type { OccurrenceReport } from './OccurrenceReport'

const t = (key: string) => key
const lessons = [
    { id: 'l1', sequence: 1, title: 'Intro' },
    { id: 'l2', sequence: 2, title: 'Loops' },
] as Lesson[]
const enrollment = { id: 'e1', courseDisplayName: 'Python 1', classSessionDayOfWeek: 3 } as Enrollment
const report = (overrides: Partial<OccurrenceReport>) => ({
    isCompleted: false,
    attendanceStatus: 'present',
    ...overrides,
}) as OccurrenceReport

describe('student progress summary', () => {
    it('anchors the class week on the class weekday', () => {
        // 2026-11-07 is a Saturday; the Wednesday class week started 2026-11-04.
        const start = getCycleStart(new Date(2026, 10, 7, 15), 3)
        expect(start).toEqual(new Date(2026, 10, 4))
        expect(getCycleEnd(new Date(2026, 10, 7), 3)).toEqual(new Date(2026, 10, 11))
    })

    it('prefers a completed report, then further progress, then the newest', () => {
        const older = report({ id: 'a', isCompleted: true, progressEnd: 'B', occurrenceDate: new Date(2026, 0, 1) })
        const newer = report({ id: 'b', isCompleted: true, progressEnd: 'B', occurrenceDate: new Date(2026, 0, 8) })
        const further = report({ id: 'c', isCompleted: true, progressEnd: 'C', occurrenceDate: new Date(2025, 0, 1) })
        const incomplete = report({ id: 'd', isCompleted: false, progressEnd: 'Z', occurrenceDate: new Date(2026, 5, 1) })
        expect(pickHighestProgressReport([older, newer])?.id).toBe('b')
        expect(pickHighestProgressReport([older, further, incomplete])?.id).toBe('c')
        expect(pickHighestProgressReport([])).toBeUndefined()
    })

    it('summarizes the highest lesson and the last attended lesson before the selected week', () => {
        const reports = [
            report({ lessonId: 'l1', isCompleted: true, progressLetter: 'A-C', occurrenceDate: new Date(2026, 9, 28) }),
            report({ lessonId: 'l2', isCompleted: false, progressLetter: 'A', occurrenceDate: new Date(2026, 10, 4) }),
            // After the selected week: ignored.
            report({ lessonId: 'l2', isCompleted: true, occurrenceDate: new Date(2026, 10, 18) }),
        ]
        const summary = buildStudentProgressSummary(t, enrollment, reports, lessons, new Date(2026, 10, 4))
        expect(summary).toEqual({
            currentCourse: 'Python 1',
            highestProgressTitle: 'L2 Loops',
            highestProgressStatus: 'A · classroom.progress_incomplete',
            highestProgressTone: 'incomplete',
            latestProgressTitle: 'L1 Intro',
            latestProgressStatus: 'A-C · classroom.progress_completed',
            latestProgressTone: 'completed',
        })
    })

    it('falls back to "no record" without reports', () => {
        const summary = buildStudentProgressSummary(t, enrollment, [], lessons, new Date(2026, 10, 4))
        expect(summary.highestProgressTitle).toBe('classroom.progress_no_record')
        expect(summary.latestProgressTone).toBe('empty')
    })

    it('describes the selected occurrence report for the card', () => {
        expect(buildTodayCourseSummary(t, null, lessons)).toMatchObject({ hasRecord: false, tone: 'empty' })
        expect(buildTodayCourseSummary(t, report({ lessonId: 'l2', isCompleted: true, progressLetter: 'B' }), lessons)).toEqual({
            title: 'L2 Loops',
            chapterProgress: 'B',
            completionStatus: 'classroom.progress_completed',
            tone: 'completed',
            hasRecord: true,
        })
    })
})
