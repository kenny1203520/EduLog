<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { PageApiService } from '@/services/api/PageApiService'
import { SessionService } from '@/services/session/SessionService'
import { calendarGridRange, withoutRange, type CalendarDateRange } from '@/models/ClassCalendarDay'
import { countJoinFlagsByDate, type RosterFlag } from '@/models/ClassTimeline'
import { ClassSessionFactory } from '@/models/ClassSession'
import { invalidationAffectsDate, parseClassSessionDate } from '@/services/session/ClassSessionInvalidation'
import { useAuthStore } from '@/stores/useAuthStore'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'
import { Enrollment } from '@/models/Enrollment'
import { countRosterAttendance, getRosterEnrollments } from '@/models/RosterFilter'
import type { Lesson } from '@/models/Course'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '@/models/OccurrenceReport'
import { DateUtils } from '@/utils/dateUtils'
import { TeacherService } from '@/services/teacher/TeacherService'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'
import type { TeacherOverviewDTO } from '@/services/api/PageApiService'
import {
    ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_ATTENDANCE_TEMPLATE,
    formatCopyTemplateToken,
    renderCopyTemplate
} from '@/utils/copyTemplate'
import { copyRichTextToClipboard } from '@/utils/clipboard'

import ReportEditor from '@/components/report/ReportEditor.vue'
import OccurrenceCalendar from '@/components/occurrence/OccurrenceCalendar.vue'
import QuickAttendancePanel, { type QuickAttendanceStatus } from '@/components/classroom/QuickAttendancePanel.vue'
import StudentRosterPanel, { type StudentRosterItem } from '@/components/classroom/StudentRosterPanel.vue'
import TransferredOutStudents from '@/components/classroom/TransferredOutStudents.vue'
import RealtimeStatusBadge, { type RealtimeBadgeTone } from '@/components/ui/RealtimeStatusBadge.vue'
import type { OccurrenceLessonTransfer } from '@/services/enrollment/EnrollmentTransferQueryService'
import type { ProgressGapHintLesson } from '@/components/classroom/CourseProgressGapHint.vue'
import ConflictModal from '@/components/report/ConflictModal.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import CopyTemplateEditorModal from '@/components/copy-template/CopyTemplateEditorModal.vue'
import { createTextEditorContent, renderTemplateContent } from '@/components/text-editor/content'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import KodingCodeCheckModal from '@/components/enrollment/KodingCodeCheckModal.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import TimeZoneSelect from '@/components/ui/TimeZoneSelect.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { isTeacherPresentForScope } from '@/services/report/TeacherAttendanceScope'
import { roleDisplayName } from '@/utils/roleDisplay'
import { getEffectiveTeacherAssignments } from '@/utils/effectiveTeacherAssignments'
import { absenceReasonLabel } from '@/utils/absenceReason'
import { ApiRealtimeChannel } from '@/services/report/ApiRealtimeChannel'
import { shouldApplyCommittedReport } from '@/services/report/CommittedReportState'
import { EnrollmentTransferQueryService } from '@/services/enrollment/EnrollmentTransferQueryService'
import { EnrollmentCommandService } from '@/services/enrollment/EnrollmentCommandService'
import { EnrollmentQueryService } from '@/services/enrollment/EnrollmentQueryService'
import { OccurrenceQueryService } from '@/services/occurrence/OccurrenceQueryService'
import { OccurrenceCommandService } from '@/services/occurrence/OccurrenceCommandService'
import { OccurrenceSyncService } from '@/services/occurrence/OccurrenceSyncService'
import { ReportQueryService } from '@/services/report/ReportQueryService'
import { ReportCommandService } from '@/services/report/ReportCommandService'
import { HolidayQueryService } from '@/services/holiday/HolidayQueryService'
import { CopyTemplateQueryService } from '@/services/copy-template/CopyTemplateQueryService'
import { CopyTemplateCommandService } from '@/services/copy-template/CopyTemplateCommandService'

type ReportEditorExpose = {
    saveNow: (options?: { reason?: 'manual' | 'switch' }) => Promise<boolean>
    replaceWithCanonicalReport: (report: OccurrenceReportDTO) => void
}

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()

function isReportAuthorizationError(error: any): boolean {
    const code = error?.code
    const status = error?.status || error?.statusCode
    const message = typeof error?.message === 'string' ? error.message : ''
    return code === '42501' || status === 401 || status === 403 || /row-level security|permission denied/i.test(message)
}
const preferences = usePreferencesStore()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const selectedDateKey = ref<string | null>(parseClassSessionDate(route.query.date) || null)
const sessionOccurrences = ref<ClassOccurrence[]>([])
const reportCompletionByDate = ref<Record<string, { total: number; completed: number }>>({})
const rosterFlagsByDate = ref<Record<string, RosterFlag[]>>({})
const joinFlagsByDate = computed(() => countJoinFlagsByDate(Object.values(rosterFlagsByDate.value).flat()))
// The month grid the calendar shows; occurrences load per grid, not per year.
const visibleCalendarRange = ref<CalendarDateRange | null>(null)
const loadedOccurrenceRanges = new Map<string, Promise<void>>()
const sessionTeachers = ref<SessionTeacherAssignmentDTO[]>([])
const currentSessionTeachers = computed(() => {
    const occurrence = todayOccurrence.value
    if (!occurrence?.occurrenceDate) return []

    const date = DateUtils.formatLocalDate(occurrence.occurrenceDate)
    return sessionTeachers.value.filter(teacher =>
        date >= teacher.effective_from && (!teacher.effective_to || date <= teacher.effective_to)
    )
})
const weekAnchorDate = ref(DateUtils.todayDate(preferences.timeZone))
const isCalendarExpanded = ref(false)
const isOccurrenceInHoliday = ref(false)
const teacherLeaveById = ref<Record<string, boolean>>({})
const canManageTeacherAttendance = ref(false)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving
const selectedEnrollmentIds = ref<Set<string>>(new Set())
const isQuickAttendanceExpanded = ref(true)
const isOccurrenceLoading = ref(false)
const occurrenceLoadError = ref<string | null>(null)
const previousOccurrence = ref<ClassOccurrence | null>(null)
const nextOccurrence = ref<ClassOccurrence | null>(null)
let occurrenceLoadToken = 0
let reportLoadRequest = 0
let editorSelectionRequest = 0
let reportProvisionRequests = new Map<string, Promise<OccurrenceReport[]>>()
let workspaceRosterDate: string | null = null
const showAttendanceTemplateModal = ref(false)
let attendanceTemplateRequestGeneration = 0
const attendanceTemplateText = ref(SYSTEM_ATTENDANCE_TEMPLATE)
const attendanceTemplateDocument = ref<RichTextDocumentV1>(
    createTextEditorContent(SYSTEM_ATTENDANCE_TEMPLATE, { templateVariables: true }).richText
)
const attendanceTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
const attendanceTemplateScope = ref<'class_session' | 'user_default'>('class_session')
const isLoadingAttendanceTemplate = ref(false)
const isSavingAttendanceTemplate = ref(false)
const attendanceTemplateLoadOptions = ref<Array<{
    key: string
    label: string
    templateText: string
    templateDocument?: RichTextDocumentV1
}>>([])
const selectedAttendanceTemplateLoadKey = ref('')
const selectedAttendanceTemplateModes = ref<Record<string, string>>({
    present_list: 'comma',
    absent_list: 'comma',
    pending_list: 'comma'
})
const showAddStudentModal = ref(false)
const isAddingStudent = ref(false)
const makeupSubmitError = ref('')
const makeupSubmitErrorElement = ref<HTMLElement | null>(null)
const makeupCandidates = ref<Enrollment[]>([])
const makeupSearch = ref('')
const selectedMakeupStudentId = ref<string | null>(null)
const selectedMakeupEnrollmentId = ref<string | null>(null)
const makeupJoinDate = ref(DateUtils.todayString(preferences.timeZone))

const showKodingCheckModal = ref(false)
const kodingTargetEnrollment = ref<Enrollment | null>(null)
const kodingInitialLessonId = ref<string | null>(null)

// Teacher Management State
const occurrenceTeachers = ref<Array<TeacherOverviewDTO & { role?: SessionTeacherAssignmentDTO['role'] }>>([])
const allTeachersList = ref<TeacherOverviewDTO[]>([])
const showTeacherEditModal = ref(false)
const teacherSearchQuery = ref('')
const selectedTeacherIds = ref<Set<string>>(new Set())
const isSavingTeachers = ref(false)

// Split View State
const showSplitView = ref(false)
const selectedEnrollmentId = ref<string | null>(null)
const isRefreshing = ref(false)
const quickReportEditorRef = ref<ReportEditorExpose | null>(null)
const realtimeStatus = ref<'connecting' | 'subscribing' | 'connected' | 'offline' | 'reconnecting' | 'forbidden' | 'expired' | 'disabled'>('connecting')
const realtimeStatusDetail = ref('')
const isRealtimeRefreshing = ref(false)
const realtimeRefreshError = ref(false)
const lastRealtimeUpdateAt = ref<Date | null>(null)
const realtimeStatusMessage = computed(() => {
    if (realtimeRefreshError.value) return t('classroom.live_update_failed')
    if (isRealtimeRefreshing.value) return t('classroom.live_update_loading')
    switch (realtimeStatus.value) {
        case 'forbidden': return t('classroom.live_updates_forbidden')
        case 'expired': return t('classroom.live_updates_expired')
        case 'disabled': return t('classroom.live_updates_disabled')
        case 'offline': return t('classroom.live_updates_offline')
        case 'connecting': return t('classroom.live_updates_connecting')
        case 'subscribing': return t('classroom.live_updates_subscribing')
        case 'reconnecting': return t('classroom.live_updates_reconnecting')
        default: return t('classroom.live_updates_connected')
    }
})
// Live updates only refresh the roster; the page works without them, so the
// status is a fixed-size badge that recolors instead of a bar that shifts content.
const realtimeBadge = computed<{ tone: RealtimeBadgeTone; label: string; canRetry: boolean }>(() => {
    if (realtimeRefreshError.value) return { tone: 'warning', label: t('classroom.live_badge_refresh_failed'), canRetry: true }
    if (isRealtimeRefreshing.value) return { tone: 'connecting', label: t('classroom.live_badge_refreshing'), canRetry: false }
    switch (realtimeStatus.value) {
        case 'connected': return { tone: 'live', label: t('classroom.live_badge_live'), canRetry: false }
        case 'connecting':
        case 'subscribing': return { tone: 'connecting', label: t('classroom.live_badge_connecting'), canRetry: false }
        case 'offline':
        case 'reconnecting': return { tone: 'warning', label: t('classroom.live_badge_paused'), canRetry: true }
        default: return { tone: 'paused', label: t('classroom.live_badge_unavailable'), canRetry: false }
    }
})
const selectedEditorEnrollmentSnapshot = ref<Enrollment | null>(null)
const selectedEditorReportSnapshot = ref<OccurrenceReport | null>(null)
const selectedEditorReport = computed(() => selectedEditorReportSnapshot.value)
let classSessionChannel: ApiRealtimeChannel | null = null
let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null
let realtimeRefreshRequest = 0
let realtimeRefreshRunning = false
let selectedDateRequest = 0
let hasLoadedInitialData = false
let pendingRealtimeInvalidations: unknown[] = []
let hasJoinedClassSessionChannel = false
let lessonLoadPromises = new Map<string, Promise<Lesson[]>>()
let progressSummaryRequestGeneration = 0

// Conflict Resolution State
const showConflictModal = ref(false)
const conflictServerVersion = ref(0)
const conflictLocalVersion = ref(0)
const conflictReportId = ref<string | null>(null)
const conflictServerReport = ref<OccurrenceReportDTO | null>(null)
const conflictLocalReport = ref<OccurrenceReportDTO | null>(null)

const session = ref<any>(null)
const sessionTimeZone = computed(() => DateUtils.isValidTimeZone(session.value?.time_zone) ? session.value.time_zone : preferences.timeZone)
const enrollments = ref<Enrollment[]>([])
const studentSearchQuery = ref('')
const studentAttendanceFilter = ref<'all' | 'present' | 'absent' | 'pending'>('all')
const courseLessons = ref<any[]>([])
const courseLessonsByCourseId = ref<Record<string, Lesson[]>>({})
const studentProgressSummaries = ref<Record<string, StudentProgressSummary>>({})
const studentProgressGaps = ref<Record<string, ProgressGapHintLesson[]>>({})
const isLoadingProgressGaps = ref(false)
const progressGapCheckFailed = ref(false)
let progressGapRequestGeneration = 0
const loading = ref(true)

type ProgressTone = 'completed' | 'incomplete' | 'empty'

interface StudentProgressSummary {
    currentCourse: string
    highestProgressTitle: string
    highestProgressStatus: string
    highestProgressTone: ProgressTone
    latestProgressTitle: string
    latestProgressStatus: string
    latestProgressTone: ProgressTone
}

interface TodayCourseSummary {
    title: string
    chapterProgress: string
    completionStatus: string
    tone: ProgressTone
    hasRecord: boolean
}

