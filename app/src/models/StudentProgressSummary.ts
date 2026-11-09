import type { Enrollment } from '@/models/Enrollment'
import type { Lesson } from '@/models/Course'
import type { OccurrenceReport } from '@/models/OccurrenceReport'

type Translate = (key: string) => string

export type ProgressTone = 'completed' | 'incomplete' | 'empty'

export interface StudentProgressSummary {
    currentCourse: string
    highestProgressTitle: string
    highestProgressStatus: string
    highestProgressTone: ProgressTone
    latestProgressTitle: string
    latestProgressStatus: string
    latestProgressTone: ProgressTone
}

export interface TodayCourseSummary {
    title: string
    chapterProgress: string
    completionStatus: string
    tone: ProgressTone
    hasRecord: boolean
}

export function getDefaultProgressSummary(t: Translate): StudentProgressSummary {
    return {
        currentCourse: t('classroom.progress_no_record'),
        highestProgressTitle: t('classroom.progress_no_record'),
        highestProgressStatus: t('classroom.progress_no_record'),
        highestProgressTone: 'empty',
        latestProgressTitle: t('classroom.progress_no_record'),
        latestProgressStatus: t('classroom.progress_no_record'),
        latestProgressTone: 'empty'
    }
}

function getLessonTitle(t: Translate, lessons: Lesson[], sequence?: number, fallbackLessonId?: string): string {
    if (fallbackLessonId) {
        const byId = lessons.find(lesson => lesson.id === fallbackLessonId)
        if (byId) {
            return byId.title
        }
    }

    if (sequence === undefined || sequence === null) {
        return t('classroom.progress_no_record')
    }

    const bySequence = lessons.find(lesson => lesson.sequence === sequence)
    if (bySequence) {
        return bySequence.title
    }

    return `${t('report.lesson_label')} ${sequence}`
}

export function formatLessonHeading(sequence: number | undefined, title: string): string {
    if (sequence === undefined || sequence === null) {
        return title
    }

    return `L${sequence} ${title}`
}

function formatProgressStatus(t: Translate, report?: OccurrenceReport | null): string {
    if (!report) {
        return t('classroom.progress_no_record')
    }

    return report.isCompleted ? t('classroom.progress_completed') : t('classroom.progress_incomplete')
}

function getProgressTone(report?: OccurrenceReport | null): ProgressTone {
    if (!report) {
        return 'empty'
    }

    return report.isCompleted ? 'completed' : 'incomplete'
}

function formatProgressRange(t: Translate, report?: OccurrenceReport | null): string {
    if (!report) {
        return t('classroom.progress_no_record')
    }

    const range = report.progressLetter ? report.progressLetter : ''
    return range ? `${range} · ${formatProgressStatus(t, report)}` : formatProgressStatus(t, report)
}

function getReportDate(report: OccurrenceReport): Date | undefined {
    return report.occurrenceDate || report.createdAt || report.updatedAt
}

function getReportTimestamp(report: OccurrenceReport): number {
    const reportDate = getReportDate(report)
    return reportDate ? reportDate.getTime() : Number.MIN_SAFE_INTEGER
}

/** Start of the class week that contains `date`, anchored on the class weekday. */
export function getCycleStart(date: Date, classDayOfWeek?: number): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    if (classDayOfWeek === undefined) return d

    const currentDay = d.getDay()
    const diff = (currentDay - classDayOfWeek + 7) % 7
    d.setDate(d.getDate() - diff)
    return d
}

export function getCycleEnd(date: Date, classDayOfWeek?: number): Date {
    const start = getCycleStart(date, classDayOfWeek)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return end
}

export function pickHighestProgressReport(
    reportsAtHighestLesson: OccurrenceReport[]
): OccurrenceReport | undefined {
    if (reportsAtHighestLesson.length === 0) {
        return undefined
    }

    return [...reportsAtHighestLesson].sort((left, right) => {
        // 1. Completion status takes priority
        const completedDiff = Number(right.isCompleted === true) - Number(left.isCompleted === true)
        if (completedDiff !== 0) {
            return completedDiff
        }

        // 2. Further progress letter (end progress or start if no end)
        const endR = right.progressEnd || right.progressStart || ''
        const endL = left.progressEnd || left.progressStart || ''
        const progressDiff = endR.localeCompare(endL)
        if (progressDiff !== 0) {
            return progressDiff
        }

        // 3. Most recent record as final tie-break
        return getReportTimestamp(right) - getReportTimestamp(left)
    })[0]
}

