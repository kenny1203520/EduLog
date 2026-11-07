import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import type { Enrollment } from '@/models/Enrollment'
import type { Lesson } from '@/models/Course'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import type { OccurrenceReport } from '@/models/OccurrenceReport'
import type { ProgressGapHintLesson } from '@/components/classroom/CourseProgressGapHint.vue'
import {
    buildStudentProgressSummary,
    buildTodayCourseSummary,
    getDefaultProgressSummary,
    type StudentProgressSummary,
    type TodayCourseSummary
} from '@/models/StudentProgressSummary'
import { DateUtils } from '@/utils/dateUtils'
import { ReportQueryService } from '@/services/report/ReportQueryService'

interface StudentProgressSource {
    todayOccurrence: Ref<any>
    selectedDateKey: Ref<string | null>
    enrollments: Ref<Enrollment[]>
    reportMap: Ref<Map<string, any>>
}

/**
 * Per-student course progress for the roster cards: the lesson catalog cache,
 * highest/latest progress summaries and the course progress gap check.
 */
export function useStudentProgress(source: StudentProgressSource) {
    const { t } = useI18n()
    const { todayOccurrence, selectedDateKey, enrollments, reportMap } = source

    const courseLessonsByCourseId = ref<Record<string, Lesson[]>>({})
    const studentProgressSummaries = ref<Record<string, StudentProgressSummary>>({})
    const studentProgressGaps = ref<Record<string, ProgressGapHintLesson[]>>({})
    const isLoadingProgressGaps = ref(false)
    const progressGapCheckFailed = ref(false)
    let progressGapRequestGeneration = 0
    let progressSummaryRequestGeneration = 0
    let lessonLoadPromises = new Map<string, Promise<Lesson[]>>()

    function getLessonsForCourse(courseId: string, options: { refresh?: boolean } = {}): Promise<Lesson[]> {
        const cachedLessons = courseLessonsByCourseId.value[courseId]
        if (cachedLessons && !options.refresh) {
            return Promise.resolve(cachedLessons)
        }

        const pending = lessonLoadPromises.get(courseId)
        if (pending) return pending

        const request = CourseCatalogService.getLessonsByCourse(courseId).then(lessons => {
            courseLessonsByCourseId.value = {
                ...courseLessonsByCourseId.value,
                [courseId]: lessons
            }
            return lessons
        }).finally(() => {
            if (lessonLoadPromises.get(courseId) === request) lessonLoadPromises.delete(courseId)
        })
        lessonLoadPromises.set(courseId, request)
        return request
    }

    function cachedLessonsFor(courseId: string | undefined): Lesson[] {
        return (courseId && courseLessonsByCourseId.value[courseId]) || []
    }

    async function loadStudentProgressSummaries(
        enrollmentList: Enrollment[],
        mode: 'replace' | 'merge' = 'replace',
        referenceDate: Date = todayOccurrence.value?.occurrenceDate || new Date(),
        options: { loadMissingLessons?: boolean } = {}
    ) {
        const generation = ++progressSummaryRequestGeneration
        const requestedDate = DateUtils.formatLocalDate(referenceDate)
        const uniqueCourseIds = [...new Set(enrollmentList.map(enrollment => enrollment.courseId).filter(Boolean))]
        if (options.loadMissingLessons !== false) {
            await Promise.all(uniqueCourseIds.map(courseId => getLessonsForCourse(courseId)))
        }

        const enrollmentIds = enrollmentList.map(enrollment => enrollment.id).filter((id): id is string => !!id)
        // One request for the whole roster instead of one paginated, full-row
        // request per student -- see getProgressSummaryReportsByEnrollments.
        const reportsByEnrollment = await ReportQueryService.getProgressSummaryReportsByEnrollments(enrollmentIds)

        const summaryEntries = await Promise.all(enrollmentList.map(async enrollment => {
            if (!enrollment.id) {
                return [enrollment.id, getDefaultProgressSummary(t)] as const
            }

            const lessons = options.loadMissingLessons === false
                ? courseLessonsByCourseId.value[enrollment.courseId] || []
                : await getLessonsForCourse(enrollment.courseId)
            const reports = reportsByEnrollment.get(enrollment.id) || []
            return [enrollment.id, buildStudentProgressSummary(t, enrollment, reports, lessons, referenceDate)] as const
        }))

        const nextSummaries = Object.fromEntries(summaryEntries.filter(([id]) => !!id)) as Record<string, StudentProgressSummary>

        if (generation !== progressSummaryRequestGeneration
            || (selectedDateKey.value && selectedDateKey.value !== requestedDate)) return

        if (mode === 'merge') {
            studentProgressSummaries.value = {
                ...studentProgressSummaries.value,
                ...nextSummaries
            }
            return
        }

        studentProgressSummaries.value = nextSummaries
    }

    async function loadStudentProgressGaps(
        enrollmentList: Enrollment[],
        occurrence: ClassOccurrence | null = todayOccurrence.value
    ) {
        const generation = ++progressGapRequestGeneration
        progressGapCheckFailed.value = false
        if (!occurrence?.id || !occurrence.occurrenceDate) {
            isLoadingProgressGaps.value = false
            return
        }

        const occurrenceId = occurrence.id
        const occurrenceDate = DateUtils.formatLocalDate(occurrence.occurrenceDate)
        const enrollmentIds = enrollmentList.map(enrollment => enrollment.id).filter((id): id is string => !!id)
        isLoadingProgressGaps.value = true
        try {
            const summaries = await ReportQueryService.getProgressGapsByEnrollments(occurrenceId, enrollmentIds)
            if (generation !== progressGapRequestGeneration
                || todayOccurrence.value?.id !== occurrenceId
                || DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate) !== occurrenceDate) return
            studentProgressGaps.value = Object.fromEntries(summaries)
        } catch (error) {
            if (generation !== progressGapRequestGeneration) return
            console.error('Failed to check course progress gaps:', error)
            progressGapCheckFailed.value = true
        } finally {
            if (generation === progressGapRequestGeneration) isLoadingProgressGaps.value = false
        }
    }

    function retryStudentProgressGaps() {
        if (!todayOccurrence.value) return
        void loadStudentProgressGaps(enrollments.value, todayOccurrence.value)
    }

    /** Drops summaries and gaps and cancels any in-flight gap check. */
    function clearStudentProgress() {
        studentProgressSummaries.value = {}
        studentProgressGaps.value = {}
        progressGapRequestGeneration++
        isLoadingProgressGaps.value = false
        progressGapCheckFailed.value = false
    }

    function getStudentProgressSummary(enrollmentId?: string): StudentProgressSummary {
        if (!enrollmentId) {
            return getDefaultProgressSummary(t)
        }

        return studentProgressSummaries.value[enrollmentId] || getDefaultProgressSummary(t)
    }

    function getTodayCourseSummary(enrollment: Enrollment): TodayCourseSummary {
        const report = reportMap.value.get(enrollment.id!) as OccurrenceReport | null | undefined
        return buildTodayCourseSummary(t, report, cachedLessonsFor(enrollment.courseId))
    }

    return {
        studentProgressSummaries,
        studentProgressGaps,
        isLoadingProgressGaps,
        progressGapCheckFailed,
        getLessonsForCourse,
        cachedLessonsFor,
        loadStudentProgressSummaries,
        loadStudentProgressGaps,
        retryStudentProgressGaps,
        clearStudentProgress,
        getStudentProgressSummary,
        getTodayCourseSummary,
    }
}