function getDefaultProgressSummary(): StudentProgressSummary {
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

function getLessonTitle(lessons: Lesson[], sequence?: number, fallbackLessonId?: string): string {
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

function formatLessonHeading(sequence: number | undefined, title: string): string {
    if (sequence === undefined || sequence === null) {
        return title
    }

    return `L${sequence} ${title}`
}

function formatProgressStatus(report?: OccurrenceReport | null): string {
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

function formatProgressRange(report?: OccurrenceReport | null): string {
    if (!report) {
        return t('classroom.progress_no_record')
    }

    const range = report.progressLetter ? report.progressLetter : ''
    return range ? `${range} · ${formatProgressStatus(report)}` : formatProgressStatus(report)
}

function getReportDate(report: OccurrenceReport): Date | undefined {
    return report.occurrenceDate || report.createdAt || report.updatedAt
}

function getReportTimestamp(report: OccurrenceReport): number {
    const reportDate = getReportDate(report)
    return reportDate ? reportDate.getTime() : Number.MIN_SAFE_INTEGER
}

function getCycleStart(date: Date, classDayOfWeek?: number): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    if (classDayOfWeek === undefined) return d

    const currentDay = d.getDay()
    const diff = (currentDay - classDayOfWeek + 7) % 7
    d.setDate(d.getDate() - diff)
    return d
}

function getCycleEnd(date: Date, classDayOfWeek?: number): Date {
    const start = getCycleStart(date, classDayOfWeek)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return end
}

function pickHighestProgressReport(
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

function buildStudentProgressSummary(enrollment: Enrollment, reports: OccurrenceReport[], lessons: Lesson[], referenceDate: Date = new Date()): StudentProgressSummary {
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

    const highestLesson = getLessonTitle(lessons, highestLessonNumber)
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
        highestProgressStatus: formatProgressRange(highestReport),
        highestProgressTone: getProgressTone(highestReport),
        latestProgressTitle: latestAttendedReport
            ? formatLessonHeading(latestLesson?.sequence, getLessonTitle(lessons, undefined, latestAttendedReport?.lessonId))
            : t('classroom.progress_no_record'),
        latestProgressStatus: formatProgressRange(latestAttendedReport),
        latestProgressTone: getProgressTone(latestAttendedReport)
    }
}

function getLessonsFromEnrollment(enrollment: Enrollment): Lesson[] {
    return courseLessonsByCourseId.value[enrollment.courseId] || []
}

function getTodayCourseSummary(enrollment: Enrollment): TodayCourseSummary {
    const report = reportMap.value.get(enrollment.id!) as OccurrenceReport | null | undefined
    if (!report) {
        return {
            title: t('classroom.no_today_course_record'),
            chapterProgress: t('classroom.progress_no_record'),
            completionStatus: t('classroom.progress_no_record'),
            tone: 'empty',
            hasRecord: false
        }
    }

    const lessons = getLessonsFromEnrollment(enrollment)
    const lesson = report.lessonId ? lessons.find(item => item.id === report.lessonId) : undefined
    const lessonTitle = lesson
        ? formatLessonHeading(lesson.sequence, lesson.title)
        : t('classroom.progress_no_record')

    return {
        title: lessonTitle,
        chapterProgress: report.progressLetter || t('classroom.progress_no_record'),
        completionStatus: formatProgressStatus(report),
        tone: getProgressTone(report),
        hasRecord: true
    }
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
            return [enrollment.id, getDefaultProgressSummary()] as const
        }

        const lessons = options.loadMissingLessons === false
            ? courseLessonsByCourseId.value[enrollment.courseId] || []
            : await getLessonsForCourse(enrollment.courseId)
        const reports = reportsByEnrollment.get(enrollment.id) || []
        return [enrollment.id, buildStudentProgressSummary(enrollment, reports, lessons, referenceDate)] as const
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

function getStudentProgressSummary(enrollmentId?: string): StudentProgressSummary {
    if (!enrollmentId) {
        return getDefaultProgressSummary()
    }

    return studentProgressSummaries.value[enrollmentId] || getDefaultProgressSummary()
}

const displayedOccurrenceDate = computed(() => {
    if (!todayOccurrence.value?.occurrenceDate) {
        const selected = selectedDateKey.value ? DateUtils.parseLocalDate(selectedDateKey.value) : undefined
        return selected
            ? DateUtils.displayDate(selected, preferences.locale, preferences.timeZone)
            : t('classroom.no_teaching_day_selected')
    }

    return DateUtils.displayDate(todayOccurrence.value.occurrenceDate, preferences.locale, preferences.timeZone)
})

const occurrenceNavigationLabel = computed(() => {
    if (!todayOccurrence.value?.occurrenceDate) return ''
    const start = todayOccurrence.value.effectiveStartTime?.slice(0, 5)
    const end = todayOccurrence.value.effectiveEndTime?.slice(0, 5)
    const time = start && end ? ` · ${start}–${end}` : ''
    return `${displayedOccurrenceDate.value}${time}`
})

function normalizeDateInput(value: string | Date | undefined): string {
    if (!value) {
        return DateUtils.todayString(preferences.timeZone)
    }

    if (value instanceof Date) {
        return DateUtils.formatLocalDate(value)
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return DateUtils.todayString(preferences.timeZone)
    }

    return DateUtils.formatLocalDate(parsed)
}

const attendanceTemplateLoadOptionsDropdown = computed(() => {
    return attendanceTemplateLoadOptions.value.map(opt => ({
        label: opt.label,
        value: opt.key
    }))
})



const makeupStudentOptions = computed(() => {
    const search = makeupSearch.value.toLowerCase().trim()
    let students = makeupCandidates.value

    if (search) {
        students = students.filter(s =>
            s.studentName?.toLowerCase().includes(search)
        )
    }

    // Deduplicate students by studentId to prevent duplicate option choices
    const uniqueStudents: typeof students = []
    const seenStudentIds = new Set<string>()
    for (const student of students) {
        if (student.studentId && !seenStudentIds.has(student.studentId)) {
            seenStudentIds.add(student.studentId)
            uniqueStudents.push(student)
        }
    }

    return [
        { label: t('classroom.please_select_student'), value: null },
        ...uniqueStudents.map(s => ({
            label: s.studentName || 'Unnamed',
            value: s.studentId || ''
        }))
    ]
})

const makeupEnrollmentOptions = computed(() => {
    if (!selectedMakeupStudentId.value) return []

    const studentEnrollments = makeupCandidates.value.filter(
        e => e.studentId === selectedMakeupStudentId.value
    )

    return [
        { label: t('classroom.please_select_student_enrollment'), value: null },
        ...studentEnrollments.map(e => ({
            label: `${e.courseDisplayName || (e.courseSubject + ' ' + (e.courseStage || ''))} (${t(`student.internal_courses.status_${e.status}`)})`,
            value: e.id || ''
        }))
    ]
})



const filteredTeachers = computed(() => {
    const query = teacherSearchQuery.value.trim().toLowerCase()
    if (!query) return allTeachersList.value

    return allTeachersList.value.filter(t => t.name.toLowerCase().includes(query))
})

const selectedMakeupEnrollment = computed(() => {
    return makeupCandidates.value.find(item => item.id === selectedMakeupEnrollmentId.value) || null
})

function handleMakeupStudentChange() {
    selectedMakeupEnrollmentId.value = null
}

watch([selectedMakeupStudentId, selectedMakeupEnrollmentId, makeupJoinDate], () => {
    makeupSubmitError.value = ''
})

function findOccurrenceByDate(date: Date): ClassOccurrence | undefined {
    const target = DateUtils.formatLocalDate(date)
    return sessionOccurrences.value.find(occ => DateUtils.formatLocalDate(occ.occurrenceDate) === target)
}

/**
 * Loads one date range of the class's lessons and replaces that range in
 * sessionOccurrences, then refreshes the report-completion dots and roster
 * flags for it. A range already loaded is reused unless `force` is set.
 */
function loadOccurrenceRange(range: CalendarDateRange, force = false): Promise<void> {
    const key = `${range.start}|${range.end}`
    const cached = loadedOccurrenceRanges.get(key)
    if (cached && !force) return cached
    const task = (async () => {
        const occurrences = await OccurrenceQueryService.getOccurrencesByDateRange(
            DateUtils.parseLocalDate(range.start)!, DateUtils.parseLocalDate(range.end)!, [sessionId]
        )
        const outside = sessionOccurrences.value.filter(occurrence => {
            const date = DateUtils.formatLocalDate(occurrence.occurrenceDate)
            return date < range.start || date > range.end
        })
        sessionOccurrences.value = [...outside, ...occurrences]
            .sort((a, b) => a.occurrenceDate.getTime() - b.occurrenceDate.getTime())
        void loadReportCompletion(range)
        void loadRosterFlags(range)
    })()
    loadedOccurrenceRanges.set(key, task)
    task.catch(() => {
        if (loadedOccurrenceRanges.get(key) === task) loadedOccurrenceRanges.delete(key)
    })
    return task
}

/** Reloads the month grid around `anchorDate` and the grid the calendar shows. */
async function loadSessionOccurrences(anchorDate: Date): Promise<void> {
    const anchorRange = calendarGridRange(anchorDate)
    const visible = visibleCalendarRange.value
    await Promise.all([
        loadOccurrenceRange(anchorRange, true),
        ...(visible && (visible.start !== anchorRange.start || visible.end !== anchorRange.end) ? [loadOccurrenceRange(visible, true)] : []),
    ])
}

function handleCalendarRangeChange(range: CalendarDateRange) {
    visibleCalendarRange.value = range
    loadOccurrenceRange(range).catch(error => {
        console.error('Failed to load class calendar range:', error)
        reportError(error)
    })
}

async function loadReportCompletion(range: CalendarDateRange) {
    try {
        const completion = await OccurrenceQueryService.getReportCompletionByDate(sessionId, range.start, range.end)
        reportCompletionByDate.value = { ...withoutRange(reportCompletionByDate.value, range), ...completion }
    } catch (error) {
        // The completion dot is a hint; the calendar works without it.
        console.error('Failed to load report completion:', error)
    }
}

async function loadRosterFlags(range: CalendarDateRange) {
    try {
        const flags = await EnrollmentTransferQueryService.getClassRosterFlags(sessionId, range.start, range.end)
        const byDate: Record<string, RosterFlag[]> = {}
        for (const flag of flags) (byDate[flag.date] ??= []).push(flag)
        rosterFlagsByDate.value = { ...withoutRange(rosterFlagsByDate.value, range), ...byDate }
    } catch (error) {
        // The transfer badges are informational; the calendar works without them.
        console.error('Failed to load roster flags:', error)
    }
}

/** Students whose class transfer into this class takes effect on the selected date. */
const classTransferInIds = computed(() => new Set((rosterFlagsByDate.value[selectedDateKey.value || ''] ?? [])
    .filter(flag => flag.flag === 'transfer_in')
    .map(flag => flag.enrollment_id)))

const sessionSchedule = computed(() => {
    if (!session.value) return null
    try {
        return ClassSessionFactory.create({ ...session.value, schedule_rules: session.value.schedule_rules ?? [] })
    } catch {
        return null
    }
})
const calendarToday = computed(() => DateUtils.todayString(sessionTimeZone.value))
// Sessions created from schedule rules leave class_sessions.start_time/end_time
// null; fall back to the first rule's times instead of crashing the header.
const sessionTimeLabel = computed(() => {
    const rule = session.value?.schedule_rules?.[0]
    const start = (session.value?.start_time || rule?.start_time || '').slice(0, 5)
    const end = (session.value?.end_time || rule?.end_time || '').slice(0, 5)
    return start && end ? `${start}–${end}` : '-'
})

function isPlannedClassDate(date: string) {
    return sessionSchedule.value?.isScheduledOn(date) ?? false
}

async function loadReportsForCurrentOccurrence(options: { createMissing?: boolean } = {}) {
    const request = ++reportLoadRequest
    const occurrenceId = todayOccurrence.value?.id
    const nextReportMap = new Map<string, any>()
    if (!occurrenceId) {
        reportMap.value = nextReportMap
        return
    }

    let occurrenceReports: OccurrenceReport[]
    if (options.createMissing === false) {
        // If the initial provisioning POST is still running, wait for its
        // writes to settle before taking the complete read snapshot.
        const provisioning = reportProvisionRequests.get(occurrenceId)
        if (provisioning) await provisioning
        occurrenceReports = await ReportQueryService.getReportsByOccurrence(occurrenceId)
    } else {
        let provisioning = reportProvisionRequests.get(occurrenceId)
        if (!provisioning) {
            provisioning = ReportCommandService.createReportsForOccurrence(occurrenceId)
            reportProvisionRequests.set(occurrenceId, provisioning)
        }
        try {
            occurrenceReports = await provisioning
        } finally {
            if (reportProvisionRequests.get(occurrenceId) === provisioning) reportProvisionRequests.delete(occurrenceId)
        }
    }
    if (request !== reportLoadRequest || todayOccurrence.value?.id !== occurrenceId) return
    const currentEnrollmentIds = new Set(enrollments.value.map(enrollment => enrollment.id).filter(Boolean))
    occurrenceReports.forEach(report => {
        // The workspace RPC is the canonical effective roster. Never let an
        // old source-occurrence report re-introduce a transferred student.
        if (report.enrollmentId && currentEnrollmentIds.has(report.enrollmentId)) {
            const currentReport = reportMap.value.get(report.enrollmentId) as OccurrenceReport | null | undefined
            // A background read can race a newer save response. Keep the
            // higher server version for the card instead of rolling it back.
            nextReportMap.set(report.enrollmentId,
                currentReport && currentReport.id === report.id && currentReport.version >= report.version
                    ? currentReport
                    : report)
        }
    })

    for (const enrollment of enrollments.value) {
        if (enrollment.id && !nextReportMap.has(enrollment.id)) nextReportMap.set(enrollment.id, null)
    }
    reportMap.value = nextReportMap
}

const occurrenceTransfers = ref<OccurrenceLessonTransfer[]>([])
const pendingTransferCancel = ref<OccurrenceLessonTransfer | null>(null)
const cancellingTransferId = ref<string | null>(null)
const transferredOutStudents = computed(() => occurrenceTransfers.value.filter(transfer => transfer.direction === 'out'))
const transferInLabels = computed(() => new Map(occurrenceTransfers.value
    .filter(transfer => transfer.direction === 'in')
    .map(transfer => [transfer.enrollment_id, t('classroom.lesson_transfer.transferred_in', {
        date: DateUtils.displayDateWithWeekday(transfer.other_occurrence_date, preferences.locale),
        time: transfer.other_start_time?.slice(0, 5) || ''
    })])))

async function loadOccurrenceTransfers() {
    const occurrenceId = todayOccurrence.value?.id
    if (!occurrenceId) {
        occurrenceTransfers.value = []
        return
    }
    try {
        const transfers = await EnrollmentTransferQueryService.getOccurrenceLessonTransfers(occurrenceId)
        if (todayOccurrence.value?.id === occurrenceId) occurrenceTransfers.value = transfers
    } catch (error) {
        // The transfer notes are informational; the roster stays usable without them.
        console.error('Failed to load lesson transfers:', error)
        if (todayOccurrence.value?.id === occurrenceId) occurrenceTransfers.value = []
    }
}

function openTransferTarget(transfer: OccurrenceLessonTransfer) {
    void router.push({ name: 'session-details', params: { id: transfer.other_session_id }, query: { date: transfer.other_occurrence_date } })
}

async function confirmTransferCancel() {
    const transfer = pendingTransferCancel.value
    if (!transfer || cancellingTransferId.value) return
    cancellingTransferId.value = transfer.transfer_id
    try {
        const result = await EnrollmentCommandService.cancelSingleLessonTransfer(transfer.transfer_id)
        toast.success(t(result.targetReportRetained
            ? 'student.transfer_history.cancelled_target_retained'
            : 'student.transfer_history.cancelled'))
        pendingTransferCancel.value = null
        if (todayOccurrence.value?.occurrenceDate) {
            await loadWorkspaceRoster(todayOccurrence.value.occurrenceDate, true)
            await loadReportsForCurrentOccurrence({ createMissing: false })
        }
    } catch (error) {
        pendingTransferCancel.value = null
        reportError(error, 'student.transfer_history.cancel_error')
    } finally {
        cancellingTransferId.value = null
    }
}

async function loadWorkspaceRoster(occurrenceDate: Date, force = false): Promise<void> {
    const date = DateUtils.formatLocalDate(occurrenceDate)
    if (!force && workspaceRosterDate === date) return

    const workspace = (await PageApiService.getClassSessionWorkspace(sessionId, date)).data
    if (selectedDateKey.value && selectedDateKey.value !== date) return
    if (todayOccurrence.value?.occurrenceDate && DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate) !== date) return
    if (!workspace.session) throw new Error('Class session workspace is unavailable')
    if (workspace.session.roster_date && workspace.session.roster_date !== date) {
        throw new Error('Class session workspace returned an unexpected roster date')
    }

    enrollments.value = workspace.enrollments.map(enrollment => new Enrollment(enrollment))
    workspaceRosterDate = date
    void loadOccurrenceTransfers()
    if (session.value) {
        const rawSession = workspace.session as any
        session.value = {
            ...session.value,
            ...rawSession,
            schedule_rules: rawSession.schedule_rules ?? rawSession.class_session_schedule_rules ?? [],
            classroom_name: rawSession.classrooms?.name ?? session.value.classroom_name,
            classroom_address: rawSession.classrooms?.address ?? session.value.classroom_address,
            classroom_external_link: rawSession.classrooms?.external_link ?? session.value.classroom_external_link,
        }
    }
}

async function loadOccurrenceTeachers() {
    if (!todayOccurrence.value) {
        occurrenceTeachers.value = []
        teacherLeaveById.value = {}
        selectedTeacherIds.value = new Set()
        return
    }
    teacherLeaveById.value = {}

    // Attendance roster is always derived from the effective teaching assignments.
    // Keep the attendance status map on the occurrence, but never persist a second roster.
    const dateStr = DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate)
    const assignmentsByTeacher = getEffectiveTeacherAssignments(sessionTeachers.value, dateStr)
    selectedTeacherIds.value = new Set(assignmentsByTeacher.map(assignment => assignment.id).filter((id): id is string => Boolean(id)))
    occurrenceTeachers.value = assignmentsByTeacher.map(assignment => ({
        ...assignment,
        role: assignment.role
    }))
    const occurrence = todayOccurrence.value
    const leaveEntries = await Promise.all(assignmentsByTeacher
        .filter(assignment => assignment.id)
        .map(async assignment => [assignment.id!, await HolidayQueryService.isTeacherOnLeave(
            dateStr,
            assignment.id!,
            session.value?.classroom_id,
            sessionId
        ).catch(error => {
            console.error('Failed to check teacher leave:', error)
            return false
        })] as const))
    if (todayOccurrence.value?.id !== occurrence.id) return
    teacherLeaveById.value = Object.fromEntries(leaveEntries)
}

