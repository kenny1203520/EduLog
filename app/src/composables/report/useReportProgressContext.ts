import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Lesson } from '@/models/Course'
import { findCourseProgressGaps } from '@/utils/courseProgressGaps'
import { ReportQueryService } from '@/services/report/ReportQueryService'

type ProgressContext = Awaited<ReturnType<typeof ReportQueryService.getEnrollmentReportProgressContext>>

export interface FocusedProgressReport {
    id: string
    lesson: { sequence: number; title: string }
}

interface ReportProgressContextSource {
    enrollmentId: () => string | undefined
    classOccurrenceId: () => string | undefined
    reportId: () => string | undefined
    availableLessons: () => Lesson[]
    selectedLessonId: Ref<string>
}

/**
 * The course-progress check beside the lesson picker: lessons skipped before
 * this one and the previous report, loaded per enrollment/occurrence/report.
 */
export function useReportProgressContext(source: ReportProgressContextSource) {
    const { t } = useI18n()

    const progressContext = ref<ProgressContext | null>(null)
    const progressContextLoading = ref(false)
    const progressContextError = ref(false)
    const focusedProgressReport = ref<FocusedProgressReport | null>(null)
    let progressContextRequest = 0

    const progressGaps = computed(() => {
        const lessons = (source.availableLessons() || []).filter((lesson): lesson is typeof lesson & { id: string } => Boolean(lesson.id))
        return findCourseProgressGaps(lessons, progressContext.value?.reports.map((report) => report.lesson_id) || [], source.selectedLessonId.value)
    })

    const previousProgressReport = computed(() => {
        const report = progressContext.value?.latest_prior_report
        if (!report) return null
        const lesson = source.availableLessons()?.find((item) => item.id === report.lesson_id)
        return lesson ? { report, lesson } : null
    })

    // Compact (side panel): the progress notes collapse into this one line.
    const progressSummary = computed(() => {
        if (progressContextLoading.value) return t('report.editor.progress_check.loading')
        if (progressContextError.value) return t('report.editor.progress_check.load_error')
        const parts: string[] = []
        if (progressGaps.value.length) parts.push(t('report.editor.progress_check.summary_gaps', { count: progressGaps.value.length }))
        const previous = previousProgressReport.value
        if (previous) {
            const lesson = [t('report.editor.progress_check.lesson_short', { sequence: previous.lesson.sequence }), previous.report.progress_letter].filter(Boolean).join(' ')
            parts.push(t('report.editor.progress_check.summary_previous', { lesson }))
        }
        return parts.join(' · ') || t('report.editor.progress_check.summary_none')
    })

    async function loadProgressContext() {
        const requestId = ++progressContextRequest
        const enrollmentId = source.enrollmentId()
        const occurrenceId = source.classOccurrenceId()
        const reportId = source.reportId()
        if (!enrollmentId || !occurrenceId || !reportId) {
            progressContext.value = null
            progressContextError.value = false
            progressContextLoading.value = false
            return
        }
        progressContext.value = null
        focusedProgressReport.value = null
        progressContextError.value = false
        progressContextLoading.value = true
        try {
            const context = await ReportQueryService.getEnrollmentReportProgressContext(enrollmentId, occurrenceId, reportId)
            if (requestId === progressContextRequest) progressContext.value = context
        } catch {
            if (requestId === progressContextRequest) progressContextError.value = true
        } finally {
            if (requestId === progressContextRequest) progressContextLoading.value = false
        }
    }

    /** Focuses the previous report; returns false when there is none. */
    function focusPreviousProgressReport(): boolean {
        if (!previousProgressReport.value) return false
        if (previousProgressReport.value.report.can_open_report === false) return false
        focusedProgressReport.value = { id: previousProgressReport.value.report.id, lesson: previousProgressReport.value.lesson }
        return true
    }

    function clearFocusedProgressReport() {
        focusedProgressReport.value = null
    }

    watch(() => [source.enrollmentId(), source.classOccurrenceId(), source.reportId()] as const, () => { void loadProgressContext() }, { immediate: true })

    return {
        progressContextLoading,
        progressContextError,
        focusedProgressReport,
        progressGaps,
        previousProgressReport,
        progressSummary,
        loadProgressContext,
        focusPreviousProgressReport,
        clearFocusedProgressReport,
    }
}