export function buildStudentProgressSummary(
    t: Translate,
    enrollment: Enrollment,
    reports: OccurrenceReport[],
    lessons: Lesson[],
    referenceDate: Date = new Date()
): StudentProgressSummary {
    const currentCourse = enrollment.displayName || enrollment.courseDisplayName || [enrollment.courseSubject, enrollment.courseStage].filter(Boolean).join(' ')
    const lessonSequenceById = new Map(
        lessons
            .filter(lesson => !!lesson.id)
            .map(lesson => [lesson.id as string, lesson.sequence])
    )

    const cycleStart = getCycleStart(referenceDate, enrollment.classSessionDayOfWeek)
    const cycleEnd = getCycleEnd(referenceDate, enrollment.classSessionDayOfWeek)

    // Filter reports for context: only include those up to the end of the selected week
    const contextualReports = reports.filter(report => {
        const reportDate = getReportDate(report)
        return reportDate ? reportDate < cycleEnd : false
    })

    const reportsWithLesson = contextualReports.filter(report => {
        if (!report.lessonId) {
            return false
        }

        return lessonSequenceById.has(report.lessonId)
    })

    let highestLessonNumber: number | undefined
    if (reportsWithLesson.length > 0) {
        highestLessonNumber = reportsWithLesson.reduce((maxSequence, report) => {
            const sequence = report.lessonId ? lessonSequenceById.get(report.lessonId) : undefined
            if (sequence === undefined) {
                return maxSequence
            }
            return Math.max(maxSequence, sequence)
        }, Number.MIN_SAFE_INTEGER)

        if (highestLessonNumber === Number.MIN_SAFE_INTEGER) {
            highestLessonNumber = undefined
        }
    }

    const highestLesson = getLessonTitle(t, lessons, highestLessonNumber)
    const highestLessonId = lessons.find(lesson => lesson.sequence === highestLessonNumber)?.id
    const highestLessonReports = highestLessonId
        ? reportsWithLesson.filter(report => report.lessonId === highestLessonId)
        : []
    const highestReport = pickHighestProgressReport(highestLessonReports)

    const reportsByOccurrenceDate = [...contextualReports].sort((left, right) => getReportTimestamp(right) - getReportTimestamp(left))

    // Find last attended report before the selected week
    const historicalReports = reportsByOccurrenceDate.filter(report => {
        const reportDate = getReportDate(report)
        return reportDate ? reportDate < cycleStart : false
    })
    const latestAttendedReport = historicalReports.find(report => report.attendanceStatus === 'present')
    const latestLesson = latestAttendedReport?.lessonId ? lessons.find(lesson => lesson.id === latestAttendedReport.lessonId) : undefined

    return {
        currentCourse: currentCourse || t('classroom.progress_no_record'),
        highestProgressTitle: formatLessonHeading(highestLessonNumber, highestLesson),
        highestProgressStatus: formatProgressRange(t, highestReport),
        highestProgressTone: getProgressTone(highestReport),
        latestProgressTitle: latestAttendedReport
            ? formatLessonHeading(latestLesson?.sequence, getLessonTitle(t, lessons, undefined, latestAttendedReport?.lessonId))
            : t('classroom.progress_no_record'),
        latestProgressStatus: formatProgressRange(t, latestAttendedReport),
        latestProgressTone: getProgressTone(latestAttendedReport)
    }
}

/** The card summary for the selected occurrence's own report. */
export function buildTodayCourseSummary(
    t: Translate,
    report: OccurrenceReport | null | undefined,
    lessons: Lesson[]
): TodayCourseSummary {
    if (!report) {
        return {
            title: t('classroom.no_today_course_record'),
            chapterProgress: t('classroom.progress_no_record'),
            completionStatus: t('classroom.progress_no_record'),
            tone: 'empty',
            hasRecord: false
        }
    }

    const lesson = report.lessonId ? lessons.find(item => item.id === report.lessonId) : undefined
    const lessonTitle = lesson
        ? formatLessonHeading(lesson.sequence, lesson.title)
        : t('classroom.progress_no_record')

    return {
        title: lessonTitle,
        chapterProgress: report.progressLetter || t('classroom.progress_no_record'),
        completionStatus: formatProgressStatus(t, report),
        tone: getProgressTone(report),
        hasRecord: true
    }
}