async function setCurrentOccurrence(occurrence: ClassOccurrence | null) {
    const loadToken = ++occurrenceLoadToken
    isOccurrenceLoading.value = true
    occurrenceLoadError.value = null
    todayOccurrence.value = occurrence

    try {
        if (!occurrence?.occurrenceDate) {
            reportMap.value = new Map()
            enrollments.value = []
            studentProgressSummaries.value = {}
            studentProgressGaps.value = {}
            progressGapRequestGeneration++
            isLoadingProgressGaps.value = false
            progressGapCheckFailed.value = false
            isOccurrenceInHoliday.value = false
            occurrenceTeachers.value = []
            teacherLeaveById.value = {}
            selectedTeacherIds.value = new Set()
            workspaceRosterDate = null
            occurrenceTransfers.value = []
            previousOccurrence.value = null
            nextOccurrence.value = null
            return
        }

        weekAnchorDate.value = new Date(occurrence.occurrenceDate)
        const occurrenceDateStr = DateUtils.formatLocalDate(occurrence.occurrenceDate)
        const [, holiday, navigation] = await Promise.all([
            loadWorkspaceRoster(occurrence.occurrenceDate),
            HolidayQueryService.isHoliday(occurrenceDateStr, undefined, occurrence.classSessionId).catch(error => {
                console.error('Failed to check holiday status:', error)
                return false
            }),
            OccurrenceQueryService.getOccurrenceNavigationState(sessionId, occurrence.occurrenceDate)
        ])
        if (loadToken !== occurrenceLoadToken) return
        isOccurrenceInHoliday.value = holiday
        previousOccurrence.value = navigation.previous
        nextOccurrence.value = navigation.next

        await Promise.all([
            loadReportsForCurrentOccurrence().catch(error => {
                // Placeholder report creation is best-effort. If the scoped
                // INSERT policy is not deployed yet, keep the class workspace
                // usable and allow existing reports to be opened.
                if (isReportAuthorizationError(error)) {
                    console.warn('Report data provisioning is not authorized; continuing with existing reports.')
                    return
                }
                throw error
            }),
            loadOccurrenceTeachers(),
            loadStudentProgressSummaries(enrollments.value, 'replace', occurrence.occurrenceDate),
            loadStudentProgressGaps(enrollments.value, occurrence)
        ])
    } catch (error) {
        if (loadToken === occurrenceLoadToken) {
            console.error('Failed to initialize occurrence:', error)
            occurrenceLoadError.value = t('classroom.occurrence_load_error')
        }
        throw error
    } finally {
        if (loadToken === occurrenceLoadToken) isOccurrenceLoading.value = false
    }
}

async function handleCalendarDateSelect(date: Date) {
    const dateStr = DateUtils.formatLocalDate(date)
    // A future lesson the schedule plans but that was never generated: create it first.
    if (!findOccurrenceByDate(date) && dateStr >= calendarToday.value && isPlannedClassDate(dateStr)) {
        try {
            await OccurrenceCommandService.generateOccurrences(sessionId, date, date)
        } catch (error) {
            console.error('Failed to generate the planned lesson:', error)
        }
    }
    await selectClassDate(dateStr)
}

function syncSelectedDateToUrl(date: string) {
    if (parseClassSessionDate(route.query.date) === date) return
    void router.replace({
        query: { ...route.query, date }
    })
}

async function selectClassDate(date: string, updateUrl = true) {
    const validDate = parseClassSessionDate(date)
    if (!validDate) return
    if (validDate !== selectedDateKey.value && showSplitView.value) {
        const saveSucceeded = await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
        if (saveSucceeded === false) return
        showSplitView.value = false
        selectedEnrollmentId.value = null
        selectedEditorEnrollmentSnapshot.value = null
        selectedEditorReportSnapshot.value = null
    }
    const request = ++selectedDateRequest
    realtimeRefreshRequest++
    isRealtimeRefreshing.value = false
    selectedDateKey.value = validDate
    weekAnchorDate.value = DateUtils.parseLocalDate(validDate) || weekAnchorDate.value
    if (updateUrl) syncSelectedDateToUrl(validDate)

    // Clear the previous day's data immediately; never leave it visible under
    // a newly selected date while the occurrence range is loading.
    await setCurrentOccurrence(null)
    try {
        if (request === selectedDateRequest) isOccurrenceLoading.value = true
        const selectedDate = DateUtils.parseLocalDate(validDate)
        if (!selectedDate) return
        await loadSessionOccurrences(selectedDate)
        if (request !== selectedDateRequest) return
        const occurrence = findOccurrenceByDate(selectedDate) || null
        await setCurrentOccurrence(occurrence)
    } catch (error) {
        if (request === selectedDateRequest) {
            console.error('Failed to load selected class date:', error)
            occurrenceLoadError.value = t('classroom.occurrence_load_error')
        }
    } finally {
        if (request === selectedDateRequest) isOccurrenceLoading.value = false
    }
}

async function moveOccurrence(direction: 'previous' | 'next') {
    if (!todayOccurrence.value) return
    const adjacent = direction === 'previous' ? previousOccurrence.value : nextOccurrence.value
    if (!adjacent) return
    await selectClassDate(DateUtils.formatLocalDate(adjacent.occurrenceDate))
}

async function ensureTodayOccurrence(today: Date): Promise<void> {
    await loadSessionOccurrences(today)
    if (findOccurrenceByDate(today)) return
    if (session.value && await SessionService.isScheduledOn(sessionId, DateUtils.formatLocalDate(today))) {
        await OccurrenceCommandService.generateOccurrences(sessionId, today, today)
        await loadSessionOccurrences(today)
    }
}

async function goToToday() {
    const today = DateUtils.todayDate(sessionTimeZone.value)
    try {
        await ensureTodayOccurrence(today)
        const preferred = await OccurrenceQueryService.getPreferredOccurrence(sessionId, today)
        await selectClassDate(DateUtils.formatLocalDate(preferred?.occurrenceDate || today))
    } catch (error) {
        console.error(error)
        occurrenceLoadError.value = t('classroom.occurrence_load_error')
    }
}

function toggleCalendarPanel() {
    isCalendarExpanded.value = !isCalendarExpanded.value
}

// Keep complete roster metrics separate from the workflow filter.
const rosterLists = computed(() => getRosterEnrollments(
    enrollments.value,
    reportMap.value,
    studentSearchQuery.value,
    studentAttendanceFilter.value
))
const allRosterEnrollments = computed(() => rosterLists.value.all)
const filteredEnrollments = computed(() => rosterLists.value.filtered)
const selectedEditorEnrollment = computed(() =>
    allRosterEnrollments.value.find(enrollment => enrollment.id === selectedEnrollmentId.value)
    || selectedEditorEnrollmentSnapshot.value
)
const highlightedEnrollmentId = ref<string | null>(null)
let rosterHighlightTimer: ReturnType<typeof setTimeout> | null = null

const hasActiveStudentFilters = computed(() => Boolean(studentSearchQuery.value.trim()) || studentAttendanceFilter.value !== 'all')

function clearStudentFilters() {
    studentSearchQuery.value = ''
    studentAttendanceFilter.value = 'all'
}

async function focusRosterStudent(enrollmentId: string) {
    if (!filteredEnrollments.value.some(enrollment => enrollment.id === enrollmentId)) return

    highlightedEnrollmentId.value = enrollmentId
    if (rosterHighlightTimer) clearTimeout(rosterHighlightTimer)
    await nextTick()
    const visibleRosterItem = [...document.querySelectorAll<HTMLElement>(`[data-enrollment-id="${enrollmentId}"]`)]
        .find(element => element.offsetParent !== null)
    visibleRosterItem?.scrollIntoView({
        behavior: 'smooth', block: 'center'
    })
    rosterHighlightTimer = setTimeout(() => {
        if (highlightedEnrollmentId.value === enrollmentId) highlightedEnrollmentId.value = null
    }, 2000)
}

watch(filteredEnrollments, filtered => {
    const filteredIds = new Set(filtered.map(enrollment => enrollment.id!))
    selectedEnrollmentIds.value = new Set([...selectedEnrollmentIds.value].filter(id => filteredIds.has(id)))
})

const attendanceCounts = computed(() => countRosterAttendance(allRosterEnrollments.value, reportMap.value))
const occupiedRosterCount = computed(() => attendanceCounts.value.present + attendanceCounts.value.pending)
const teacherAttendanceCounts = computed(() => {
    let present = 0
    let absent = 0
    let onLeave = 0
    for (const teacher of occurrenceTeachers.value) {
        if (teacher.id && teacherLeaveById.value[teacher.id]) onLeave++
        else if (isTeacherPresent(teacher.id, teacher.user_id)) present++
        else absent++
    }
    return { present, absent, onLeave }
})
const lastRealtimeUpdateLabel = computed(() => lastRealtimeUpdateAt.value
    ? lastRealtimeUpdateAt.value.toLocaleTimeString(preferences.locale, {
        timeZone: preferences.timeZone,
        hour: '2-digit',
        minute: '2-digit',
    })
    : '')

function isTeacherOnLeave(teacherId?: string): boolean {
    return Boolean(teacherId && teacherLeaveById.value[teacherId])
}

function canEditTeacherAttendance(teacher: TeacherOverviewDTO): boolean {
    return auth.user?.id === teacher.user_id || canManageTeacherAttendance.value
}

async function loadData() {
    try {
        loading.value = true
        occurrenceLoadError.value = null
        reportMap.value = new Map()
        studentProgressSummaries.value = {}

        const workspace = (await PageApiService.getClassSessionWorkspace(sessionId)).data
        const rawSession = workspace.session as any
        session.value = {
            ...rawSession,
            schedule_rules: rawSession.schedule_rules ?? rawSession.class_session_schedule_rules ?? [],
            classroom_name: rawSession.classrooms?.name ?? 'Unknown',
            classroom_address: rawSession.classrooms?.address ?? '',
            classroom_external_link: rawSession.classrooms?.external_link ?? '',
        }
        const allEnrollments = workspace.enrollments.map(enrollment => new Enrollment(enrollment))
        enrollments.value = allEnrollments
        workspaceRosterDate = typeof rawSession.roster_date === 'string' ? rawSession.roster_date : null
        const [teacherAssignments, canManageAttendance] = await Promise.all([
            TeacherService.getSessionTeachers(sessionId),
            PermissionPolicyService.canUpdateOccurrence(sessionId)
        ])
        sessionTeachers.value = teacherAssignments
        canManageTeacherAttendance.value = canManageAttendance
        allTeachersList.value = workspace.teachers

        if (allEnrollments[0]?.courseId) courseLessons.value = courseLessonsByCourseId.value[allEnrollments[0].courseId] || []

        const today = DateUtils.todayDate(sessionTimeZone.value)
        const requestedDate = parseClassSessionDate(route.query.date)
        const initialDate = requestedDate ? DateUtils.parseLocalDate(requestedDate) || today : today
        todayOccurrence.value = null
        selectedDateKey.value = requestedDate || DateUtils.formatLocalDate(today)
        weekAnchorDate.value = initialDate

        let initialOccurrence: ClassOccurrence | null = null
        if (requestedDate) {
            await loadSessionOccurrences(initialDate)
            initialOccurrence = findOccurrenceByDate(initialDate) || null
        } else {
            await ensureTodayOccurrence(today)
            initialOccurrence = await OccurrenceQueryService.getPreferredOccurrence(sessionId, today)
            if (initialOccurrence) await loadSessionOccurrences(initialOccurrence.occurrenceDate)
        }
        if (initialOccurrence?.occurrenceDate) {
            selectedDateKey.value = DateUtils.formatLocalDate(initialOccurrence.occurrenceDate)
        }
        await setCurrentOccurrence(initialOccurrence)
        if (initialOccurrence?.occurrenceDate) {
            selectedDateKey.value = DateUtils.formatLocalDate(initialOccurrence.occurrenceDate)
        } else {
            selectedDateKey.value = DateUtils.formatLocalDate(initialDate)
        }
        syncSelectedDateToUrl(selectedDateKey.value)
        hasLoadedInitialData = true
    } catch (error) {
        console.error(error)
        occurrenceLoadError.value = t('classroom.occurrence_load_error')
    } finally {
        loading.value = false
    }
}

function scheduleRealtimeRefresh(invalidation?: unknown) {
    pendingRealtimeInvalidations.push(invalidation ?? {})
    if (realtimeRefreshTimer || realtimeRefreshRunning) return
    realtimeRefreshTimer = setTimeout(() => {
        realtimeRefreshTimer = null
        void flushRealtimeInvalidations()
    }, 300)
}

async function flushRealtimeInvalidations() {
    if (realtimeRefreshRunning || pendingRealtimeInvalidations.length === 0) return
    const events = pendingRealtimeInvalidations.splice(0)
    const selectedDate = selectedDateKey.value || DateUtils.todayString(sessionTimeZone.value)
    const relevantEvents = events.map(event => {
        const payload = event && typeof event === 'object' && 'payload' in event
            ? (event as { payload?: unknown }).payload
            : event
        return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    }).filter(payload => invalidationAffectsDate(selectedDate, payload))

    if (relevantEvents.length) {
        const reportOnly = relevantEvents.every(payload => payload.change === 'report')
        const refreshCatalog = relevantEvents.some(payload => payload.change === 'course_catalog' || payload.change === 'course' || payload.change === 'reconnect')
        await refreshCurrentOccurrenceFromRealtime({ reportOnly, refreshCatalog })
    }

    if (pendingRealtimeInvalidations.length && !realtimeRefreshTimer) {
        realtimeRefreshTimer = setTimeout(() => {
            realtimeRefreshTimer = null
            void flushRealtimeInvalidations()
        }, 0)
    }
}

async function refreshCurrentOccurrenceFromRealtime(options: { reportOnly?: boolean; refreshCatalog?: boolean } = {}) {
    if (realtimeRefreshRunning) return
    realtimeRefreshRunning = true
    const requestId = ++realtimeRefreshRequest
    const occurrenceAtStart = todayOccurrence.value as ClassOccurrence | null
    const selectedDate = (selectedDateKey.value && DateUtils.parseLocalDate(selectedDateKey.value))
        || occurrenceAtStart?.occurrenceDate
        || DateUtils.todayDate(sessionTimeZone.value)
    const selectedDateString = DateUtils.formatLocalDate(selectedDate)
    const selectedEnrollmentAtStart = selectedEnrollmentId.value
        ? enrollments.value.find(enrollment => enrollment.id === selectedEnrollmentId.value) || selectedEditorEnrollmentSnapshot.value
        : null
    isRealtimeRefreshing.value = true
    realtimeRefreshError.value = false
    try {
        await Promise.all([
            loadWorkspaceRoster(selectedDate, true),
            ...(!options.reportOnly ? [loadSessionOccurrences(selectedDate)] : []),
        ])
        if (requestId !== realtimeRefreshRequest || selectedDateKey.value !== selectedDateString || (todayOccurrence.value?.occurrenceDate && DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate) !== selectedDateString)) return

        if (!options.reportOnly) {
            const refreshedOccurrence = findOccurrenceByDate(selectedDate)
            if (refreshedOccurrence) todayOccurrence.value = refreshedOccurrence
            else if (occurrenceAtStart) todayOccurrence.value = null
        }

        if (selectedEnrollmentAtStart && selectedEnrollmentId.value) {
            selectedEditorEnrollmentSnapshot.value = enrollments.value.find(enrollment => enrollment.id === selectedEnrollmentId.value) || selectedEnrollmentAtStart
        }
        const validEnrollmentIds = new Set(enrollments.value.map(enrollment => enrollment.id).filter(Boolean))
        selectedEnrollmentIds.value = new Set([...selectedEnrollmentIds.value].filter(id => validEnrollmentIds.has(id)))

        if (todayOccurrence.value?.id) {
            const occurrenceId = todayOccurrence.value.id
            const occurrenceDate = todayOccurrence.value.occurrenceDate
            const date = DateUtils.formatLocalDate(occurrenceDate)
            if (!options.reportOnly) {
                const [assignments, holiday, navigation] = await Promise.all([
                    TeacherService.getSessionTeachers(sessionId),
                    HolidayQueryService.isHoliday(date, undefined, sessionId),
                    OccurrenceQueryService.getOccurrenceNavigationState(sessionId, occurrenceDate),
                ])
                if (requestId !== realtimeRefreshRequest || todayOccurrence.value?.id !== occurrenceId) return
                sessionTeachers.value = assignments
                isOccurrenceInHoliday.value = holiday
                previousOccurrence.value = navigation.previous
                nextOccurrence.value = navigation.next
            }
            // Realtime/background refreshes must only read the complete saved
            // roster. The provisioning POST intentionally creates reports for
            // a narrower set of active enrollments.
            await loadReportsForCurrentOccurrence({ createMissing: false })
            if (requestId !== realtimeRefreshRequest || todayOccurrence.value?.id !== occurrenceId) return
            if (options.refreshCatalog) {
                await Promise.all([...new Set(enrollments.value.map(enrollment => enrollment.courseId).filter(Boolean))]
                    .map(courseId => getLessonsForCourse(courseId, { refresh: true })))
            }
            await Promise.all([
                ...(!options.reportOnly ? [loadOccurrenceTeachers()] : []),
                loadStudentProgressSummaries(enrollments.value, 'replace', occurrenceDate, {
                    loadMissingLessons: !options.reportOnly,
                }),
                loadStudentProgressGaps(enrollments.value, todayOccurrence.value),
            ])
            if (progressGapCheckFailed.value) throw new Error('Failed to refresh course progress gaps')
            if (options.refreshCatalog && selectedEditorEnrollment.value?.courseId) {
                courseLessons.value = courseLessonsByCourseId.value[selectedEditorEnrollment.value.courseId] || []
            }
        } else {
            // A remote change can remove the currently selected occurrence
            // (for example, an occurrence was deleted) while its editor is
            // still open. Keep that report mounted until the user closes it
            // so local Yjs state and pending edits are not reset by the page
            // refresh.
            const selectedId = showSplitView.value ? selectedEnrollmentId.value : null
            const selectedReport = selectedId ? reportMap.value.get(selectedId) : null
            reportMap.value = selectedId && selectedReport
                ? new Map([[selectedId, selectedReport]])
                : new Map()
            studentProgressSummaries.value = {}
            studentProgressGaps.value = {}
            progressGapRequestGeneration++
            isLoadingProgressGaps.value = false
            progressGapCheckFailed.value = false
        }

        if (requestId !== realtimeRefreshRequest) return
        lastRealtimeUpdateAt.value = new Date()
    } catch (error) {
        if (requestId !== realtimeRefreshRequest) return
        console.error('Failed to refresh class session after a remote change:', error)
        realtimeRefreshError.value = true
    } finally {
        if (requestId === realtimeRefreshRequest) isRealtimeRefreshing.value = false
        realtimeRefreshRunning = false
    }
}

function startClassSessionRealtime() {
    const presenceKey = `${auth.user?.id || 'user'}:${Date.now()}`
    classSessionChannel = new ApiRealtimeChannel(sessionId, presenceKey, 'class_session')
        .on('broadcast', { event: 'class_session_invalidated' }, (message) => scheduleRealtimeRefresh(message?.payload))
    classSessionChannel.subscribe((status, detail) => {
        if (status === 'SUBSCRIBED') {
            realtimeStatus.value = 'connected'
            realtimeStatusDetail.value = ''
            if (hasJoinedClassSessionChannel) scheduleRealtimeRefresh({ change: 'reconnect' })
            hasJoinedClassSessionChannel = true
        } else if (status === 'CONNECTING') {
            realtimeStatus.value = 'connecting'
        } else if (status === 'SUBSCRIBING') {
            realtimeStatus.value = 'subscribing'
        } else if (status === 'RECONNECTING') {
            realtimeStatus.value = 'reconnecting'
        } else if (status === 'CHANNEL_ERROR') {
            realtimeStatusDetail.value = detail || ''
        } else if (status === 'OFFLINE') {
            realtimeStatus.value = 'offline'
            realtimeStatusDetail.value = ''
        } else if (status === 'PERMISSION_DENIED') {
            realtimeStatus.value = 'forbidden'
            realtimeStatusDetail.value = detail || ''
        } else if (status === 'AUTH_EXPIRED') {
            realtimeStatus.value = 'expired'
            realtimeStatusDetail.value = detail || ''
        } else if (status === 'ACCOUNT_DISABLED') {
            realtimeStatus.value = 'disabled'
            realtimeStatusDetail.value = detail || ''
        } else {
            if (!['forbidden', 'expired', 'disabled'].includes(realtimeStatus.value)) realtimeStatus.value = 'reconnecting'
        }
    })
}

function retryRealtimeAction() {
    if (realtimeRefreshError.value) {
        scheduleRealtimeRefresh()
        return
    }
    classSessionChannel?.reconnect()
    realtimeStatus.value = 'connecting'
}

onMounted(async () => {
    await loadData()
    startClassSessionRealtime()
})

watch(() => route.query.date, (value) => {
    if (!hasLoadedInitialData) return
    const date = parseClassSessionDate(value)
    if (!date) {
        const today = DateUtils.todayString(sessionTimeZone.value)
        void selectClassDate(today)
        return
    }
    if (date !== selectedDateKey.value) void selectClassDate(date, false)
})

onBeforeUnmount(() => {
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
    realtimeRefreshTimer = null
    classSessionChannel?.unsubscribe()
    classSessionChannel = null
})

// Attendance & Rating Handlers
async function setAttendance(enrId: string, status: QuickAttendanceStatus) {
    if (isOccurrenceInHoliday.value) {
        errorKey('report.error.cannot_set_conducted_during_holiday')
        return
    }
    const report = reportMap.value.get(enrId)
    if (!report || savingMap.value.get(enrId) || (report.attendanceStatus || 'pending') === status) return
    const occurrenceId = todayOccurrence.value?.id
    if (!occurrenceId || report.classOccurrenceId !== occurrenceId) return

    savingMap.value.set(enrId, true)
    try {
        const result = await ReportCommandService.saveAttendanceOnly(report.id, report.version, undefined, {
            attendanceStatus: status,
            absenceReason: status === 'absent' ? 'reason_not_provided' : null
        })
        if (!result.success || !result.updatedReport) {
            throw new Error(result.message || 'Attendance save did not return the committed report')
        }
        if (todayOccurrence.value?.id !== occurrenceId
            || reportMap.value.get(enrId)?.id !== report.id
            || !enrollments.value.some(enrollment => enrollment.id === enrId)) return
        const current = reportMap.value.get(enrId) as OccurrenceReport | null | undefined
        const updatedReport = new OccurrenceReport(result.updatedReport)
        if (!shouldApplyCommittedReport(updatedReport, current, enrId, occurrenceId)) return
        reportMap.value = new Map(reportMap.value).set(enrId, updatedReport)
    } catch (error) {
        console.error('Failed to set attendance:', error)
        reportError(error, 'common.save_error')
    } finally {
        savingMap.value.delete(enrId)
    }
}

async function batchSetAttendance(status: QuickAttendanceStatus) {
    if (isOccurrenceInHoliday.value) {
        errorKey('report.error.cannot_set_conducted_during_holiday')
        return
    }
    const visibleIds = new Set(filteredEnrollments.value.map(enrollment => enrollment.id))
    const ids = [...selectedEnrollmentIds.value].filter(id => visibleIds.has(id))
    if (ids.length === 0) return
    await Promise.all(ids.map(id => setAttendance(id, status)))
    selectedEnrollmentIds.value = new Set()
    toast.success(t('common.save_success'))
}

function toggleEnrollmentSelection(enrId: string) {
    if (!reportMap.value.has(enrId)) return
    const next = new Set(selectedEnrollmentIds.value)
    next.has(enrId) ? next.delete(enrId) : next.add(enrId)
    selectedEnrollmentIds.value = next
}

function toggleSelectAll() {
    const visibleIds = filteredEnrollments.value.map(enrollment => enrollment.id!).filter(id => Boolean(id) && reportMap.value.has(id))
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedEnrollmentIds.value.has(id))
    selectedEnrollmentIds.value = allSelected ? new Set() : new Set(visibleIds)
}

const quickAttendanceStudents = computed(() => filteredEnrollments.value.map(enrollment => ({
    id: enrollment.id!,
    name: enrollment.studentName || t('common.unnamed'),
    currentCourse: enrollment.courseDisplayName || [enrollment.courseSubject, enrollment.courseStage].filter(Boolean).join(' ') || t('classroom.progress_no_record'),
    status: (reportMap.value.get(enrollment.id!)?.attendanceStatus || 'pending') as QuickAttendanceStatus,
    isSaving: savingMap.value.get(enrollment.id!) === true,
    disabled: !reportMap.value.has(enrollment.id!),
    disabledReason: !reportMap.value.has(enrollment.id!) ? t('classroom.trial_report_unavailable') : undefined,
    progressGaps: studentProgressGaps.value[enrollment.id!] || []
})))

const studentRosterItems = computed<StudentRosterItem[]>(() => filteredEnrollments.value.map(enrollment => {
    const progress = getStudentProgressSummary(enrollment.id)
    const today = getTodayCourseSummary(enrollment)
    const attendanceStatus = (reportMap.value.get(enrollment.id!)?.attendanceStatus || 'pending') as QuickAttendanceStatus
    const absenceReason = reportMap.value.get(enrollment.id!)?.absenceReason || null
    const absenceReasonText = absenceReasonLabel(absenceReason, t)
    return {
        id: enrollment.id!,
        studentId: enrollment.studentId || '',
        reportHref: router.resolve({ name: 'lesson-reports', params: { enrollmentId: enrollment.id } }).href,
        profileHref: enrollment.studentId
            ? router.resolve({ name: 'student-profile', params: { id: enrollment.studentId } }).href
            : null,
        name: enrollment.studentName || t('classroom.koding_unnamed_account'),
        initials: enrollment.studentName?.trim().charAt(0) || '?',
        currentCourse: progress.currentCourse,
        enrollmentStatus: t('student.internal_courses.status_' + enrollment.status),
        enrollmentTone: enrollment.status === 'regular' ? 'regular' : enrollment.status === 'trial' ? 'trial' : 'inactive',
        isGuest: Boolean((enrollment as any).isGuest),
        transferInLabel: transferInLabels.value.get(enrollment.id!) ?? null,
        classTransferInLabel: classTransferInIds.value.has(enrollment.id!) ? t('classroom.lesson_transfer.class_transferred_in') : null,
        attendanceStatus,
        attendanceLabel: t('attendance.' + attendanceStatus),
        absenceReason,
        absenceReasonLabel: absenceReasonText,
        isSavingAttendance: savingMap.value.get(enrollment.id!) === true,
        todayTitle: today.title,
        todayProgress: today.chapterProgress,
        todayCompletion: today.completionStatus,
        todayTone: today.tone,
        highestTitle: progress.highestProgressTitle,
        highestStatus: progress.highestProgressStatus,
        highestTone: progress.highestProgressTone,
        latestTitle: progress.latestProgressTitle,
        latestStatus: progress.latestProgressStatus,
        latestTone: progress.latestProgressTone,
        isEditing: selectedEnrollmentId.value === enrollment.id && showSplitView.value,
        reportAvailable: reportMap.value.has(enrollment.id!),
        progressGaps: studentProgressGaps.value[enrollment.id!] || []
    }
}))



function openStudentKodingCheck(enrollmentId: string) {
    const enrollment = enrollments.value.find(item => item.id === enrollmentId)
    if (enrollment) openKodingCheck(enrollment)
}

const attendanceTemplateVariables = computed(() => {
    const previewNames = getAttendancePreviewNames()

    return ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS.map(definition => {
        const previewValue = getAttendanceVariablePreview(definition.key, previewNames)
        return {
            ...definition,
            token: formatCopyTemplateToken(definition.key, getSelectedAttendanceTemplateMode(definition.key)),
            label: t(`classroom.copy_template_variable_labels.${definition.key}`),
            description: t(`classroom.copy_template_variable_descriptions.${definition.key}`),
            previewValue,
            modeOptions: (definition.modes || []).map(mode => ({
                ...mode,
                label: t(`classroom.copy_template_variable_modes.${mode.value}`)
            }))
        }
    })
})

const attendanceTemplatePreviewText = computed(() => {
    if (!attendanceTemplateText.value.trim()) {
        return ''
    }

    const context = buildAttendanceTemplateContext()
    return renderCopyTemplate(attendanceTemplateText.value, context.values, context.formatters).trim()
})

function getSelectedAttendanceTemplateMode(variable: string): string | undefined {
    return selectedAttendanceTemplateModes.value[variable] || ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS.find(item => item.key === variable)?.defaultMode
}

function formatAttendanceNameList(names: string[], mode: string): string {
    const safeNames = names.filter(Boolean)
    if (safeNames.length === 0) {
        return t('common.none')
    }

    switch (mode) {
        case 'slash':
            return safeNames.join(' / ')
        case 'newline':
            return safeNames.join('\n')
        case 'bullet':
            return safeNames.map(name => `• ${name}`).join('\n')
        case 'space':
            return safeNames.join(' ')
        case 'comma':
            return safeNames.join(', ')
        default:
            return safeNames.join(', ')
    }
}

function getAttendancePreviewNames(): Record<'present_list' | 'absent_list' | 'pending_list', string[]> {
    const fallback = ['王小明', '陳小華', '林小美']

    const grouped = {
        present_list: [] as string[],
        absent_list: [] as string[],
        pending_list: [] as string[]
    }

    allRosterEnrollments.value.forEach(enrollment => {
        const report = reportMap.value.get(enrollment.id!)
        const status = report?.attendanceStatus || 'pending'
        const name = enrollment.studentName || ''
        if (!name) {
            return
        }

        if (status === 'present') {
            grouped.present_list.push(name)
        } else if (status === 'absent') {
            grouped.absent_list.push(name)
        } else {
            grouped.pending_list.push(name)
        }
    })

    if (grouped.present_list.length === 0 && grouped.absent_list.length === 0 && grouped.pending_list.length === 0) {
        grouped.present_list = [...fallback.slice(0, 2)]
        grouped.absent_list = [fallback[2]]
        grouped.pending_list = [t('classroom.pending_list')]
    }

    return grouped
}

function getAttendanceVariablePreview(variable: string, names: Record<'present_list' | 'absent_list' | 'pending_list', string[]>): string {
    switch (variable) {
        case 'class_info_title':
            return t('classroom.class_info_title')
        case 'session_name':
            return session.value?.name || t('classroom.session')
        case 'occurrence_date':
            return todayOccurrence.value?.occurrenceDate
                ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale)
                : t('classroom.no_teaching_day_selected')
        case 'start_time':
            return todayOccurrence.value?.originalStartTime?.substring(0, 5) || '10:00'
        case 'end_time':
            return todayOccurrence.value?.originalEndTime?.substring(0, 5) || '12:00'
        case 'time_range':
            return `${getAttendanceVariablePreview('start_time', names)}-${getAttendanceVariablePreview('end_time', names)}`
        case 'present_list_label':
            return t('classroom.present_list')
        case 'absent_list_label':
            return t('classroom.absent_list')
        case 'pending_list_label':
            return t('classroom.pending_list')
        case 'present_list':
            return formatAttendanceNameList(names.present_list, getSelectedAttendanceTemplateMode('present_list') || 'comma')
        case 'absent_list':
            return formatAttendanceNameList(names.absent_list, getSelectedAttendanceTemplateMode('absent_list') || 'comma')
        case 'pending_list':
            return formatAttendanceNameList(names.pending_list, getSelectedAttendanceTemplateMode('pending_list') || 'comma')
        default:
            return ''
    }
}

function buildAttendanceTemplateContext() {
    const previewNames = getAttendancePreviewNames()
    const presentList = formatAttendanceNameList(previewNames.present_list, getSelectedAttendanceTemplateMode('present_list') || 'comma')
    const absentList = formatAttendanceNameList(previewNames.absent_list, getSelectedAttendanceTemplateMode('absent_list') || 'comma')
    const pendingList = formatAttendanceNameList(previewNames.pending_list, getSelectedAttendanceTemplateMode('pending_list') || 'comma')

    return {
        values: {
            class_info_title: t('classroom.class_info_title'),
            session_name: session.value?.name || '',
            occurrence_date: todayOccurrence.value?.occurrenceDate ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale) : '',
            start_time: todayOccurrence.value?.originalStartTime?.substring(0, 5) || '',
            end_time: todayOccurrence.value?.originalEndTime?.substring(0, 5) || '',
            time_range: `${todayOccurrence.value?.originalStartTime?.substring(0, 5) || ''}-${todayOccurrence.value?.originalEndTime?.substring(0, 5) || ''}`,
            present_list_label: t('classroom.present_list'),
            absent_list_label: t('classroom.absent_list'),
            pending_list_label: t('classroom.pending_list'),
            present_list: presentList,
            absent_list: absentList,
            pending_list: pendingList
        },
        formatters: {
            present_list: {
                comma: () => formatAttendanceNameList(previewNames.present_list, 'comma'),
                slash: () => formatAttendanceNameList(previewNames.present_list, 'slash'),
                newline: () => formatAttendanceNameList(previewNames.present_list, 'newline'),
                bullet: () => formatAttendanceNameList(previewNames.present_list, 'bullet'),
                space: () => formatAttendanceNameList(previewNames.present_list, 'space')
            },
            absent_list: {
                comma: () => formatAttendanceNameList(previewNames.absent_list, 'comma'),
                slash: () => formatAttendanceNameList(previewNames.absent_list, 'slash'),
                newline: () => formatAttendanceNameList(previewNames.absent_list, 'newline'),
                bullet: () => formatAttendanceNameList(previewNames.absent_list, 'bullet'),
                space: () => formatAttendanceNameList(previewNames.absent_list, 'space')
            },
            pending_list: {
                comma: () => formatAttendanceNameList(previewNames.pending_list, 'comma'),
                slash: () => formatAttendanceNameList(previewNames.pending_list, 'slash'),
                newline: () => formatAttendanceNameList(previewNames.pending_list, 'newline'),
                bullet: () => formatAttendanceNameList(previewNames.pending_list, 'bullet'),
                space: () => formatAttendanceNameList(previewNames.pending_list, 'space')
            }
        }
    }
}

function insertAttendanceTemplateVariable(variable: string) {
    const mode = getSelectedAttendanceTemplateMode(variable)
    attendanceTemplateModal.value?.insertVariableAtFocus(formatCopyTemplateToken(variable, mode))
}

function loadSelectedAttendanceTemplate() {
    const selected = attendanceTemplateLoadOptions.value.find(item => item.key === selectedAttendanceTemplateLoadKey.value)
    if (!selected) {
        return
    }

    attendanceTemplateText.value = selected.templateText || SYSTEM_ATTENDANCE_TEMPLATE
    attendanceTemplateDocument.value = createTextEditorContent(
        selected.templateDocument || attendanceTemplateText.value,
        { templateVariables: true }
    ).richText
}

async function openAttendanceTemplateModal() {
    const requestGeneration = ++attendanceTemplateRequestGeneration
    showAttendanceTemplateModal.value = true
    attendanceTemplateScope.value = 'class_session'
    attendanceTemplateText.value = SYSTEM_ATTENDANCE_TEMPLATE
    attendanceTemplateDocument.value = createTextEditorContent(
        SYSTEM_ATTENDANCE_TEMPLATE,
        { templateVariables: true }
    ).richText
    selectedAttendanceTemplateModes.value = {
        present_list: 'comma',
        absent_list: 'comma',
        pending_list: 'comma'
    }

    try {
        isLoadingAttendanceTemplate.value = true
        const bundle = await CopyTemplateQueryService.getEditorBundle('attendance_copy', sessionId)
        if (requestGeneration !== attendanceTemplateRequestGeneration || !showAttendanceTemplateModal.value) return
        const loadOptions = bundle.options
        const classTemplate = bundle.current?.scopeType === 'class_session' ? bundle.current.templateText : null
        const userTemplate = bundle.current?.scopeType === 'user_default' ? bundle.current.templateText : null

        attendanceTemplateLoadOptions.value = loadOptions.map(item => {
            let label = item.label
            if (item.label === 'system_default') {
                label = t('classroom.copy_template_source_system')
            } else if (item.label === 'user_default') {
                label = t('classroom.copy_template_source_user_default')
            } else if (item.scopeType === 'class_session' && item.scopeEntityId === sessionId) {
                label = `${item.label} (${t('classroom.copy_template_source_current_session')})`
            }

            return {
                key: item.key,
                label,
                templateText: item.templateText,
                templateDocument: item.templateDocument
            }
        })
        selectedAttendanceTemplateLoadKey.value = attendanceTemplateLoadOptions.value[0]?.key || ''

        if (classTemplate) {
            attendanceTemplateScope.value = 'class_session'
            attendanceTemplateText.value = classTemplate
            const option = loadOptions.find(item =>
                item.scopeType === 'class_session' && item.scopeEntityId === sessionId
            )
            attendanceTemplateDocument.value = createTextEditorContent(
                option?.templateDocument || classTemplate,
                { templateVariables: true }
            ).richText
            return
        }

        if (userTemplate) {
            attendanceTemplateScope.value = 'user_default'
            attendanceTemplateText.value = userTemplate
            const option = loadOptions.find(item => item.scopeType === 'user_default')
            attendanceTemplateDocument.value = createTextEditorContent(
                option?.templateDocument || userTemplate,
                { templateVariables: true }
            ).richText
            return
        }

        attendanceTemplateText.value = SYSTEM_ATTENDANCE_TEMPLATE
        attendanceTemplateDocument.value = createTextEditorContent(
            SYSTEM_ATTENDANCE_TEMPLATE,
            { templateVariables: true }
        ).richText
    } catch (error) {
        console.error('Failed to load attendance copy template', error)
        reportError(error, 'classroom.copy_template_load_failed')
    } finally {
        if (requestGeneration === attendanceTemplateRequestGeneration) isLoadingAttendanceTemplate.value = false
    }
}

watch(showAttendanceTemplateModal, value => { if (!value) attendanceTemplateRequestGeneration++ })

async function saveAttendanceTemplate() {
    const content = createTextEditorContent(attendanceTemplateDocument.value, { templateVariables: true })
    if (!content.plainText.trim()) {
        errorKey('classroom.copy_template_empty_error')
        return
    }

    try {
        isSavingAttendanceTemplate.value = true
        if (attendanceTemplateScope.value === 'class_session') {
            await CopyTemplateCommandService.saveAttendanceTemplateForSession(sessionId, content)
            toast.success(t('classroom.copy_template_saved_session'))
        } else {
            await CopyTemplateCommandService.saveAttendanceTemplateAsUserDefault(content)
            toast.success(t('classroom.copy_template_saved_user'))
        }

        showAttendanceTemplateModal.value = false
    } catch (error) {
        console.error('Failed to save attendance copy template', error)
        reportError(error, 'classroom.copy_template_save_failed')
    } finally {
        isSavingAttendanceTemplate.value = false
    }
}

function copyAttendanceInfo() {
    if (!todayOccurrence.value || !session.value) return

    const date = new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString(preferences.locale)
    const startTime = todayOccurrence.value.originalStartTime?.substring(0, 5) || ''
    const endTime = todayOccurrence.value.originalEndTime?.substring(0, 5) || ''
    const time = `${startTime}-${endTime}`

    // Helper to format list
    const formatList = (status: 'present' | 'absent' | 'pending') => {
        const list = allRosterEnrollments.value
            .filter(e => {
                const report = reportMap.value.get(e.id!)
                const s = report?.attendanceStatus || 'pending' // Default to pending if missing
                return s === status
            })
            .map(e => e.studentName)
            .join(', ')
        return list || t('common.none')
    }

    const presentList = formatList('present')
    const absentList = formatList('absent')
    const pendingList = formatList('pending')

    const context = {
        class_info_title: t('classroom.class_info_title'),
        session_name: session.value.name || '',
        occurrence_date: date,
        start_time: startTime,
        end_time: endTime,
        time_range: time,
        present_list_label: t('classroom.present_list'),
        absent_list_label: t('classroom.absent_list'),
        pending_list_label: t('classroom.pending_list'),
        present_list: presentList,
        absent_list: absentList,
        pending_list: pendingList
    }

    const formatters = buildAttendanceTemplateContext().formatters
    const copyPromise = CopyTemplateQueryService.getEffectiveAttendanceTemplate(sessionId)
        .then(({ templateText, templateDocument }) => renderTemplateContent(
            templateDocument || templateText,
            (key, mode) => renderCopyTemplate(
                formatCopyTemplateToken(key, mode || undefined),
                context,
                formatters
            ),
            text => renderCopyTemplate(text, context, formatters)
        ))

    copyRichTextToClipboard(copyPromise).then(success => {
        if (success) {
            toast.success(t('classroom.copy_success'))
        } else {
            errorKey('classroom.copy_error')
        }
    }).catch(err => {
        console.error('Failed to copy: ', err)
        reportError(err, 'classroom.copy_error')
    })
}

// Refresh Schedule Logic
const showRefreshConfirm = ref(false)

function requestRefreshSchedule() {
    showRefreshConfirm.value = true
}

async function handleConfirmRefresh() {
    try {
        isRefreshing.value = true
        await OccurrenceSyncService.syncSessionOccurrences(sessionId)
        toast.success(t('classroom.refresh_success'))
        showRefreshConfirm.value = false
        await loadData()
    } catch (e) {
        console.error(e)
        // @ts-ignore
        reportError(e, 'classroom.refresh_failed')
        showRefreshConfirm.value = false
    } finally {
        isRefreshing.value = false
    }
}

async function toggleIsConducted(event: any) {
    if (!todayOccurrence.value) return
    const isHeld = event.target.checked

    // Guard: check if occurrence is in a holiday period
    if (isOccurrenceInHoliday.value && isHeld) {
        event.target.checked = false
        errorKey('report.error.cannot_set_conducted_during_holiday')
        return
    }

    try {
        const updated = await OccurrenceCommandService.updateOccurrence(todayOccurrence.value.id, {
            is_conducted: isHeld
        })

        todayOccurrence.value.isConducted = updated.isConducted ?? isHeld
    } catch (e: any) {
        console.error('Failed to update class status:', e)
        event.target.checked = !isHeld
        const msg = e.message || ''
        if (msg.includes('Cannot set is_conducted=true')) {
            errorKey('report.error.cannot_set_conducted_during_holiday')
        } else {
            errorKey('common.save_error')
        }
    }
}

function isTeacherPresent(teacherId: string | undefined, userId: string | null | undefined): boolean {
    if (!teacherId || !todayOccurrence.value?.teacherAttendance) return false
    return isTeacherPresentForScope({
        teacherId,
        teacherUserId: userId,
        occurrenceTeacherIds: occurrenceTeachers.value.map(teacher => teacher.id).filter((id): id is string => Boolean(id)),
        teacherAttendance: todayOccurrence.value.teacherAttendance
    })
}

async function toggleTeacherAttendance(teacherId: string | undefined, event: any) {
    if (!todayOccurrence.value || !teacherId) return
    const isPresent = event.target.checked

    // Guard: check if occurrence is in a holiday period
    if (isOccurrenceInHoliday.value && isPresent) {
        event.target.checked = false
        errorKey('report.error.cannot_set_teacher_present_during_holiday')
        return
    }

    try {
        const existing = todayOccurrence.value.teacherAttendance || {}
        const updatedAttendance = { ...existing, [teacherId]: isPresent }

        const updated = await OccurrenceCommandService.updateOccurrence(todayOccurrence.value.id, {
            teacher_attendance: updatedAttendance
        })

        todayOccurrence.value.teacherAttendance = updated.teacherAttendance || updatedAttendance
    } catch (e: any) {
        console.error('Failed to update teacher attendance:', e)
        event.target.checked = !isPresent
        const msg = e.message || ''
        if (msg.includes('while the teacher is on leave')) {
            errorKey('report.error.cannot_set_teacher_present_during_leave')
        } else if (msg.includes('Cannot set teacher attendance to present')) {
            errorKey('report.error.cannot_set_teacher_present_during_holiday')
        } else {
            errorKey('common.save_error')
        }
    }
}

async function toggleSplitView(enrollmentId: string) {
    if (selectedEnrollmentId.value === enrollmentId && showSplitView.value) {
        await closeSplitView()
        return
    }

    const selectionRequest = ++editorSelectionRequest
    const saveSucceeded = await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
    if (saveSucceeded === false || selectionRequest !== editorSelectionRequest) return

    const occurrenceId = todayOccurrence.value?.id
    const occurrenceDate = todayOccurrence.value?.occurrenceDate
    const dateKey = occurrenceDate ? DateUtils.formatLocalDate(occurrenceDate) : null

    // Resolve course lessons without allowing a slow request to change the
    // editor after the user selected another student or occurrence.
    const enrollment = enrollments.value.find(e => e.id === enrollmentId)
    if (enrollment?.courseId) {
        const lessons = await getLessonsForCourse(enrollment.courseId)
        if (selectionRequest !== editorSelectionRequest
            || todayOccurrence.value?.id !== occurrenceId
            || selectedDateKey.value !== dateKey) return
        courseLessons.value = lessons
    }

    let editorReport = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
    // Resolve the current persisted version before mounting the editor. Once
    // mounted, background refreshes only replace the card snapshot.
    if (occurrenceId) {
        savingMap.value.set(enrollmentId, true)
        try {
            const fetched = await ReportQueryService.getReport(enrollmentId, occurrenceId)
            if (selectionRequest !== editorSelectionRequest
                || todayOccurrence.value?.id !== occurrenceId
                || selectedDateKey.value !== dateKey) return
            if (fetched) {
                const cardReport = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
                editorReport = cardReport && cardReport.id === fetched.id && cardReport.version > fetched.version ? cardReport : fetched
                reportMap.value = new Map(reportMap.value).set(enrollmentId, editorReport)
            }
        } catch (error) {
            console.error('Failed to sync report on quick edit open', error)
        } finally {
            savingMap.value.delete(enrollmentId)
        }
    }

    if (selectionRequest !== editorSelectionRequest
        || todayOccurrence.value?.id !== occurrenceId
        || selectedDateKey.value !== dateKey) return

    selectedEnrollmentId.value = enrollmentId
    selectedEditorEnrollmentSnapshot.value = enrollment || null
    selectedEditorReportSnapshot.value = editorReport ? new OccurrenceReport(editorReport.toDTO()) : null
    showSplitView.value = true
}

async function closeSplitView() {
    const enrollmentIdToRestore = selectedEnrollmentId.value
    editorSelectionRequest++
    const saveSucceeded = await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
    if (saveSucceeded === false) return
    showSplitView.value = false
    selectedEnrollmentId.value = null
    selectedEditorEnrollmentSnapshot.value = null
    selectedEditorReportSnapshot.value = null

    await nextTick()
    if (enrollmentIdToRestore) scrollToEnrollment(enrollmentIdToRestore)
}

function scrollToEnrollment(enrollmentId: string) {
    requestAnimationFrame(() => {
        const selector = `[data-enrollment-id="${enrollmentId}"]`
        const targets = Array.from(document.querySelectorAll<HTMLElement>(selector))
        const target = targets.find(el => el.offsetParent !== null) || targets[0]
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
}

async function openKodingCheck(enrollment: Enrollment) {
    kodingTargetEnrollment.value = enrollment
    kodingInitialLessonId.value = reportMap.value.get(enrollment.id!)?.lessonId || null
    showKodingCheckModal.value = true
}

async function openAddStudentModal() {
    showAddStudentModal.value = true
    makeupSubmitError.value = ''
    makeupSearch.value = ''
    selectedMakeupStudentId.value = ''
    selectedMakeupEnrollmentId.value = ''
    makeupJoinDate.value = normalizeDateInput(todayOccurrence.value?.occurrenceDate)

    try {
        isAddingStudent.value = true
        makeupCandidates.value = await EnrollmentQueryService.getActiveEnrollmentCandidates()
    } catch (error: any) {
        reportError(error, 'classroom.add_student_load_failed')
        showAddStudentModal.value = false
    } finally {
        isAddingStudent.value = false
    }
}

function closeAddStudentModal() {
    showAddStudentModal.value = false
}

async function submitAddStudentToClass() {
    if (!selectedMakeupStudentId.value || !selectedMakeupEnrollmentId.value || !makeupJoinDate.value) {
        errorKey('classroom.add_student_required_fields')
        return
    }

    const normalizedJoinDate = normalizeDateInput(makeupJoinDate.value)
    makeupJoinDate.value = normalizedJoinDate

    const selected = selectedMakeupEnrollment.value
    if (!selected) {
        errorKey('classroom.add_student_enrollment_not_found')
        return
    }

    if (selected.status !== 'regular' && normalizedJoinDate >= DateUtils.todayString(preferences.timeZone)) {
        errorKey('classroom.add_student_active_only_for_future')
        return
    }

    try {
        isAddingStudent.value = true
        makeupSubmitError.value = ''
        await EnrollmentCommandService.addEnrollmentToSessionOccurrence(
            selectedMakeupEnrollmentId.value,
            sessionId,
            normalizedJoinDate
        )

        if (selectedDateKey.value === normalizedJoinDate) {
            try {
                const displayDate = DateUtils.parseLocalDate(normalizedJoinDate)
                if (displayDate) {
                    await loadSessionOccurrences(displayDate)
                    const refreshedOccurrence = findOccurrenceByDate(displayDate)
                    if (refreshedOccurrence && todayOccurrence.value?.id !== refreshedOccurrence.id) {
                        await setCurrentOccurrence(refreshedOccurrence)
                    } else if (refreshedOccurrence) {
                        const occurrenceDate = refreshedOccurrence.occurrenceDate
                        await loadWorkspaceRoster(occurrenceDate, true)
                        await loadReportsForCurrentOccurrence({ createMissing: false })
                        await Promise.all([
                            loadStudentProgressSummaries(enrollments.value, 'replace', occurrenceDate),
                            loadStudentProgressGaps(enrollments.value, todayOccurrence.value),
                        ])
                    }
                }
            } catch (refreshError) {
                // The makeup report is already committed; a roster refresh
                // failure must not make retrying the add operation duplicate it.
                console.error('Failed to refresh the class roster after adding a makeup report:', refreshError)
            }
        }

        toast.success(t('classroom.add_student_success'))
        closeAddStudentModal()
    } catch (error: any) {
        let errorMessage = t('classroom.add_student_retry_error')
        if (error?.message?.includes('Invalid date format')) {
            errorMessage = t('classroom.add_student_invalid_date')
        } else if (error?.message?.includes('DUPLICATE_OCCURRENCE_REPORT')) {
            errorMessage = t('classroom.add_student_duplicate_report')
        } else if (error?.message?.includes('MAKEUP_DATE_NOT_CLASS_DAY')) {
            errorMessage = t('classroom.add_student_not_class_day')
        }
        makeupSubmitError.value = errorMessage
        await nextTick()
        makeupSubmitErrorElement.value?.focus()
    } finally {
        isAddingStudent.value = false
    }
}

function handleEditorUpdate(content: string, enrollmentId: string) {
    const report = selectedEnrollmentId.value === enrollmentId ? selectedEditorReportSnapshot.value : null
    if (report) {
        report.content = content
    }
}

function handleReportExternalLinkUpdate(link: string, enrollmentId: string) {
    const report = selectedEnrollmentId.value === enrollmentId ? selectedEditorReportSnapshot.value : null
    if (report) {
        report.externalLink = link
    }
}

function handleSaveSuccess(updatedReport: OccurrenceReportDTO, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
    const occurrenceId = todayOccurrence.value?.id
    if (!occurrenceId || !enrollments.value.some(enrollment => enrollment.id === enrollmentId)) return
    const incomingReport = new OccurrenceReport(updatedReport)
    if (!shouldApplyCommittedReport(incomingReport, report, enrollmentId, occurrenceId)) return
    const progressChanged = !report
        || report.lessonId !== updatedReport.lesson_id
        || report.isCompleted !== (updatedReport.is_completed ?? false)
        || report.progressLetter !== updatedReport.progress_letter
        || report.attendanceStatus !== updatedReport.attendance_status

    // Cards intentionally show committed data only. Keep the editor's own
    // draft snapshot independent so this replacement cannot reset its fields.
    reportMap.value = new Map(reportMap.value).set(enrollmentId, incomingReport)
    if (progressChanged) void refreshStudentProgressAfterSave(enrollmentId, todayOccurrence.value)
}

async function refreshStudentProgressAfterSave(enrollmentId: string, occurrence: ClassOccurrence | null) {
    if (!occurrence?.id || !occurrence.occurrenceDate) return
    const date = DateUtils.formatLocalDate(occurrence.occurrenceDate)
    const generation = realtimeRefreshRequest
    if (!enrollments.value.some(item => item.id === enrollmentId)) return
    try {
        await Promise.all([
            loadStudentProgressSummaries(enrollments.value, 'replace', occurrence.occurrenceDate, { loadMissingLessons: false }),
            loadStudentProgressGaps(enrollments.value, occurrence),
        ])
        if (progressGapCheckFailed.value) throw new Error('Failed to refresh course progress gaps')
        if (generation !== realtimeRefreshRequest
            || todayOccurrence.value?.id !== occurrence.id
            || selectedDateKey.value !== date) return
        lastRealtimeUpdateAt.value = new Date()
        realtimeRefreshError.value = false
    } catch (error) {
        if (generation !== realtimeRefreshRequest
            || todayOccurrence.value?.id !== occurrence.id
            || selectedDateKey.value !== date) return
        console.error('Failed to refresh saved student progress:', error)
        realtimeRefreshError.value = true
    }
}

function handleReportRestored(restoredReport: OccurrenceReportDTO) {
    if (selectedEnrollmentId.value) {
        const restored = new OccurrenceReport(restoredReport)
        reportMap.value = new Map(reportMap.value).set(selectedEnrollmentId.value, restored)
        selectedEditorReportSnapshot.value = new OccurrenceReport(restoredReport)
    }
}

function handleSaveError(error: string) {
    console.error('Report editor save failed:', error)
}

function handleConflict(serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO) {
    conflictReportId.value = serverReport.id || null
    conflictServerVersion.value = serverReport.version
    conflictLocalVersion.value = localReport.version
    conflictServerReport.value = serverReport
    conflictLocalReport.value = localReport
    showConflictModal.value = true
}

function closeConflictModal() {
    showConflictModal.value = false
    conflictReportId.value = null
}

async function resolveConflict(resolvedReport: OccurrenceReportDTO) {
    if (!conflictReportId.value) return

    try {
        const report = await ReportCommandService.resolveConflict(
            conflictReportId.value,
            resolvedReport,
            auth.user?.id,
            conflictServerVersion.value
        )

        // Update local state
        // Find which enrollment this belongs to
        for (const [enrId, r] of reportMap.value.entries()) {
            if (r.id === report.id) {
                reportMap.value.set(enrId, report)
                break
            }
        }

        quickReportEditorRef.value?.replaceWithCanonicalReport(report.toDTO())

        showConflictModal.value = false
        conflictReportId.value = null
        toast.success(t('report.save_success'))
    } catch (error) {
        console.error('Failed to resolve conflict:', error)
        reportError(error, 'report.resolve_conflict_error')
    }
}

function openTeacherEditModal() {
    if (!todayOccurrence.value) return
    teacherSearchQuery.value = ''
    const dateStr = DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate)
    selectedTeacherIds.value = new Set(getEffectiveTeacherAssignments(sessionTeachers.value, dateStr)
        .map(assignment => assignment.id)
        .filter((id): id is string => Boolean(id)))
    showTeacherEditModal.value = true
}



async function addTeacherForToday(teacher: TeacherOverviewDTO) {
    if (!todayOccurrence.value || !teacher.id) return

    try {
        isSavingTeachers.value = true
        const dateStr = DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate)

        // Update the source-of-truth assignment only; attendance roster is derived from this plan.
        await TeacherService.assignTeacherForDate(sessionId, teacher.id, dateStr)
        sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)
        await loadOccurrenceTeachers()

        toast.success(t('common.save_success'))
    } catch (e) {
        console.error('Failed to add teacher for today:', e)
        reportError(e, 'common.save_error')
    } finally {
        isSavingTeachers.value = false
    }
}

async function removeAssignment(teacherId: string, effectiveFrom: string) {
    if (!confirm(t('common.confirm_delete'))) return

    try {
        isSavingTeachers.value = true
        await TeacherService.removeTeacherAssignment(sessionId, teacherId, effectiveFrom)
        sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)
        await loadOccurrenceTeachers()

        toast.success(t('common.save_success'))
    } catch (e) {
        console.error('Failed to remove assignment:', e)
        reportError(e, 'common.save_error')
    } finally {
        isSavingTeachers.value = false
    }
}

</script>

<template>
    <div class="space-y-8 animate-in fade-in duration-500">
        <!-- Header -->
        <div class="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-start gap-3 sm:gap-4">
                    <router-link :to="{ name: 'classrooms' }"
                        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white text-gray-400 shadow-sm transition-all hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600 active:scale-90 sm:h-12 sm:w-12"
                        :aria-label="$t('common.back')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M15 19l-7-7 7-7" />
                        </svg>
                    </router-link>

                    <div class="min-w-0 flex-1" v-if="session">
                        <h1 class="break-words text-2xl font-black leading-tight tracking-tight text-gray-900 sm:text-3xl">
                            {{ session.name }}
                        </h1>
                        <div class="mt-3 flex min-w-0 flex-wrap gap-2 text-xs font-bold text-gray-500 sm:text-sm">
                            <RealtimeStatusBadge
                                align="start"
                                :tone="realtimeBadge.tone"
                                :label="realtimeBadge.label"
                                :message="realtimeStatusMessage"
                                :detail="realtimeStatusDetail ? `${$t('classroom.live_update_detail')} ${realtimeStatusDetail}` : null"
                                :note="lastRealtimeUpdateAt ? $t('classroom.live_update_time', { time: lastRealtimeUpdateLabel }) : null"
                                :can-retry="realtimeBadge.canRetry"
                                :retry-label="realtimeRefreshError ? $t('classroom.live_update_retry') : $t('classroom.live_reconnect')"
                                :busy="isRealtimeRefreshing"
                                :status-label="$t('classroom.live_badge_aria')"
                                @retry="retryRealtimeAction" />
                            <span class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                <span class="break-words">{{ session.classroom_name }}</span>
                            </span>
                            <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {{ sessionTimeLabel }}
                            </span>
                            <span class="inline-grid max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                                <span class="whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-gray-400">{{ $t('classroom.session_time_zone') }}</span>
                                <span class="min-w-0 [overflow-wrap:anywhere]">{{ DateUtils.formatTimeZoneLabel(session.time_zone || preferences.timeZone, preferences.locale) }}</span>
                            </span>
                            <a v-if="session.external_link" :href="session.external_link" target="_blank"
                                rel="noopener noreferrer" :title="session.external_link"
                                class="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                                {{ $t('classroom.external_link') }}
                            </a>
                            <a v-if="session.classroom?.external_link" :href="session.classroom.external_link"
                                target="_blank" rel="noopener noreferrer" :title="session.classroom.external_link"
                                class="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-50 px-3 py-2 text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {{ $t('classroom.room_external_link') }}
                            </a>
                        </div>
                    </div>
                </div>
            </div>

            <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:max-w-md xl:w-[22rem] xl:shrink-0">
                <div class="min-w-0">
                    <TimeZoneSelect :label="$t('common.display_time_zone')" dense />
                </div>
                <button @click="requestRefreshSchedule"
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white text-gray-400 shadow-sm transition-all hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600 active:scale-90"
                    :title="$t('classroom.refresh_schedule')" :aria-label="$t('classroom.refresh_schedule')">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
                <button v-if="showSplitView" @click="closeSplitView"
                    class="col-span-full rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-600 transition hover:bg-gray-200">
                    {{ $t('common.close_split_view') }}
                </button>
            </div>
        </div>

        <div v-if="loading"
            class="flex flex-col items-center justify-center py-32 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <svg class="animate-spin h-10 w-10 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none"
                viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            <span class="text-gray-500 font-black italic tracking-widest">{{ $t('student.loading') }}</span>
        </div>

        <div v-else class="session-workspace w-full">
            <div v-if="occurrenceLoadError" class="flex flex-col items-center justify-center rounded-3xl border border-red-100 bg-white px-6 py-20 text-center shadow-sm">
                <p class="font-black text-red-700">{{ occurrenceLoadError }}</p>
                <button type="button" class="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700" @click="loadData">
                    {{ $t('classroom.retry_occurrence_load') }}
                </button>
            </div>
            <div v-else class="session-workspace__grid grid min-w-0 grid-cols-1 gap-6 transition-all duration-500 ease-in-out"
                :class="{ 'session-workspace__grid--editing': showSplitView }">

                <!-- LEFT COLUMN: Student List & Stats -->
                <div class="session-workspace__class-column min-w-0 space-y-6"
                    :class="{ 'session-workspace__class-column--editing': showSplitView }">
                    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h3 class="font-black text-gray-900">{{ $t('classroom.teaching_day_navigation') }}</h3>
                                <p class="text-xs font-bold text-gray-400">{{ displayedOccurrenceDate }}</p>
                            </div>

                            <div class="flex items-center gap-2 flex-wrap md:justify-end">
                                <button @click="moveOccurrence('previous')"
                                    :disabled="!previousOccurrence || isOccurrenceLoading"
                                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                                    {{ $t('classroom.previous_occurrence') }}
                                </button>
                                <button @click="goToToday"
                                    :disabled="isOccurrenceLoading"
                                    class="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                                    {{ $t('classroom.back_to_today') }}
                                </button>
                                <button @click="moveOccurrence('next')"
                                    :disabled="!nextOccurrence || isOccurrenceLoading"
                                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                                    {{ $t('classroom.next_occurrence') }}
                                </button>

                                <button @click="toggleCalendarPanel"
                                    class="px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all text-xs font-black uppercase tracking-widest flex items-center gap-2">
                                    <span>{{ isCalendarExpanded ? $t('classroom.hide_calendar') :
                                        $t('classroom.show_calendar') }}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                                        :class="isCalendarExpanded ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24"
                                        stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ occurrenceNavigationLabel }}
                        </p>

                        <Transition name="fade-slide">
                            <div v-show="isCalendarExpanded" class="max-w-4xl mx-auto w-full">
                                <OccurrenceCalendar :occurrences="sessionOccurrences" :compact="true"
                                    mark-class-days
                                    :is-planned-date="isPlannedClassDate"
                                    :report-completion="reportCompletionByDate"
                                    :join-flags="joinFlagsByDate"
                                    :today="calendarToday"
                                    :model-value="selectedDateKey || null"
                                    @select-date="handleCalendarDateSelect"
                                    @range-change="handleCalendarRangeChange" />
                            </div>
                        </Transition>
                    </div>

                    <!-- Class Status Toggle (New) -->
                    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex items-center justify-between"
                        v-if="todayOccurrence">
                        <div>
                            <h3 class="font-black text-gray-900">{{ $t('classroom.class_held_title') }}
                            </h3>
                            <p class="text-xs font-bold text-gray-400">
                                {{ $t('classroom.class_held_subtitle') }}
                            </p>
                        </div>

                        <div class="flex items-center gap-4">
                            <button @click="copyAttendanceInfo"
                                class="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                :title="$t('classroom.copy_attendance')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                            </button>

                            <button @click="openAttendanceTemplateModal"
                                class="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                :title="$t('classroom.copy_template_settings')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M11.983 5.5l1.165-2.09a1 1 0 011.733 0l1.165 2.09 2.34.414a1 1 0 01.557 1.69l-1.6 1.641.294 2.303a1 1 0 01-1.414 1.04L14 11.61l-2.223.978a1 1 0 01-1.414-1.04l.294-2.303-1.6-1.64a1 1 0 01.557-1.691l2.369-.414zM5 15h14M7 19h10" />
                                </svg>
                            </button>

                            <label class="relative inline-flex items-center cursor-pointer"
                                :title="isOccurrenceInHoliday ? $t('report.error.cannot_set_conducted_during_holiday') : $t('classroom.class_held')"
                                :class="{ 'opacity-50 cursor-not-allowed': isOccurrenceInHoliday }">
                                <span class="sr-only">{{ $t('classroom.class_held') }}</span>
                                <input type="checkbox" :checked="todayOccurrence && todayOccurrence.isConducted"
                                    :disabled="isOccurrenceInHoliday" @change="toggleIsConducted($event)"
                                    :aria-label="$t('classroom.class_held')" class="sr-only peer">
                                <div :class="isOccurrenceInHoliday ? 'bg-red-100' : 'bg-gray-200'"
                                    class="w-14 h-7 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Teacher Attendance Section -->
                    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4"
                        v-if="todayOccurrence">
                        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div class="min-w-0">
                                <h3 class="font-black text-gray-900">{{ $t('classroom.teacher_attendance_title') }}</h3>
                                <p class="text-xs font-bold text-gray-400">
                                    {{ $t('classroom.teacher_attendance_subtitle') }}
                                    <span v-if="canManageTeacherAttendance"> · {{ $t('classroom.teacher_attendance_manager_edit') }}</span>
                                </p>
                                <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                                    <span class="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{{ $t('classroom.teacher_attendance_present_count', { count: teacherAttendanceCounts.present }) }}</span>
                                    <span class="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{{ $t('classroom.teacher_attendance_absent_count', { count: teacherAttendanceCounts.absent }) }}</span>
                                    <span v-if="teacherAttendanceCounts.onLeave" class="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{{ $t('classroom.teacher_attendance_leave_count', { count: teacherAttendanceCounts.onLeave }) }}</span>
                                </div>
                            </div>

                            <button @click="openTeacherEditModal"
                                class="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-all text-xs font-black uppercase tracking-widest">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M12 4v16m8-8H4" />
                                </svg>
                                {{ $t('common.edit') }}
                            </button>
                        </div>

                        <div v-if="occurrenceTeachers.length > 0" class="mt-2 divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-gray-50/70">
                            <div v-for="teacher in occurrenceTeachers" :key="teacher.id"
                                class="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors"
                                :class="isTeacherOnLeave(teacher.id) ? 'bg-amber-50/70' : (isTeacherPresent(teacher.id, teacher.user_id) ? 'bg-emerald-50/50' : '')">
                                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold"
                                    :class="isTeacherOnLeave(teacher.id) ? 'bg-amber-100 text-amber-700' : (isTeacherPresent(teacher.id, teacher.user_id) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500')">
                                    {{ teacher.name.charAt(0) }}
                                </div>
                                <div class="min-w-0 flex-1 pr-2">
                                    <div class="truncate font-bold text-gray-900">{{ teacher.name }}</div>
                                    <div v-if="teacher.role" class="mt-0.5 text-[10px] font-black tracking-wide text-gray-500">
                                        {{ roleDisplayName(teacher.role, t) }}
                                    </div>
                                </div>
                                <span class="shrink-0 rounded-full px-3 py-1 text-[10px] font-black"
                                    :class="isTeacherOnLeave(teacher.id) ? 'bg-amber-100 text-amber-800' : (isTeacherPresent(teacher.id, teacher.user_id) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600')">
                                    {{ isTeacherOnLeave(teacher.id) ? $t('classroom.teacher_on_leave') : (isTeacherPresent(teacher.id, teacher.user_id) ? $t('attendance.present') : $t('attendance.absent')) }}
                                </span>
                                <label class="relative inline-flex shrink-0 items-center cursor-pointer"
                                    :class="{ 'opacity-50 cursor-not-allowed': !canEditTeacherAttendance(teacher) || isOccurrenceInHoliday || isTeacherOnLeave(teacher.id) }"
                                    :title="isTeacherOnLeave(teacher.id) ? $t('classroom.teacher_attendance_on_leave') : (isOccurrenceInHoliday ? $t('report.error.cannot_set_teacher_present_during_holiday') : (!canEditTeacherAttendance(teacher) ? $t('classroom.teacher_attendance_only_self') : ''))">
                                    <span class="sr-only">{{ teacher.name }} - {{ $t('attendance.present') }}</span>
                                    <input type="checkbox" :checked="isTeacherPresent(teacher.id, teacher.user_id)"
                                        :disabled="!canEditTeacherAttendance(teacher) || isOccurrenceInHoliday || isTeacherOnLeave(teacher.id)"
                                        @change="toggleTeacherAttendance(teacher.id, $event)"
                                        :aria-label="`${teacher.name} - ${$t('attendance.present')}`" class="sr-only peer">
                                    <div :class="isOccurrenceInHoliday ? 'bg-red-100' : 'bg-gray-200'"
                                        class="relative h-6 w-11 rounded-full transition-colors after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none">
                                    </div>
                                </label>
                            </div>
                        </div>
                        <div v-else
                            class="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                            <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">{{
                                $t('classroom.no_teachers_assigned') }}</p>
                        </div>
                    </div>

                    <div class="flex flex-col gap-3 rounded-[2rem] border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
                        <label class="relative min-w-0 flex-1" for="edulog-sessiondetailsview-291-24450">
                            <span class="sr-only">{{ $t('classroom.student_search') }}</span>
                            <svg class="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                            </svg>
                            <input v-model="studentSearchQuery" type="search" :placeholder="$t('classroom.student_search_placeholder')"
                                class="w-full rounded-2xl border border-gray-100 bg-gray-50 py-3 pl-12 pr-10 font-bold text-gray-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" :aria-label="$t('classroom.student_search_placeholder')">
                            <button v-if="studentSearchQuery" type="button" @click="studentSearchQuery = ''"
                                class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" :aria-label="$t('common.clear')">×</button>
                        </label>
                        <select v-model="studentAttendanceFilter" class="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 font-black text-gray-700 outline-none focus:border-emerald-500" id="edulog-sessiondetailsview-291-24450">
                            <option value="all">{{ $t('classroom.student_filter_all') }}</option>
                            <option value="present">{{ $t('attendance.present') }}</option>
                            <option value="absent">{{ $t('attendance.absent') }}</option>
                            <option value="pending">{{ $t('attendance.pending') }}</option>
                        </select>
                        <span class="shrink-0 px-2 text-center text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.student_filter_count', { count: filteredEnrollments.length }) }}</span>
                    </div>

                    <div v-if="todayOccurrence && isLoadingProgressGaps" class="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600" role="status" aria-live="polite" aria-busy="true">
                        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600 motion-reduce:animate-none" aria-hidden="true"></span>
                        {{ $t('classroom.progress_gap_checking') }}
                    </div>
                    <div v-if="todayOccurrence && progressGapCheckFailed" class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950" role="alert" aria-busy="false">
                        <span>{{ $t('classroom.progress_gap_check_failed') }}</span>
                        <button type="button" class="min-h-11 rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-black text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700" @click="retryStudentProgressGaps">
                            {{ $t('classroom.progress_gap_retry') }}
                        </button>
                    </div>
                    <QuickAttendancePanel v-if="todayOccurrence"
                        v-model:expanded="isQuickAttendanceExpanded"
                        :students="quickAttendanceStudents"
                        :selected-ids="[...selectedEnrollmentIds]"
                        :counts="attendanceCounts"
                        :disabled="isOccurrenceInHoliday || isOccurrenceLoading"
                        :empty-message="allRosterEnrollments.length === 0 ? $t('classroom.no_students_enrolled') : $t('classroom.no_matching_students')"
                        :show-clear-filters="allRosterEnrollments.length > 0 && hasActiveStudentFilters"
                        @set-attendance="setAttendance"
                        @batch-set-attendance="batchSetAttendance"
                        @toggle-selection="toggleEnrollmentSelection"
                        @toggle-select-all="toggleSelectAll"
                        @add-student="openAddStudentModal"
                        @focus-student="focusRosterStudent"
                        @clear-filters="clearStudentFilters" />

                    <!-- Stats Bar (Conditional or Compact in Split View?) -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6" v-if="!showSplitView && todayOccurrence">
                        <div
                            class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                            <div>
                                <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{
                                    $t('classroom.total_students') }}</h4>
                                <p class="text-5xl font-black tracking-tighter">{{ allRosterEnrollments.length }}</p>
                            </div>
                            <div class="bg-white/20 p-4 rounded-3xl">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                            </div>
                        </div>
                        <div v-if="session"
                            class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm col-span-2 flex items-center gap-12">
                            <div>
                                <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{{
                                    $t('classroom.capacity_utilization') }}</h4>
                                <div class="flex items-end gap-3">
                                    <p class="text-4xl font-black text-gray-900 tracking-tighter">{{
                                        Math.round((occupiedRosterCount / (session?.capacity || 1)) * 100) }}%</p>
                                    <p class="text-xs font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{
                                        $t('classroom.capacity') }}</p>
                                </div>
                            </div>
                            <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                    :style="{ width: `${Math.min((occupiedRosterCount / (session?.capacity || 1)) * 100, 100)}%` }">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Responsive Card List -->
                    <StudentRosterPanel
                        :items="studentRosterItems"
                        :result-count="filteredEnrollments.length"
                        :has-occurrence="Boolean(todayOccurrence)"
                        :attendance-disabled="isOccurrenceInHoliday || isOccurrenceLoading"
                        :highlighted-enrollment-id="highlightedEnrollmentId"
                        :empty-message="allRosterEnrollments.length === 0 ? $t('classroom.no_students_enrolled') : $t('classroom.no_matching_students')"
                        :show-clear-filters="allRosterEnrollments.length > 0 && hasActiveStudentFilters"
                        @set-attendance="setAttendance"
                        @quick-edit="toggleSplitView"
                        @koding-check="openStudentKodingCheck"
                        @clear-filters="clearStudentFilters" />
                    <TransferredOutStudents
                        :transfers="transferredOutStudents"
                        :cancelling-transfer-id="cancellingTransferId"
                        @open="openTransferTarget"
                        @cancel="pendingTransferCancel = $event" />
                </div>

                <!-- RIGHT COLUMN: Report Editor -->
                <div v-if="showSplitView && selectedEnrollmentId"
                    class="animate-in slide-in-from-right-4 duration-500 min-w-0 w-full">
                    <div class="session-report-editor sticky top-20 min-h-0 bg-white rounded-[2.5rem] border border-emerald-100 shadow-xl shadow-emerald-50/50 flex flex-col overflow-hidden">
                        <!-- Header: Fixed at top of sticky box -->
                        <div
                            class="flex items-center justify-between p-6 pb-4 shrink-0 bg-white z-20 border-b border-gray-50 shadow-sm shadow-gray-50/20">
                            <div class="flex items-center gap-4 min-w-0">
                                <!-- Avatar and Name -->
                                <div
                                    class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-lg shadow-emerald-100">
                                    {{selectedEditorEnrollment?.studentName?.charAt(0)}}
                                </div>
                                <div class="min-w-0">
                                    <div class="font-black text-gray-900 text-xl leading-tight truncate">
                                        {{selectedEditorEnrollment?.studentName}}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1">
                                        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                        <div class="text-[11px] font-black uppercase tracking-widest text-emerald-600">
                                            {{ displayedOccurrenceDate }}
                                            <span v-if="todayOccurrence?.effectiveStartTime"
                                                class="ml-1 text-emerald-600">
                                                {{ todayOccurrence.effectiveStartTime.slice(0, 5) }}-{{
                                                    todayOccurrence.effectiveEndTime?.slice(0, 5) }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button @click="closeSplitView"
                                class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center group active:scale-90">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <!-- Scrollable Body -->
                        <div class="min-h-0 flex-1 overflow-y-auto p-6 pt-4 custom-scrollbar bg-gray-50/30">
                            <ReportEditor ref="quickReportEditorRef" v-if="selectedEditorReport"
                                :key="selectedEnrollmentId" :report-id="selectedEditorReport?.id"
                                :initial-version="selectedEditorReport?.version"
                                :loading="savingMap.get(selectedEnrollmentId!)" :show-manual-save="true"
                                :enrollment-id="selectedEditorEnrollment?.id" :class-occurrence-id="todayOccurrence?.id"
                                :title="todayOccurrence ? `${new Date(todayOccurrence.occurrenceDate).toLocaleDateString(preferences.locale)} ${todayOccurrence.effectiveStartTime?.slice(0, 5) || ''}` : undefined"
                                :course-name="selectedEditorEnrollment?.courseSubject + ' ' + selectedEditorEnrollment?.courseStage"
                                :course-display-name="selectedEditorEnrollment?.courseDisplayName"
                                :initial-classroom-name="session?.classroom_name" :initial-session-name="session?.name"
                                :initial-session-time="session ? `${session.start_time?.slice(0, 5) || ''}-${session.end_time?.slice(0, 5) || ''}` : ''"
                                :initial-student-name="selectedEditorEnrollment?.studentName"
                                :initial-student-id="selectedEditorEnrollment?.studentId"
                                :initial-lesson-id="selectedEditorReport?.lessonId"
                                :available-lessons="courseLessons"
                                :initial-report-external-link="selectedEditorReport?.externalLink"
                                :source-identity="selectedEditorReport"
                                :initial-is-completed="selectedEditorReport?.isCompleted"
                                :initial-progress-start="selectedEditorReport?.progressStart"
                                :initial-progress-end="selectedEditorReport?.progressEnd"
                                :initial-attendance-status="selectedEditorReport?.attendanceStatus"
                                :initial-absence-reason="selectedEditorReport?.absenceReason"
                                :initial-class-participation="parseFloat(String(selectedEditorReport?.classParticipation ?? 0))"
                                :initial-classroom-behavior="parseFloat(String(selectedEditorReport?.classroomBehavior ?? 0))"
                                :initial-contact-notes="selectedEditorReport?.contactNotes"
                                :initial-contact-notes-document="selectedEditorReport?.contactNotesDocument"
                                :initial-class-notes="selectedEditorReport?.classNotes"
                                :initial-class-notes-document="selectedEditorReport?.classNotesDocument"
                                :initial-content="selectedEditorReport?.content"
                                :initial-content-document="selectedEditorReport?.contentDocument"
                                :initial-enrollment-external-link="selectedEditorEnrollment?.externalLink"
                                @update:content="handleEditorUpdate($event, selectedEnrollmentId!)"
                                @update:report-external-link="handleReportExternalLinkUpdate($event, selectedEnrollmentId!)"
                                @save-success="handleSaveSuccess($event, selectedEnrollmentId!)"
                                @save-error="handleSaveError" @conflict="handleConflict"
                                @restored="handleReportRestored" class="h-full border-none shadow-none rounded-none" />

                            <div v-else class="flex flex-col items-center justify-center py-20 text-gray-400">
                                <p class="font-bold">{{ $t('report.no_report_today') }}</p>
                                <p class="text-xs mt-1">{{ $t('report.is_student_active_hint') }}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Conflict Resolution Modal -->
        <ConflictModal v-if="showConflictModal" :is-open="showConflictModal" :serverVersion="conflictServerVersion"
            :localVersion="conflictLocalVersion" :server-report="conflictServerReport!"
            :local-report="conflictLocalReport!" :available-lessons="courseLessons" @close="closeConflictModal"
            @resolve="resolveConflict" />

        <ConfirmModal :is-open="pendingTransferCancel !== null"
            :title="$t('student.transfer_history.cancel_confirm_title')"
            :message="pendingTransferCancel ? $t('classroom.lesson_transfer.cancel_confirm_message', {
                student: pendingTransferCancel.student_name,
                target: [DateUtils.displayDateWithWeekday(pendingTransferCancel.other_occurrence_date, preferences.locale), pendingTransferCancel.other_session_name].filter(Boolean).join(' ')
            }) : ''"
            :confirm-text="$t('student.transfer_history.cancel_transfer')"
            :cancel-text="$t('student.transfer_history.keep_transfer')"
            :is-dangerous="true"
            :is-loading="cancellingTransferId !== null"
            @confirm="confirmTransferCancel"
            @close="pendingTransferCancel = null" />
        <ConfirmModal v-if="showRefreshConfirm" :is-open="showRefreshConfirm" :title="$t('classroom.refresh_schedule')"
            :message="$t('classroom.refresh_confirm')" :confirm-text="$t('common.refresh')" confirm-type="warning"
            :is-loading="isRefreshing" @confirm="handleConfirmRefresh" @close="showRefreshConfirm = false" />

        <KodingCodeCheckModal :is-open="showKodingCheckModal" :target="kodingTargetEnrollment"
            :initial-lesson-id="kodingInitialLessonId" @close="showKodingCheckModal = false" />

        <div v-if="showAddStudentModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
                role="dialog" aria-modal="true" aria-labelledby="makeup-add-student-title"
                class="bg-white rounded-2xl flex flex-col w-full max-w-2xl max-h-[85vh] shadow-2xl m-4 overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h3 id="makeup-add-student-title" class="text-xl font-bold text-gray-900">{{ $t('classroom.add_student_modal_title') }}</h3>
                    <button @click="closeAddStudentModal" :aria-label="$t('common.close')" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 space-y-5">
                    <p class="text-sm text-gray-500">{{ $t('classroom.add_student_modal_hint') }}</p>

                    <div v-if="makeupSubmitError" ref="makeupSubmitErrorElement" role="alert" tabindex="-1"
                        class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium leading-6 text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                        {{ makeupSubmitError }}
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-531-43853">{{ $t('classroom.add_student_search')
                        }}</label>
                        <input v-model="makeupSearch" type="text"
                            :placeholder="$t('classroom.add_student_search_placeholder')"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"  id="edulog-sessiondetailsview-531-43853"/>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-539-44367">{{ $t('classroom.add_student_student')
                        }}</label>
                        <BaseDropdown v-model="selectedMakeupStudentId" :options="makeupStudentOptions"
                            :placeholder="$t('classroom.add_student_select_student_placeholder')" theme="emerald"
                            @change="handleMakeupStudentChange" :disabled="isAddingStudent"  id="edulog-sessiondetailsview-539-44367"/>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-547-44890">{{ $t('classroom.add_student_course')
                        }}</label>
                        <BaseDropdown v-model="selectedMakeupEnrollmentId" :options="makeupEnrollmentOptions"
                            :placeholder="$t('classroom.add_student_select_course_placeholder')" theme="emerald"
                            :disabled="isAddingStudent || !selectedMakeupStudentId"  id="edulog-sessiondetailsview-547-44890"/>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-555-45409">{{
                            $t('classroom.add_student_join_date') }}</label>
                        <input type="date" v-model="makeupJoinDate"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"  id="edulog-sessiondetailsview-555-45409"/>
                    </div>

                    <div v-if="selectedMakeupEnrollment" class="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                        <p class="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">{{
                            $t('classroom.add_student_selected_summary') }}</p>
                        <p class="text-sm text-emerald-900 font-semibold">{{ selectedMakeupEnrollment.studentName }}</p>
                        <p class="text-xs text-emerald-800 mt-1">{{ selectedMakeupEnrollment.courseDisplayName ||
                            `${selectedMakeupEnrollment.courseSubject} ${selectedMakeupEnrollment.courseStage}` }}</p>
                        <p class="text-xs text-emerald-700 mt-1">{{ selectedMakeupEnrollment.classSessionName ||
                            $t('classroom.session') }}</p>
                    </div>
                </div>

                <div class="px-6 py-5 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
                    <button @click="closeAddStudentModal"
                        class="px-5 py-2.5 text-gray-600 hover:bg-gray-200/60 font-bold rounded-xl transition-all">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="submitAddStudentToClass"
                        :disabled="isAddingStudent || !selectedMakeupEnrollmentId || !makeupJoinDate"
                        class="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                        <svg v-if="isAddingStudent" class="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        {{ $t('classroom.add_student_submit') }}
                    </button>
                </div>
            </div>
        </div>

        <CopyTemplateEditorModal ref="attendanceTemplateModal" v-model="showAttendanceTemplateModal" :title="$t('classroom.copy_template_title')"
            :hint="$t('classroom.copy_template_hint')" :variable-title="$t('classroom.copy_template_variables')"
            :content-title="$t('classroom.copy_template_content')"
            :preview-title="$t('classroom.copy_template_preview_title')"
            :preview-hint="$t('classroom.copy_template_preview_hint')"
            :preview-empty="$t('classroom.copy_template_preview_empty')" :template-text="attendanceTemplateText"
            :template-document="attendanceTemplateDocument"
            :preview-text="attendanceTemplatePreviewText" :variable-count="attendanceTemplateVariables.length"
            :is-loading="isLoadingAttendanceTemplate" :loading-text="$t('classroom.copy_template_loading')"
            :loading-hint="$t('classroom.copy_template_loading_hint')" :save-loading="isSavingAttendanceTemplate"
            :cancel-text="$t('common.cancel')" :save-text="$t('common.save')" :saving-text="$t('common.saving')"
            @update:template-text="attendanceTemplateText = $event"
            @update:template-document="attendanceTemplateDocument = $event" @save="saveAttendanceTemplate">
            <template #controls>
                <div class="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <div class="space-y-2">
                        <p class="text-sm font-bold text-amber-900">{{ $t('classroom.copy_template_scope') }}</p>
                        <label class="flex items-center gap-2 text-sm text-amber-900/90">
                            <input v-model="attendanceTemplateScope" type="radio" value="class_session"
                                class="border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                            {{ $t('classroom.copy_template_scope_session') }}
                        </label>
                        <label class="flex items-center gap-2 text-sm text-amber-900/90">
                            <input v-model="attendanceTemplateScope" type="radio" value="user_default"
                                class="border-gray-300 text-emerald-600 focus:ring-emerald-500" />
                            {{ $t('classroom.copy_template_scope_user') }}
                        </label>
                    </div>

                    <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
                        <div>
                            <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1" for="edulog-sessiondetailsview-623-50547">
                                {{ $t('classroom.copy_template_load_from') }}
                            </label>
                            <BaseDropdown v-model="selectedAttendanceTemplateLoadKey"
                                :options="attendanceTemplateLoadOptionsDropdown"
                                :placeholder="$t('classroom.copy_template_load_from')" theme="amber"  id="edulog-sessiondetailsview-623-50547"/>
                        </div>
                        <button @click="loadSelectedAttendanceTemplate"
                            class="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600"
                            :disabled="!selectedAttendanceTemplateLoadKey">
                            {{ $t('classroom.copy_template_load_action') }}
                        </button>
                    </div>
                </div>
            </template>

            <template #variables>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div v-for="variable in attendanceTemplateVariables" :key="variable.key"
                        class="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="text-sm font-bold text-gray-900 leading-tight">{{ variable.label }}</p>
                                <p class="mt-1 text-xs leading-5 text-gray-500">{{ variable.description }}</p>
                            </div>
                            <button @click="insertAttendanceTemplateVariable(variable.key)"
                                class="shrink-0 whitespace-nowrap rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                                :title="variable.token">
                                {{ variable.token }}
                            </button>
                        </div>

                        <div v-if="variable.modeOptions?.length" class="space-y-1">
                            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" for="edulog-sessiondetailsview-656-52738">
                                {{ $t('classroom.copy_template_variable_mode_label') }}
                            </label>
                            <BaseDropdown v-model="selectedAttendanceTemplateModes[variable.key]"
                                :options="variable.modeOptions" theme="gray"  id="edulog-sessiondetailsview-656-52738"/>
                        </div>

                        <div>
                            <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                {{ $t('classroom.copy_template_preview_title') }}
                            </p>
                            <p
                                class="min-h-[3.25rem] whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                                {{ variable.previewValue || '—' }}
                            </p>
                        </div>
                    </div>
                </div>
            </template>
        </CopyTemplateEditorModal>

        <!-- Teacher Selection Modal -->
        <Transition name="fade">
            <div v-if="showTeacherEditModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" @click="showTeacherEditModal = false">
                </div>

                <div
                    class="relative bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                    <!-- Header -->
                    <div class="p-8 border-b border-gray-50 flex items-center justify-between shrink-0">
                        <div>
                            <h2 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('classroom.manage_teachers') }}</h2>
                            <p class="text-sm font-bold text-gray-400 mt-1">{{ displayedOccurrenceDate }}</p>
                        </div>
                        <button @click="showTeacherEditModal = false"
                            class="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-gray-900 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <!-- Current Schedule Section -->
                    <div class="px-6 py-4 border-b border-gray-50 bg-emerald-50/30">
                        <h4
                            class="text-xs font-black text-emerald-800 uppercase tracking-widest mb-3 flex items-center justify-between">
                            {{ $t('classroom.teaching_schedule') }}
                            <router-link :to="{ name: 'classrooms', query: { edit: sessionId } }"
                                class="text-[10px] font-bold text-emerald-600 hover:underline">
                                {{ $t('classroom.master_schedule_link') }}
                            </router-link>
                        </h4>
                        <div class="space-y-2">
                            <div v-for="st in currentSessionTeachers" :key="st.id + st.effective_from"
                                class="flex items-center justify-between p-3 rounded-xl bg-white border border-emerald-100 shadow-sm">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs">
                                        {{ st.name.charAt(0) }}
                                    </div>
                                    <div>
                                        <div class="text-sm font-black text-gray-900">{{ st.name }}</div>
                                        <div v-if="st.role?.name" class="mt-0.5 text-[10px] font-black tracking-wide text-emerald-600">{{ roleDisplayName(st.role, t) }}</div>
                                        <div class="text-[10px] font-bold text-gray-400">
                                            {{ st.effective_to ? `${st.effective_from} ~ ${st.effective_to}` :
                                                `${st.effective_from} ~ ${$t('classroom.default_teacher')}` }}
                                        </div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    <router-link to="/dashboard/teachers"
                                        :aria-label="$t('classroom.manage_teachers')"
                                        class="relative p-2 text-gray-300 hover:text-emerald-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                        </svg>
                                    </router-link>
                                    <button @click="st.id && removeAssignment(st.id, st.effective_from)"
                                        class="p-2 text-gray-300 hover:text-rose-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div v-if="currentSessionTeachers.length === 0" class="text-center py-4 text-xs font-bold text-gray-400 italic">
                                {{ $t('classroom.no_teachers_assigned') }}
                            </div>
                        </div>
                    </div>

                    <!-- Search Bar -->
                    <div class="p-6 bg-gray-50/50 border-b border-gray-50">
                        <h4 class="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                            {{ $t('classroom.one_day_assignment') }}
                        </h4>
                        <div
                            class="flex items-center gap-4 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                            <div class="pl-3 text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>
                            <input v-model="teacherSearchQuery" type="text" :placeholder="$t('common.search_teacher')"
                                class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2"  :aria-label="$t('common.search_teacher')"/>
                        </div>
                    </div>

                    <!-- Teacher List -->
                    <div class="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar min-h-[300px]">
                        <div v-for="teacher in filteredTeachers" :key="teacher.id" @click="addTeacherForToday(teacher)"
                            class="flex items-center justify-between p-4 rounded-2xl border bg-white border-gray-100 hover:border-emerald-100 hover:bg-emerald-50/10 transition-all cursor-pointer group">

                            <div class="flex items-center gap-4">
                                <div
                                    class="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center font-black text-lg transition-transform group-hover:scale-110 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                                    {{ teacher.name.charAt(0) }}
                                </div>
                                <div>
                                    <div class="font-black text-gray-900">{{ teacher.name }}</div>
                                    <div class="text-xs font-bold text-gray-400">{{ teacher.email || teacher.phone ||
                                        'No contact info' }}</div>
                                </div>
                            </div>

                            <div
                                class="w-8 h-8 rounded-full border-2 border-gray-200 text-transparent flex items-center justify-center transition-all group-hover:border-emerald-500 group-hover:bg-emerald-500 group-hover:text-white">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path fill-rule="evenodd"
                                        d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                                        clip-rule="evenodd" />
                                </svg>
                            </div>
                        </div>

                        <div v-if="filteredTeachers.length === 0" class="text-center py-12 text-gray-400">
                            <p class="font-bold italic">{{ $t('common.no_results') }}</p>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="p-8 border-t border-gray-50 flex items-center gap-4 shrink-0">
                        <button @click="showTeacherEditModal = false"
                            class="flex-1 px-6 py-4 rounded-2xl bg-gray-50 text-gray-500 font-black uppercase tracking-widest text-sm hover:bg-gray-100 transition-all active:scale-95">
                            {{ $t('common.close') }}
                        </button>
                    </div>
                </div>
            </div>
        </Transition>

    </div>
</template>

<style scoped>
.session-workspace {
    container-name: session-workspace;
    container-type: inline-size;
}

.session-workspace__class-column--editing {
    display: none;
}

@container session-workspace (min-width: 1100px) {
    .session-workspace__grid--editing {
        grid-template-columns: minmax(520px, 1fr) minmax(480px, 560px);
    }

    .session-workspace__class-column--editing {
        display: block;
    }
}

.session-report-editor {
    max-height: calc(100vh - 6rem);
    max-height: calc(100dvh - 6rem);
}

.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}

/* For Firefox */
.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #e2e8f0 transparent;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.3s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(-10px);
}
</style>
