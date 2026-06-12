<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { SessionService } from '@/services/session/SessionService'
import { CourseService } from '@/services/course/CourseService'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { OccurrenceService } from '@/services/occurrence/OccurrenceService'
import { useAuthStore } from '@/stores/useAuthStore'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { CopyTemplateService } from '@/services/copy_template/CopyTemplateService'
import { HolidayService } from '@/services/holiday/HolidayService'
import type { Enrollment } from '@/models/Enrollment'
import type { Lesson } from '@/models/Course'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '@/models/OccurrenceReport'
import { DateUtils } from '@/utils/DateUtils'
import { TeacherService } from '@/services/teacher/TeacherService'
import type { TeacherDTO } from '@/services/teacher/TeacherService'
import { StudentService } from '@/services/student/StudentService'
import {
    ATTENDANCE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_ATTENDANCE_TEMPLATE,
    formatCopyTemplateToken,
    renderCopyTemplate
} from '@/utils/copyTemplate'
import { copyToClipboard } from '@/utils/clipboard'
import { buildKodingCodeCheckUrl, getKodingCredentials, type KodingCredential } from '@/utils/koding'

import ReportEditor from '@/components/ReportEditor.vue'
import OccurrenceCalendar from '@/components/OccurrenceCalendar.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import CopyTemplateEditorModal from '@/components/common/CopyTemplateEditorModal.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

type ReportEditorExpose = {
    saveNow: (options?: { reason?: 'manual' | 'switch' }) => Promise<void>
}

const { t } = useI18n()
const toast = useToast()
const preferences = usePreferencesStore()

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const sessionOccurrences = ref<ClassOccurrence[]>([])
const sessionTeachers = ref<(TeacherDTO & { effective_from: string; effective_to: string | null })[]>([])
const weekAnchorDate = ref(DateUtils.todayDate(preferences.timeZone))
const isCalendarExpanded = ref(false)
const isOccurrenceInHoliday = ref(false)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving
const selectedEnrollmentIds = ref<Set<string>>(new Set())
const isQuickAttendanceExpanded = ref(false)
const showAttendanceTemplateModal = ref(false)
const attendanceTemplateText = ref(SYSTEM_ATTENDANCE_TEMPLATE)
const attendanceTemplateScope = ref<'class_session' | 'user_default'>('class_session')
const isLoadingAttendanceTemplate = ref(false)
const isSavingAttendanceTemplate = ref(false)
const attendanceTemplateLoadOptions = ref<Array<{ key: string; label: string; templateText: string }>>([])
const selectedAttendanceTemplateLoadKey = ref('')
const selectedAttendanceTemplateModes = ref<Record<string, string>>({
    present_list: 'comma',
    absent_list: 'comma',
    pending_list: 'comma'
})
const showAddStudentModal = ref(false)
const isAddingStudent = ref(false)
const makeupCandidates = ref<Enrollment[]>([])
const makeupSearch = ref('')
const selectedMakeupStudentId = ref<string | null>(null)
const selectedMakeupEnrollmentId = ref<string | null>(null)
const makeupJoinDate = ref(DateUtils.todayString(preferences.timeZone))

// Koding.school Code Check State
const showKodingCheckModal = ref(false)
const isLoadingKodingCandidates = ref(false)
const kodingTargetEnrollment = ref<Enrollment | null>(null)
const kodingCandidates = ref<KodingComparisonCandidate[]>([])
const kodingLessonOptions = ref<Array<{ label: string; value: string }>>([])
const kodingForm = ref({
    lesson: '',
    candidateKey: '',
    credentialId: ''
})

// Teacher Management State
const occurrenceTeachers = ref<TeacherDTO[]>([])
const allTeachersList = ref<TeacherDTO[]>([])
const showTeacherEditModal = ref(false)
const teacherSearchQuery = ref('')
const selectedTeacherIds = ref<Set<string>>(new Set())
const isSavingTeachers = ref(false)

// Split View State
const showSplitView = ref(false)
const selectedEnrollmentId = ref<string | null>(null)
const isRefreshing = ref(false)
const quickReportEditorRef = ref<ReportEditorExpose | null>(null)

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
const courseLessons = ref<any[]>([])
const courseLessonsByCourseId = ref<Record<string, Lesson[]>>({})
const studentProgressSummaries = ref<Record<string, StudentProgressSummary>>({})
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

interface KodingComparisonCandidate {
    key: string
    type: 'student' | 'teacher'
    label: string
    credentials: KodingCredential[]
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

function getLessonsForCourse(courseId: string): Promise<Lesson[]> {
    const cachedLessons = courseLessonsByCourseId.value[courseId]
    if (cachedLessons) {
        return Promise.resolve(cachedLessons)
    }

    return CourseCatalogService.getLessonsByCourse(courseId).then(lessons => {
        courseLessonsByCourseId.value = {
            ...courseLessonsByCourseId.value,
            [courseId]: lessons
        }
        return lessons
    })
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

function getProgressToneClasses(tone: ProgressTone): string {
    switch (tone) {
        case 'completed':
            return 'bg-emerald-50 text-emerald-700 border-emerald-200'
        case 'incomplete':
            return 'bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-100'
        default:
            return 'bg-slate-50 text-slate-500 border-slate-200'
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
    referenceDate: Date = todayOccurrence.value?.occurrenceDate || new Date()
) {
    const uniqueCourseIds = [...new Set(enrollmentList.map(enrollment => enrollment.courseId).filter(Boolean))]
    await Promise.all(uniqueCourseIds.map(courseId => getLessonsForCourse(courseId)))

    const summaryEntries = await Promise.all(enrollmentList.map(async enrollment => {
        if (!enrollment.id) {
            return [enrollment.id, getDefaultProgressSummary()] as const
        }

        const lessons = await getLessonsForCourse(enrollment.courseId)
        const reports = await OccurrenceReportService.getAllReportsByEnrollment(enrollment.id)
        return [enrollment.id, buildStudentProgressSummary(enrollment, reports, lessons, referenceDate)] as const
    }))

    const nextSummaries = Object.fromEntries(summaryEntries.filter(([id]) => !!id)) as Record<string, StudentProgressSummary>

    if (mode === 'merge') {
        studentProgressSummaries.value = {
            ...studentProgressSummaries.value,
            ...nextSummaries
        }
        return
    }

    studentProgressSummaries.value = nextSummaries
}

function getStudentProgressSummary(enrollmentId?: string): StudentProgressSummary {
    if (!enrollmentId) {
        return getDefaultProgressSummary()
    }

    return studentProgressSummaries.value[enrollmentId] || getDefaultProgressSummary()
}

const displayedOccurrenceDate = computed(() => {
    if (!todayOccurrence.value?.occurrenceDate) {
        return t('classroom.no_teaching_day_selected')
    }

    return DateUtils.displayDate(todayOccurrence.value.occurrenceDate, preferences.locale, preferences.timeZone)
})

const weekRangeLabel = computed(() => {
    const start = new Date(weekAnchorDate.value)
    start.setDate(start.getDate() - 3)

    const end = new Date(weekAnchorDate.value)
    end.setDate(end.getDate() + 3)

    return `${DateUtils.displayDate(start, preferences.locale, preferences.timeZone)} - ${DateUtils.displayDate(end, preferences.locale, preferences.timeZone)}`
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

    return allTeachersList.value.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.email.toLowerCase().includes(query)
    )
})

const kodingCandidateOptions = computed(() => [
    { label: t('classroom.koding_select_comparison'), value: '' },
    ...kodingCandidates.value.map(candidate => ({
        label: `${candidate.label} (${t(`classroom.koding_candidate_${candidate.type}`)})`,
        value: candidate.key
    }))
])

const selectedKodingCandidate = computed(() => {
    return kodingCandidates.value.find(candidate => candidate.key === kodingForm.value.candidateKey) || null
})

const selectedKodingCandidateCredentials = computed(() => {
    return selectedKodingCandidate.value?.credentials || []
})

const kodingCredentialOptions = computed(() => [
    { label: t('classroom.koding_select_account'), value: '' },
    ...selectedKodingCandidateCredentials.value.map(credential => ({
        label: credential.username || t('classroom.koding_unnamed_account'),
        value: credential.id || credential.username || ''
    }))
])



const selectedMakeupEnrollment = computed(() => {
    return makeupCandidates.value.find(item => item.id === selectedMakeupEnrollmentId.value) || null
})

function handleMakeupStudentChange() {
    selectedMakeupEnrollmentId.value = null
}

function formatDateOnly(date: Date): string {
    return DateUtils.formatLocalDate(date)
}

function findOccurrenceByDate(date: Date): ClassOccurrence | undefined {
    const target = formatDateOnly(date)
    return sessionOccurrences.value.find(occ => formatDateOnly(occ.occurrenceDate) === target)
}

function findClosestOccurrence(targetDate: Date): ClassOccurrence | null {
    if (sessionOccurrences.value.length === 0) {
        return null
    }

    return [...sessionOccurrences.value].sort((a, b) => {
        const diffA = Math.abs(new Date(a.occurrenceDate).getTime() - targetDate.getTime())
        const diffB = Math.abs(new Date(b.occurrenceDate).getTime() - targetDate.getTime())
        return diffA - diffB
    })[0]
}

function findLatestOccurrenceBeforeOrOn(date: Date): ClassOccurrence | null {
    const target = date.getTime()
    const candidates = sessionOccurrences.value
        .filter(occ => new Date(occ.occurrenceDate).getTime() <= target)
        .sort((a, b) => new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime())

    return candidates[0] || null
}

async function loadSessionOccurrences(anchorDate: Date): Promise<void> {
    const rangeStart = new Date(anchorDate)
    rangeStart.setFullYear(rangeStart.getFullYear() - 1)

    const rangeEnd = new Date(anchorDate)
    rangeEnd.setFullYear(rangeEnd.getFullYear() + 1)

    sessionOccurrences.value = await OccurrenceService.getOccurrencesByDateRange(rangeStart, rangeEnd, [sessionId])
}

async function loadReportsForCurrentOccurrence() {
    reportMap.value = new Map()

    if (!todayOccurrence.value) {
        return
    }

    const occurrenceReports = await OccurrenceReportService.getReportsByOccurrence(todayOccurrence.value.id)
    const reportEnrollmentIds = new Set(occurrenceReports.map(r => r.enrollmentId))

    occurrenceReports.forEach(r => {
        if (r.enrollmentId) {
            reportMap.value.set(r.enrollmentId, r)
        }
    })

    const currentEnrollmentIds = new Set(enrollments.value.map(e => e.id))
    const guestEnrollmentIds = [...reportEnrollmentIds].filter(id => id && !currentEnrollmentIds.has(id))

    if (guestEnrollmentIds.length > 0) {
        const guestPromises = guestEnrollmentIds.map(id => CourseService.getEnrollmentById(id!))
        const guests = await Promise.all(guestPromises)
        const addedGuests: Enrollment[] = []

        guests.forEach(guest => {
            if (guest) {
                ; (guest as any).isGuest = true
                if (!enrollments.value.find(e => e.id === guest.id)) {
                    enrollments.value.push(guest)
                    addedGuests.push(guest)
                }
            }
        })

        if (addedGuests.length > 0) {
            await loadStudentProgressSummaries(addedGuests, 'merge', todayOccurrence.value.occurrenceDate)
        }
    }

    for (const enr of enrollments.value) {
        if (enr.id && !reportMap.value.has(enr.id)) {
            reportMap.value.set(enr.id, null)
        }
    }
}

async function loadOccurrenceTeachers() {
    if (!todayOccurrence.value) {
        occurrenceTeachers.value = []
        selectedTeacherIds.value = new Set()
        return
    }

    // Refresh session teachers to get latest intervals
    sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)

    const dateStr = DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate)

    // Find teachers active on this date from the plan
    const activeAssignments = sessionTeachers.value.filter(st => {
        if (dateStr < st.effective_from) return false
        if (st.effective_to && dateStr > st.effective_to) return false
        return true
    })

    const planTeacherIds = [...new Set(activeAssignments.map(a => a.id).filter(id => !!id))] as string[]

    // Current "Reality" is still teacherIds in the occurrence, 
    // but we should probably sync if they differ and it's a fresh view
    const currentTeacherIds = todayOccurrence.value.teacherIds || []

    // If the occurrence has no teachers yet (freshly generated), or if we want to sync
    // For now, let's trust the Plan for displaying assignments in the editor, 
    // but keep occurrenceTeachers based on the Reality for attendance.

    selectedTeacherIds.value = new Set(currentTeacherIds)

    if (currentTeacherIds.length === 0 && planTeacherIds.length > 0) {
        // Auto-sync if reality is empty but plan has teachers
        selectedTeacherIds.value = new Set(planTeacherIds)
        await saveOccurrenceTeachers(false) // silent sync
    }

    if (allTeachersList.value.length === 0) {
        const { data } = await TeacherService.getTeachers(1, 1000)
        allTeachersList.value = data
    }

    occurrenceTeachers.value = allTeachersList.value.filter(t => t.id && selectedTeacherIds.value.has(t.id))
}

async function setCurrentOccurrence(occurrence: ClassOccurrence | null) {
    todayOccurrence.value = occurrence

    if (occurrence?.occurrenceDate) {
        weekAnchorDate.value = new Date(occurrence.occurrenceDate)

        // Check if occurrence is within a holiday period
        try {
            const occurrenceDateStr = occurrence.occurrenceDate instanceof Date
                ? DateUtils.formatLocalDate(occurrence.occurrenceDate)
                : occurrence.occurrenceDate
            isOccurrenceInHoliday.value = await HolidayService.isHoliday(occurrenceDateStr, undefined, occurrence.classSessionId)
        } catch (e) {
            console.error('Failed to check holiday status:', e)
            isOccurrenceInHoliday.value = false
        }
    }

    await Promise.all([
        loadReportsForCurrentOccurrence(),
        loadOccurrenceTeachers(),
        loadStudentProgressSummaries(enrollments.value)
    ])
}

async function handleCalendarOccurrenceSelect(occurrence: ClassOccurrence) {
    await setCurrentOccurrence(occurrence)
}

async function moveWeek(offset: number) {
    const nextAnchor = new Date(weekAnchorDate.value)
    nextAnchor.setDate(nextAnchor.getDate() + offset * 7)
    weekAnchorDate.value = nextAnchor

    await loadSessionOccurrences(nextAnchor)

    const sameDayOccurrence = findOccurrenceByDate(nextAnchor)
    const fallbackOccurrence = findClosestOccurrence(nextAnchor)
    await setCurrentOccurrence(sameDayOccurrence || fallbackOccurrence)
}

async function goToToday() {
    const today = DateUtils.todayDate(sessionTimeZone.value)
    weekAnchorDate.value = today

    await loadSessionOccurrences(today)

    const todayOccurrenceFromList = findOccurrenceByDate(today)
    const fallbackOccurrence = findClosestOccurrence(today)
    await setCurrentOccurrence(todayOccurrenceFromList || fallbackOccurrence)
}

function toggleCalendarPanel() {
    isCalendarExpanded.value = !isCalendarExpanded.value
}

// Filtered Enrollments: Only show active students if they have a report
const visibleEnrollments = computed(() => {
    return enrollments.value.filter(e => {
        // Must have a valid report in the map to be visible
        // (Null means checked but no report exists)
        return reportMap.value.get(e.id!)
    })
})

async function loadData() {
    try {
        loading.value = true
        // Reset maps to avoid stale or merged data
        reportMap.value = new Map()
        studentProgressSummaries.value = {}

        // 1. Get session details
        session.value = await SessionService.getSessionDetails(sessionId)

        // 2. Get all students enrolled in this session
        const { data: allEnrollments } = await CourseService.getEnrollmentsBySession(sessionId)
        enrollments.value = allEnrollments

        // 2.1 Load session teachers
        sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)

        // Load all teachers once for the picker
        const { data: allTeachers } = await TeacherService.getTeachers(1, 1000)
        allTeachersList.value = allTeachers

        // 2.5 Summaries will be loaded in setCurrentOccurrence

        if (allEnrollments.length > 0 && allEnrollments[0]?.courseId) {
            courseLessons.value = courseLessonsByCourseId.value[allEnrollments[0].courseId] || []
        }

        // 3. Find or Create Today's Occurrence
        const today = DateUtils.todayDate(sessionTimeZone.value)
        todayOccurrence.value = null
        weekAnchorDate.value = today

        await loadSessionOccurrences(today)

        const todayOccurrenceFromList = findOccurrenceByDate(today)

        // Check if session runs today and generate missing teaching day occurrence
        if (session.value && session.value.day_of_week === today.getDay() && !todayOccurrenceFromList) {
            await OccurrenceService.generateOccurrences(sessionId, today, today)
            await loadSessionOccurrences(today)
        }

        const preferredOccurrence = findOccurrenceByDate(today)
            || findLatestOccurrenceBeforeOrOn(today)
            || findClosestOccurrence(today)

        await setCurrentOccurrence(preferredOccurrence)
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

onMounted(() => {
    loadData()
})

// Attendance & Rating Handlers
async function toggleAttendance(enrId: string) {
    const report = reportMap.value.get(enrId)
    if (!report) return

    // Cycle: Pending -> Present -> Absent -> Pending
    const currentStatus = report.attendanceStatus || 'pending'
    let newStatus: 'present' | 'absent' | 'pending' = 'pending'

    if (currentStatus === 'pending') {
        newStatus = 'present'
    } else if (currentStatus === 'present') {
        newStatus = 'absent'
    } else {
        newStatus = 'pending'
    }

    savingMap.value.set(enrId, true)
    try {
        await OccurrenceReportService.saveReport(
            report.id,
            report.version,
            undefined,
            {
                attendanceStatus: newStatus,
                absenceReason: newStatus === 'absent' ? t('report.editor.absence_reasons.reason_not_provided') : undefined,
                content: report.content || '',
            }
        )
        // Refresh local report state
        const updated = await OccurrenceReportService.getReportById(report.id)
        reportMap.value.set(enrId, updated)
    } catch (e) {
        console.error('Failed to toggle attendance:', e)
        toast.error(t('common.save_error'))
    } finally {
        savingMap.value.delete(enrId)
    }
}

async function batchSetAttendance(status: 'present' | 'absent') {
    const ids = Array.from(selectedEnrollmentIds.value)
    if (ids.length === 0) return

    const promises = ids.map(async (enrId) => {
        const report = reportMap.value.get(enrId)
        if (!report) return

        savingMap.value.set(enrId, true)
        try {
            await OccurrenceReportService.saveReport(
                report.id,
                report.version,
                undefined,
                {
                    attendanceStatus: status,
                    absenceReason: status === 'absent' ? t('report.editor.absence_reasons.reason_not_provided') : undefined,
                    content: report.content || '',
                }
            )
            const updated = await OccurrenceReportService.getReportById(report.id)
            reportMap.value.set(enrId, updated)
        } catch (e) {
            console.error(`Failed to set attendance for ${enrId}:`, e)
        } finally {
            savingMap.value.delete(enrId)
        }
    })

    await Promise.all(promises)
    selectedEnrollmentIds.value.clear()
    toast.success(t('common.save_success'))
}

function toggleEnrollmentSelection(enrId: string) {
    if (selectedEnrollmentIds.value.has(enrId)) {
        selectedEnrollmentIds.value.delete(enrId)
    } else {
        selectedEnrollmentIds.value.add(enrId)
    }
}

function toggleSelectAll() {
    if (selectedEnrollmentIds.value.size === visibleEnrollments.value.length) {
        selectedEnrollmentIds.value.clear()
    } else {
        selectedEnrollmentIds.value = new Set(visibleEnrollments.value.map(e => e.id!))
    }
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

    visibleEnrollments.value.forEach(enrollment => {
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
                ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString()
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
            occurrence_date: todayOccurrence.value?.occurrenceDate ? new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString() : '',
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
    attendanceTemplateText.value += formatCopyTemplateToken(variable, mode)
}

function loadSelectedAttendanceTemplate() {
    const selected = attendanceTemplateLoadOptions.value.find(item => item.key === selectedAttendanceTemplateLoadKey.value)
    if (!selected) {
        return
    }

    attendanceTemplateText.value = selected.templateText || SYSTEM_ATTENDANCE_TEMPLATE
}

async function openAttendanceTemplateModal() {
    showAttendanceTemplateModal.value = true
    attendanceTemplateScope.value = 'class_session'
    attendanceTemplateText.value = SYSTEM_ATTENDANCE_TEMPLATE
    selectedAttendanceTemplateModes.value = {
        present_list: 'comma',
        absent_list: 'comma',
        pending_list: 'comma'
    }

    try {
        isLoadingAttendanceTemplate.value = true
        const [classTemplate, userTemplate, loadOptions] = await Promise.all([
            CopyTemplateService.getAttendanceTemplateByScope('class_session', sessionId),
            CopyTemplateService.getAttendanceTemplateByScope('user_default'),
            CopyTemplateService.getTemplateLoadOptions('attendance_copy', sessionId)
        ])

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
                templateText: item.templateText
            }
        })
        selectedAttendanceTemplateLoadKey.value = attendanceTemplateLoadOptions.value[0]?.key || ''

        if (classTemplate) {
            attendanceTemplateScope.value = 'class_session'
            attendanceTemplateText.value = classTemplate
            return
        }

        if (userTemplate) {
            attendanceTemplateScope.value = 'user_default'
            attendanceTemplateText.value = userTemplate
            return
        }

        attendanceTemplateText.value = SYSTEM_ATTENDANCE_TEMPLATE
    } catch (error) {
        console.error('Failed to load attendance copy template', error)
        toast.error(t('classroom.copy_template_load_failed'))
    } finally {
        isLoadingAttendanceTemplate.value = false
    }
}

async function saveAttendanceTemplate() {
    const templateText = attendanceTemplateText.value.trim()
    if (!templateText) {
        toast.error(t('classroom.copy_template_empty_error'))
        return
    }

    try {
        isSavingAttendanceTemplate.value = true
        if (attendanceTemplateScope.value === 'class_session') {
            await CopyTemplateService.saveAttendanceTemplateForSession(sessionId, templateText)
            toast.success(t('classroom.copy_template_saved_session'))
        } else {
            await CopyTemplateService.saveAttendanceTemplateAsUserDefault(templateText)
            toast.success(t('classroom.copy_template_saved_user'))
        }

        showAttendanceTemplateModal.value = false
    } catch (error) {
        console.error('Failed to save attendance copy template', error)
        toast.error(t('classroom.copy_template_save_failed'))
    } finally {
        isSavingAttendanceTemplate.value = false
    }
}

function copyAttendanceInfo() {
    if (!todayOccurrence.value || !session.value) return

    const date = new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString()
    const startTime = todayOccurrence.value.originalStartTime?.substring(0, 5) || ''
    const endTime = todayOccurrence.value.originalEndTime?.substring(0, 5) || ''
    const time = `${startTime}-${endTime}`

    // Helper to format list
    const formatList = (status: 'present' | 'absent' | 'pending') => {
        const list = visibleEnrollments.value
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

    const copyPromise = CopyTemplateService.getEffectiveAttendanceTemplate(sessionId)
        .then(({ templateText }) => {
            return renderCopyTemplate(templateText, context, buildAttendanceTemplateContext().formatters).trim()
        })

    copyToClipboard(copyPromise).then(success => {
        if (success) {
            toast.success(t('classroom.copy_success'))
        } else {
            toast.error('Failed to copy to clipboard')
        }
    }).catch(err => {
        console.error('Failed to copy: ', err)
        toast.error('Failed to copy to clipboard')
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
        await OccurrenceService.syncSessionOccurrences(sessionId)
        toast.success(t('classroom.refresh_success'))
        showRefreshConfirm.value = false
        await loadData()
    } catch (e) {
        console.error(e)
        // @ts-ignore
        toast.error(t('classroom.refresh_failed'))
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
        toast.error(t('report.error.cannot_set_conducted_during_holiday', 'Cannot mark class as conducted during a holiday period.'))
        return
    }

    try {
        const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
            is_conducted: isHeld
        })

        todayOccurrence.value.isConducted = updated.isConducted ?? isHeld
    } catch (e: any) {
        console.error('Failed to update class status:', e)
        event.target.checked = !isHeld
        const msg = e.message || ''
        if (msg.includes('Cannot set is_conducted=true')) {
            toast.error(t('report.error.cannot_set_conducted_during_holiday'))
        } else {
            toast.error(t('common.save_error'))
        }
    }
}

function isTeacherPresent(teacherId: string | undefined, userId: string | null | undefined): boolean {
    if (!teacherId || !todayOccurrence.value?.teacherAttendance) return false
    // Fallback checks for backward compatibility if user_id was stored as key
    if (userId && todayOccurrence.value.teacherAttendance[userId]) return true
    return !!todayOccurrence.value.teacherAttendance[teacherId]
}

async function toggleTeacherAttendance(teacherId: string | undefined, event: any) {
    if (!todayOccurrence.value || !teacherId) return
    const isPresent = event.target.checked

    // Guard: check if occurrence is in a holiday period
    if (isOccurrenceInHoliday.value && isPresent) {
        event.target.checked = false
        toast.error(t('report.error.cannot_set_teacher_present_during_holiday', 'Cannot mark teacher as present during a holiday period.'))
        return
    }

    try {
        const existing = todayOccurrence.value.teacherAttendance || {}
        const updatedAttendance = { ...existing, [teacherId]: isPresent }

        const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
            teacher_attendance: updatedAttendance
        })

        todayOccurrence.value.teacherAttendance = updated.teacherAttendance || updatedAttendance
    } catch (e: any) {
        console.error('Failed to update teacher attendance:', e)
        event.target.checked = !isPresent
        const msg = e.message || ''
        if (msg.includes('Cannot set teacher attendance to present')) {
            toast.error(t('report.error.cannot_set_teacher_present_during_holiday'))
        } else {
            toast.error(t('common.save_error'))
        }
    }
}

async function toggleSplitView(enrollmentId: string) {
    await quickReportEditorRef.value?.saveNow({ reason: 'switch' })

    if (selectedEnrollmentId.value === enrollmentId && showSplitView.value) {
        showSplitView.value = false
        selectedEnrollmentId.value = null
    } else {
        // finding the enrollment to get the courseId
        const enrollment = enrollments.value.find(e => e.id === enrollmentId)
        if (enrollment?.courseId) {
            courseLessons.value = await getLessonsForCourse(enrollment.courseId)
        }

        selectedEnrollmentId.value = enrollmentId
        showSplitView.value = true

        // Fetch latest report content to ensure sync with server (fixes stale data issues)
        if (todayOccurrence.value?.id) {
            savingMap.value.set(enrollmentId, true)
            OccurrenceReportService.getReport(enrollmentId, todayOccurrence.value.id)
                .then(report => {
                    reportMap.value.set(enrollmentId, report)
                })
                .catch(e => {
                    console.error('Failed to sync report on quick edit open', e)
                })
                .finally(() => {
                    savingMap.value.delete(enrollmentId)
                })
        }
    }
}

async function closeSplitView() {
    await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
    showSplitView.value = false
    selectedEnrollmentId.value = null
}

async function loadKodingCandidates() {
    isLoadingKodingCandidates.value = true
    try {
        const [studentsResult, teachersResult] = await Promise.all([
            StudentService.getAll(1, 10000),
            TeacherService.getAllTeachersWithCredentials()
        ])

        const studentCandidates = studentsResult.data.map(student => ({
            key: `student:${student.id}`,
            type: 'student' as const,
            label: student.displayName,
            credentials: getKodingCredentials(student.credentials)
        }))

        const teacherCandidates = teachersResult.map(teacher => ({
            key: `teacher:${teacher.id}`,
            type: 'teacher' as const,
            label: teacher.name,
            credentials: getKodingCredentials(teacher.teacher_credentials)
        }))

        kodingCandidates.value = [...studentCandidates, ...teacherCandidates].sort((left, right) =>
            left.label.localeCompare(right.label, preferences.locale)
        )
    } catch (error: any) {
        console.error(error)
        toast.error(error.message || t('classroom.koding_load_candidates_failed'))
    } finally {
        isLoadingKodingCandidates.value = false
    }
}

async function openKodingCheck(enrollment: Enrollment) {
    kodingTargetEnrollment.value = enrollment
    kodingForm.value = {
        lesson: '',
        candidateKey: '',
        credentialId: ''
    }

    try {
        const lessons = await getLessonsForCourse(enrollment.courseId)
        kodingLessonOptions.value = [
            { label: t('classroom.koding_select_lesson'), value: '' },
            ...lessons
                .filter(lesson => lesson.sequence !== undefined && lesson.sequence !== null)
                .sort((left, right) => left.sequence - right.sequence)
                .map(lesson => ({
                    label: `L${lesson.sequence} ${lesson.title}`,
                    value: String(lesson.sequence)
                }))
        ]

        const report = reportMap.value.get(enrollment.id!)
        const reportLesson = report?.lessonId ? lessons.find(lesson => lesson.id === report.lessonId) : undefined
        kodingForm.value.lesson = reportLesson?.sequence ? String(reportLesson.sequence) : ''
    } catch (error) {
        console.error(error)
        kodingLessonOptions.value = [{ label: t('classroom.koding_select_lesson'), value: '' }]
    }

    showKodingCheckModal.value = true
    await loadKodingCandidates()
}

function handleKodingCandidateChange(candidateKey?: string) {
    const key = candidateKey ?? kodingForm.value.candidateKey
    const candidate = kodingCandidates.value.find(item => item.key === key)
    const credentials = candidate?.credentials || []
    kodingForm.value.credentialId = credentials.length === 1
        ? (credentials[0].id || credentials[0].username || '')
        : ''
}

function getSelectedKodingUsername(): string {
    const credential = selectedKodingCandidateCredentials.value.find(item =>
        (item.id || item.username || '') === kodingForm.value.credentialId
    )

    return credential?.username?.trim() || ''
}

function launchKodingCheck() {
    const admissionId = kodingTargetEnrollment.value?.kodingAdmissionId?.trim() || ''
    const lesson = kodingForm.value.lesson.trim()
    const userName = getSelectedKodingUsername()

    if (!admissionId) {
        toast.error(t('classroom.koding_missing_admission_id'))
        return
    }

    if (!lesson) {
        toast.error(t('classroom.koding_missing_lesson'))
        return
    }

    if (!selectedKodingCandidate.value) {
        toast.error(t('classroom.koding_missing_comparison'))
        return
    }

    if (selectedKodingCandidateCredentials.value.length === 0) {
        toast.error(t('classroom.koding_no_account'))
        return
    }

    if (!userName) {
        toast.error(t('classroom.koding_missing_account'))
        return
    }

    const url = buildKodingCodeCheckUrl({ admissionId, userName, lesson })
    window.open(url, '_blank', 'noopener,noreferrer')
    showKodingCheckModal.value = false
}

async function openAddStudentModal() {
    showAddStudentModal.value = true
    makeupSearch.value = ''
    selectedMakeupStudentId.value = ''
    selectedMakeupEnrollmentId.value = ''
    makeupJoinDate.value = normalizeDateInput(todayOccurrence.value?.occurrenceDate)

    try {
        isAddingStudent.value = true
        makeupCandidates.value = await EnrollmentService.getActiveEnrollmentCandidates()
    } catch (error: any) {
        toast.error(error?.message || t('classroom.add_student_load_failed'))
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
        toast.error(t('classroom.add_student_required_fields'))
        return
    }

    const normalizedJoinDate = normalizeDateInput(makeupJoinDate.value)
    makeupJoinDate.value = normalizedJoinDate

    const selected = selectedMakeupEnrollment.value
    if (!selected) {
        toast.error(t('classroom.add_student_enrollment_not_found'))
        return
    }

    if (selected.status !== 'regular' && normalizedJoinDate >= DateUtils.todayString(preferences.timeZone)) {
        toast.error(t('classroom.add_student_active_only_for_future'))
        return
    }

    try {
        isAddingStudent.value = true
        await EnrollmentService.addEnrollmentToSessionOccurrence(
            selectedMakeupEnrollmentId.value,
            sessionId,
            normalizedJoinDate
        )

        if (normalizeDateInput(todayOccurrence.value?.occurrenceDate) === normalizedJoinDate) {
            await loadReportsForCurrentOccurrence()
        }

        toast.success(t('classroom.add_student_success'))
        closeAddStudentModal()
    } catch (error: any) {
        if (error?.message?.includes('Invalid date format')) {
            toast.error(t('classroom.add_student_invalid_date'))
            return
        }
        if (error?.message?.includes('DUPLICATE_OCCURRENCE_REPORT')) {
            toast.error(t('classroom.add_student_duplicate_report'))
            return
        }
        if (error?.message?.includes('MAKEUP_DATE_NOT_CLASS_DAY')) {
            toast.error(t('classroom.add_student_not_class_day'))
            return
        }
        toast.error(error?.message || t('classroom.add_student_failed'))
    } finally {
        isAddingStudent.value = false
    }
}

function handleEditorUpdate(content: string, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.content = content
    }
}

function handleReportExternalLinkUpdate(link: string, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.externalLink = link
    }
}

function handleSaveSuccess(version: number, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.version = version
    }
}

function handleReportRestored(restoredReport: OccurrenceReportDTO) {
    if (selectedEnrollmentId.value) {
        reportMap.value.set(selectedEnrollmentId.value, new OccurrenceReport(restoredReport))
    }
}

function handleSaveError(error: string) {
    toast.error(`${t('report.save_error')}: ${error}`)
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
        const report = await OccurrenceReportService.resolveConflict(
            conflictReportId.value,
            resolvedReport
        )

        // Update local state
        // Find which enrollment this belongs to
        for (const [enrId, r] of reportMap.value.entries()) {
            if (r.id === report.id) {
                reportMap.value.set(enrId, report)
                break
            }
        }

        showConflictModal.value = false
        conflictReportId.value = null
        toast.success(t('report.save_success'))
    } catch (error) {
        console.error('Failed to resolve conflict:', error)
        toast.error(t('report.resolve_conflict_error'))
    }
}

function openTeacherEditModal() {
    if (!todayOccurrence.value) return
    teacherSearchQuery.value = ''
    selectedTeacherIds.value = new Set(todayOccurrence.value.teacherIds || [])
    showTeacherEditModal.value = true
}



async function saveOccurrenceTeachers(showToast = true) {
    if (!todayOccurrence.value) return

    try {
        isSavingTeachers.value = true
        const newTeacherIds = Array.from(selectedTeacherIds.value)

        // Sync teacher attendance JSON
        const existingAttendance = todayOccurrence.value.teacherAttendance || {}
        const newAttendance: Record<string, boolean> = {}

        newTeacherIds.forEach(id => {
            newAttendance[id] = existingAttendance[id] !== undefined ? existingAttendance[id] : true
        })

        const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
            teacher_ids: newTeacherIds,
            teacher_attendance: newAttendance
        })

        todayOccurrence.value.teacherIds = updated.teacherIds
        todayOccurrence.value.teacherAttendance = updated.teacherAttendance

        // No need to reload all session teachers here, just update occurrenceTeachers
        occurrenceTeachers.value = allTeachersList.value.filter(t => t.id && selectedTeacherIds.value.has(t.id))

        showTeacherEditModal.value = false
        if (showToast) toast.success(t('common.save_success'))
    } catch (e: any) {
        console.error('Failed to save teachers:', e)
        if (showToast) toast.error(t('common.save_error'))
    } finally {
        isSavingTeachers.value = false
    }
}

async function addTeacherForToday(teacher: TeacherDTO) {
    if (!todayOccurrence.value || !teacher.id) return

    try {
        isSavingTeachers.value = true
        const dateStr = DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate)

        // 1. Add to Plan (class_session_teachers)
        await TeacherService.assignTeacherForDate(sessionId, teacher.id, dateStr)

        // 2. Add to Reality (teacher_ids)
        selectedTeacherIds.value.add(teacher.id)
        await saveOccurrenceTeachers(false)

        // 3. Refresh Plan View
        sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)

        toast.success(t('common.save_success'))
    } catch (e) {
        console.error('Failed to add teacher for today:', e)
        toast.error(t('common.save_error'))
    } finally {
        isSavingTeachers.value = false
    }
}

async function removeAssignment(teacherId: string, effectiveFrom: string) {
    if (!confirm(t('common.confirm_delete'))) return

    try {
        isSavingTeachers.value = true
        // 1. Remove from Plan
        await TeacherService.removeTeacherAssignment(sessionId, teacherId, effectiveFrom)

        // 2. Remove from Reality for this occurrence if it matches
        const dateStr = todayOccurrence.value ? DateUtils.formatLocalDate(todayOccurrence.value.occurrenceDate) : ''
        if (effectiveFrom === dateStr) {
            selectedTeacherIds.value.delete(teacherId)
            await saveOccurrenceTeachers(false)
        }

        // 3. Refresh
        sessionTeachers.value = await TeacherService.getSessionTeachers(sessionId)
        await loadOccurrenceTeachers()

        toast.success(t('common.save_success'))
    } catch (e) {
        console.error('Failed to remove assignment:', e)
        toast.error(t('common.save_error'))
    } finally {
        isSavingTeachers.value = false
    }
}

</script>

<template>
    <div class="space-y-8 animate-in fade-in duration-500">
        <!-- Header -->
        <div class="flex items-center gap-4">
            <button @click="router.push({ name: 'classrooms' })"
                class="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-100 transition-all shadow-sm active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <div class="flex-1">
                <h1 class="text-3xl font-black text-gray-900 tracking-tight" v-if="session">{{ session.name }}</h1>
                <div class="flex items-center gap-3 mt-1 text-sm font-bold text-gray-400" v-if="session">
                    <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        {{ session.classroom_name }}
                    </span>
                    <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {{ session.start_time.slice(0, 5) }} - {{ session.end_time.slice(0, 5) }}
                    </span>
                    <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span>{{ session.time_zone || 'Asia/Taipei' }}</span>
                    <span v-if="session.external_link" class="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <a v-if="session.external_link" :href="session.external_link" target="_blank"
                        class="flex items-center gap-1.5 text-emerald-600 hover:underline">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        {{ $t('classroom.external_link') }}
                    </a>
                    <span v-if="session.classroom?.external_link" class="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <a v-if="session.classroom?.external_link" :href="session.classroom?.external_link" target="_blank"
                        class="flex items-center gap-1.5 text-blue-600 hover:underline">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        {{ $t('classroom.room_external_link') }}
                    </a>
                </div>
            </div>

            <!-- Refresh Schedule Button -->
            <div class="w-56">
                <TimeZoneSelect :label="$t('common.time_zone')" dense />
            </div>

            <button @click="requestRefreshSchedule"
                class="p-3 rounded-2xl bg-white border border-gray-100 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-100 transition-all shadow-sm active:scale-90"
                :title="$t('classroom.refresh_schedule')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>

            <!-- Toggle Split View Action (Global or just keeps context context) -->
            <button v-if="showSplitView" @click="closeSplitView"
                class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition font-bold text-sm">
                {{ $t('common.close_split_view') }}
            </button>
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

        <div v-else class="w-full">
            <div class="grid gap-6 transition-all duration-500 ease-in-out min-w-0"
                :class="showSplitView ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_450px] xl:grid-cols-[minmax(0,1fr)_560px]' : 'grid-cols-1'">

                <!-- LEFT COLUMN: Student List & Stats -->
                <div class="space-y-6 min-w-0" :class="{ 'hidden lg:block': showSplitView }">
                    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
                        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div>
                                <h3 class="font-black text-gray-900">{{ $t('classroom.teaching_day_navigation') }}</h3>
                                <p class="text-xs font-bold text-gray-400">{{ displayedOccurrenceDate }}</p>
                            </div>

                            <div class="flex items-center gap-2 flex-wrap md:justify-end">
                                <button @click="moveWeek(-1)"
                                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest">
                                    {{ $t('classroom.previous_week') }}
                                </button>
                                <button @click="goToToday"
                                    class="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100 transition-all text-xs font-black uppercase tracking-widest">
                                    {{ $t('classroom.back_to_today') }}
                                </button>
                                <button @click="moveWeek(1)"
                                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest">
                                    {{ $t('classroom.next_week') }}
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

                        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ weekRangeLabel }}
                        </p>

                        <Transition name="fade-slide">
                            <div v-show="isCalendarExpanded" class="max-w-4xl mx-auto w-full">
                                <OccurrenceCalendar :occurrences="sessionOccurrences" :compact="true"
                                    @select-occurrence="handleCalendarOccurrenceSelect" />
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
                                :title="isOccurrenceInHoliday ? ($t('report.error.cannot_set_conducted_during_holiday', 'Cannot modify during holiday') || 'Holiday Period') : ($t('classroom.class_held') || 'Class Held')"
                                :class="{ 'opacity-50 cursor-not-allowed': isOccurrenceInHoliday }">
                                <input type="checkbox" :checked="todayOccurrence && todayOccurrence.isConducted"
                                    :disabled="isOccurrenceInHoliday" @change="toggleIsConducted($event)"
                                    class="sr-only peer">
                                <div :class="isOccurrenceInHoliday ? 'bg-red-100' : 'bg-gray-200'"
                                    class="w-14 h-7 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Teacher Attendance Section -->
                    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4"
                        v-if="todayOccurrence">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="font-black text-gray-900">{{ $t('classroom.teacher_attendance_title') }}</h3>
                                <p class="text-xs font-bold text-gray-400">
                                    {{ $t('classroom.teacher_attendance_subtitle') }}
                                </p>
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

                        <div v-if="occurrenceTeachers.length > 0" class="flex flex-wrap gap-4 mt-2">
                            <div v-for="teacher in occurrenceTeachers" :key="teacher.id"
                                class="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-2xl border border-gray-100 transition-colors"
                                :class="{ 'border-emerald-200 bg-emerald-50/50': isTeacherPresent(teacher.id, teacher.user_id) }">

                                <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold"
                                    :class="isTeacherPresent(teacher.id, teacher.user_id) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'">
                                    {{ teacher.name.charAt(0) }}
                                </div>
                                <div class="flex-1 pr-2">
                                    <div class="font-bold text-gray-900">{{ teacher.name }}</div>
                                    <div class="text-[10px] uppercase font-black tracking-widest"
                                        :class="isTeacherPresent(teacher.id, teacher.user_id) ? 'text-emerald-600' : 'text-gray-400'">
                                        {{ isTeacherPresent(teacher.id, teacher.user_id) ? $t('attendance.present') : $t('attendance.absent') }}
                                    </div>
                                </div>

                                <label class="relative inline-flex items-center cursor-pointer ml-2"
                                    :class="{ 'opacity-50 cursor-not-allowed': auth.user?.id !== teacher.user_id || isOccurrenceInHoliday }"
                                    :title="isOccurrenceInHoliday ? $t('report.error.cannot_set_teacher_present_during_holiday') : (auth.user?.id !== teacher.user_id ? $t('classroom.teacher_attendance_only_self') : '')">
                                    <input type="checkbox" :checked="isTeacherPresent(teacher.id, teacher.user_id)"
                                        :disabled="auth.user?.id !== teacher.user_id || isOccurrenceInHoliday"
                                        @change="toggleTeacherAttendance(teacher.id, $event)" class="sr-only peer">
                                    <div :class="isOccurrenceInHoliday ? 'bg-red-100' : 'bg-gray-200'"
                                        class="w-11 h-6 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500">
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

                    <!-- Quick Attendance Block (Refined & Collapsible) -->
                    <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden"
                        v-if="todayOccurrence">
                        <!-- Header (Always Visible) -->
                        <div class="p-6 md:p-8 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
                            @click="isQuickAttendanceExpanded = !isQuickAttendanceExpanded">
                            <div class="flex items-center gap-4">
                                <div class="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 class="font-black text-xl text-gray-900">{{
                                        $t('classroom.quick_attendance_title')
                                    }}</h3>
                                    <p class="text-xs font-bold text-gray-400">
                                        {{ $t('classroom.quick_attendance_subtitle') }}
                                    </p>
                                </div>
                            </div>
                            <div class="flex items-center gap-4">
                                <button @click.stop="openAddStudentModal"
                                    class="px-4 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-all text-xs font-black uppercase tracking-widest">
                                    {{ $t('classroom.add_student_to_class') }}
                                </button>
                                <span v-if="selectedEnrollmentIds.size > 0"
                                    class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-wider">
                                    {{ selectedEnrollmentIds.size }} {{ $t('common.selected') }}
                                </span>
                                <div class="p-2 rounded-xl bg-gray-50 text-gray-400 transition-transform duration-300"
                                    :class="{ 'rotate-180': isQuickAttendanceExpanded }">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                            d="M19 9l-7 7-7-7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        <!-- Expandable Content -->
                        <div v-show="isQuickAttendanceExpanded"
                            class="px-6 md:px-8 pb-8 pt-2 space-y-8 border-t border-gray-50">
                            <!-- Batch Action Buttons -->
                            <div class="flex items-center gap-3">
                                <button @click="batchSetAttendance('present')"
                                    :disabled="selectedEnrollmentIds.size === 0"
                                    class="flex-1 px-6 py-4 bg-emerald-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-100/50">
                                    {{ $t('attendance.present') }}
                                </button>
                                <button @click="batchSetAttendance('absent')"
                                    :disabled="selectedEnrollmentIds.size === 0"
                                    class="flex-1 px-6 py-4 bg-red-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-100/50">
                                    {{ $t('attendance.absent') }}
                                </button>
                            </div>

                            <div class="space-y-4">
                                <!-- Select All Toggle -->
                                <div class="flex items-center justify-between">
                                    <button @click="toggleSelectAll"
                                        class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all active:scale-95"
                                        :class="selectedEnrollmentIds.size === visibleEnrollments.length && visibleEnrollments.length > 0
                                            ? 'bg-gray-900 text-white border-gray-900 shadow-lg shadow-gray-200'
                                            : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'">
                                        {{ selectedEnrollmentIds.size === visibleEnrollments.length &&
                                            visibleEnrollments.length > 0 ? $t('common.deselect_all') :
                                            $t('common.select_all')
                                        }}
                                    </button>
                                    <span class="text-[10px] font-black text-gray-300 uppercase tracking-widest">{{
                                        visibleEnrollments.length }} {{ $t('common.total') }}</span>
                                </div>

                                <!-- Student Grid (Optimized for Visibility) -->
                                <div
                                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                                    <button v-for="e in visibleEnrollments" :key="e.id"
                                        @click="toggleEnrollmentSelection(e.id!)"
                                        class="px-5 py-4 rounded-2xl border transition-all active:scale-95 flex items-center justify-between gap-3 group ring-offset-2 relative overflow-hidden"
                                        :class="[
                                            selectedEnrollmentIds.has(e.id!)
                                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xl shadow-emerald-100 ring-2 ring-emerald-500'
                                                : 'bg-white text-gray-700 border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/20'
                                        ]">
                                        <div class="flex items-center gap-3 min-w-0 z-10">
                                            <!-- Status Indicator Dot -->
                                            <div class="w-3 h-3 rounded-full shrink-0 shadow-sm border-2 border-white"
                                                :class="{
                                                    'bg-emerald-400': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                                    'bg-red-400': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                                    'bg-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                                }"></div>

                                            <span class="font-black text-base truncate">{{ e.studentName }}</span>
                                        </div>

                                        <!-- Checkmark for selection -->
                                        <div class="shrink-0 z-10 transition-all duration-300 transform"
                                            :class="selectedEnrollmentIds.has(e.id!) ? 'scale-100 opacity-100' : 'scale-50 opacity-0'">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-100"
                                                viewBox="0 0 20 20" fill="currentColor">
                                                <path fill-rule="evenodd"
                                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                    clip-rule="evenodd" />
                                            </svg>
                                        </div>

                                        <!-- Subtle Background Pattern for Selected -->
                                        <div v-if="selectedEnrollmentIds.has(e.id!)"
                                            class="absolute -right-4 -bottom-4 text-white/5 transform rotate-12">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-20 w-20"
                                                fill="currentColor" viewBox="0 0 24 24">
                                                <path
                                                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                            </svg>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Stats Bar (Conditional or Compact in Split View?) -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6" v-if="!showSplitView">
                        <div
                            class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                            <div>
                                <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{
                                    $t('classroom.total_students') }}</h4>
                                <p class="text-5xl font-black tracking-tighter">{{ visibleEnrollments.length }}</p>
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
                                        Math.round((visibleEnrollments.length / (session?.capacity || 1)) * 100) }}%</p>
                                    <p class="text-xs font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{
                                        $t('classroom.capacity') }}</p>
                                </div>
                            </div>
                            <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                    :style="{ width: `${(visibleEnrollments.length / (session?.capacity || 1)) * 100}%` }">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Responsive Card List -->
                    <div class="grid grid-cols-1 gap-4" :class="showSplitView ? '2xl:hidden' : 'xl:hidden'">
                        <div v-for="e in visibleEnrollments" :key="e.id"
                            class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                            <div class="space-y-3">
                                <!-- A. Header -->
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex items-center gap-3 min-w-0">
                                        <div
                                            class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-xl shrink-0">
                                            {{ e.studentName?.charAt(0) }}
                                        </div>
                                        <div class="min-w-0">
                                            <div class="font-black text-gray-900 text-lg leading-tight truncate">{{
                                                e.studentName }}</div>
                                        </div>
                                    </div>

                                    <div class="flex flex-col items-end gap-2 shrink-0">
                                        <span v-if="(e as any).isGuest"
                                            class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border bg-purple-50 text-purple-700 border-purple-100">
                                            {{ $t('common.rescheduled') }}
                                        </span>
                                        <span
                                            class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border"
                                            :class="e.status === 'regular'
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                : (e.status === 'trial'
                                                    ? 'bg-amber-50 text-amber-700 border-amber-100'
                                                    : 'bg-gray-50 text-gray-400 border-gray-200')">
                                            {{ $t('student.internal_courses.status_' + e.status) }}
                                        </span>
                                    </div>
                                </div>

                                <!-- B. Current Course -->
                                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                                    <div class="text-[12px] font-black uppercase tracking-[0.22em] text-slate-400">
                                        {{ $t('classroom.current_course') }}</div>
                                    <div class="mt-1 text-sm font-bold text-slate-900 leading-snug break-words">
                                        {{ getStudentProgressSummary(e.id).currentCourse }}</div>
                                </div>

                                <!-- C. Today Course Summary -->
                                <div class="rounded-2xl border border-slate-200 bg-white p-3 space-y-2.5">
                                    <div class="text-[12px] font-black uppercase tracking-[0.22em] text-slate-400">
                                        {{ $t('classroom.today_course_summary') }}</div>
                                    <div class="text-[15px] font-black text-slate-900 break-words">
                                        {{ getTodayCourseSummary(e).title }}</div>
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-[11px] font-bold text-slate-500">{{
                                            $t('classroom.chapter_progress') }}</span>
                                        <span class="text-xs font-black text-slate-800">{{
                                            getTodayCourseSummary(e).chapterProgress }}</span>
                                    </div>
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-[11px] font-bold text-slate-500">{{
                                            $t('classroom.completion_status') }}</span>
                                        <span
                                            class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black tracking-wide"
                                            :class="getProgressToneClasses(getTodayCourseSummary(e).tone)">
                                            {{ getTodayCourseSummary(e).completionStatus }}
                                        </span>
                                    </div>
                                </div>

                                <!-- D. Learning Snapshot -->
                                <div class="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                                    <div class="text-[12px] font-black uppercase tracking-[0.22em] text-slate-400">
                                        {{ $t('classroom.learning_snapshot') }}</div>
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <div class="text-[11px] font-bold text-slate-500">{{
                                                $t('classroom.highest_progress') }}</div>
                                            <div class="text-xs font-black text-slate-900 break-words">{{
                                                getStudentProgressSummary(e.id).highestProgressTitle }}</div>
                                        </div>
                                        <span
                                            class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide"
                                            :class="getProgressToneClasses(getStudentProgressSummary(e.id).highestProgressTone)">
                                            {{ getStudentProgressSummary(e.id).highestProgressStatus }}
                                        </span>
                                    </div>
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <div class="text-[11px] font-bold text-slate-500">{{
                                                $t('classroom.latest_progress') }}</div>
                                            <div class="text-xs font-black text-slate-900 break-words">{{
                                                getStudentProgressSummary(e.id).latestProgressTitle }}</div>
                                        </div>
                                        <span
                                            class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide"
                                            :class="getProgressToneClasses(getStudentProgressSummary(e.id).latestProgressTone)">
                                            {{ getStudentProgressSummary(e.id).latestProgressStatus }}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <hr class="border-gray-50">

                            <!-- Attendance Row -->
                            <div class="flex items-center justify-between" v-if="todayOccurrence">
                                <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">{{
                                    $t('attendance.status') }}</span>
                                <div class="flex items-center gap-3">
                                    <span class="text-sm font-bold transition-colors"
                                        :class="reportMap.get(e.id!)?.attendanceStatus === 'present' ? 'text-emerald-600' : 'text-gray-400'">
                                        {{ reportMap.get(e.id!)?.attendanceStatus ? $t('attendance.' +
                                            reportMap.get(e.id!)?.attendanceStatus) : $t('attendance.pending') }}
                                    </span>
                                    <button type="button" @click="toggleAttendance(e.id!)"
                                        class="p-2 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center"
                                        :class="{
                                            'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 focus:ring-emerald-500': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                            'bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-500': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                            'bg-gray-100 text-gray-400 hover:bg-gray-200 focus:ring-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                        }" :title="$t('attendance.status')" :disabled="savingMap.has(e.id!)">
                                        <!-- Present Icon (Check) -->
                                        <svg v-if="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                            xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clip-rule="evenodd" />
                                        </svg>

                                        <!-- Absent Icon (X) -->
                                        <svg v-else-if="reportMap.get(e.id!)?.attendanceStatus === 'absent'"
                                            xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                                clip-rule="evenodd" />
                                        </svg>

                                        <!-- Pending Icon (Circle/Question) -->
                                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <!-- Actions Grid -->
                            <div class="space-y-2 pt-2">
                                <div class="grid grid-cols-2 gap-3">
                                    <router-link :to="{ name: 'lesson-reports', params: { enrollmentId: e.id! } }"
                                        class="inline-flex items-center justify-center gap-2 p-3 rounded-2xl bg-emerald-600 text-white border border-emerald-700 no-underline active:scale-95 transition-all shadow-lg shadow-emerald-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span class="text-xs font-black tracking-wide">{{ $t('common.reports') }}</span>
                                    </router-link>

                                    <button @click.stop="toggleSplitView(e.id!)"
                                        class="flex items-center justify-center gap-2 p-3 rounded-2xl border active:scale-95 transition-all"
                                        :class="selectedEnrollmentId === e.id && showSplitView ? 'bg-blue-600 text-white border-blue-700 shadow-blue-200 shadow-lg' : 'bg-blue-50 text-blue-700 border-blue-100'">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                        </svg>
                                        <span class="text-xs font-black tracking-wide">{{ $t('common.edit') }}</span>
                                    </button>
                                </div>

                                <button @click="openKodingCheck(e)"
                                    class="inline-flex w-full items-center justify-center gap-2 p-3 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 active:scale-95 transition-all"
                                    :title="$t('classroom.koding_check')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M9.75 17L8.25 12l1.5-5M14.25 7l1.5 5-1.5 5M4.5 12h15" />
                                    </svg>
                                    <span class="text-xs font-black tracking-wide">{{ $t('classroom.koding_check') }}</span>
                                </button>

                                <router-link :to="{ name: 'student-profile', params: { id: e.studentId } }"
                                    class="inline-flex w-full items-center justify-center gap-2 p-3 rounded-2xl bg-gray-50 text-gray-500 border border-gray-100 no-underline active:scale-95 transition-all"
                                    :title="$t('classroom.view_profile')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                    </svg>
                                    <span class="text-xs font-bold">{{ $t('common.profile') }}</span>
                                </router-link>
                            </div>
                        </div>

                        <!-- Empty State Mobile -->
                        <div v-if="visibleEnrollments.length === 0"
                            class="flex flex-col items-center justify-center py-12 text-gray-300">
                            <span class="font-black italic tracking-widest">{{ $t('classroom.no_students_enrolled')
                            }}</span>
                        </div>
                    </div>

                    <!-- Desktop Table List -->
                    <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-x-auto"
                        :class="showSplitView ? 'hidden 2xl:block' : 'hidden xl:block'">
                        <table class="w-full min-w-[1020px] text-left border-collapse">
                            <thead>
                                <tr class="bg-gray-50/50">
                                    <th class="px-3 lg:px-4 py-4 lg:py-6 text-[12px] font-black text-gray-400 uppercase tracking-widest text-center"
                                        v-if="todayOccurrence">{{ $t('attendance.status') }}</th>
                                    <th
                                        class="px-3 lg:px-4 py-4 lg:py-6 text-[12px] font-black text-gray-400 uppercase tracking-widest">
                                        {{
                                            $t('classroom.student_name') }}</th>
                                    <th
                                        class="px-3 lg:px-4 py-4 lg:py-6 text-[12px] font-black text-gray-400 uppercase tracking-widest">
                                        {{
                                            $t('classroom.enrollment_status') }}</th>
                                    <th
                                        class="px-3 lg:px-4 py-4 lg:py-6 text-[12px] font-black text-gray-400 uppercase tracking-widest">
                                        {{
                                            $t('classroom.today_course_summary') }}</th>
                                    <th
                                        class="px-3 lg:px-4 py-4 lg:py-6 text-[12px] font-black text-gray-400 uppercase tracking-widest text-right w-[96px] xl:w-[176px]">
                                        {{ $t('classroom.actions') }}</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-50">
                                <tr v-for="e in visibleEnrollments" :key="e.id"
                                    class="hover:bg-emerald-50/20 transition-colors group">
                                    <!-- Attendance Column -->
                                    <td class="px-3 lg:px-4 py-4 lg:py-6 text-center" v-if="todayOccurrence">
                                        <button type="button" @click="toggleAttendance(e.id!)"
                                            class="p-2 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center mx-auto"
                                            :class="{
                                                'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 focus:ring-emerald-500': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                                'bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-500': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                                'bg-gray-100 text-gray-400 hover:bg-gray-200 focus:ring-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                            }"
                                            :title="$t('attendance.status') + ': ' + (reportMap.get(e.id!)?.attendanceStatus ? $t('attendance.' + reportMap.get(e.id!)?.attendanceStatus) : $t('attendance.pending'))"
                                            :disabled="savingMap.has(e.id!)">
                                            <!-- Present Icon (Check) -->
                                            <svg v-if="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                                xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                                fill="currentColor">
                                                <path fill-rule="evenodd"
                                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                    clip-rule="evenodd" />
                                            </svg>

                                            <!-- Absent Icon (X) -->
                                            <svg v-else-if="reportMap.get(e.id!)?.attendanceStatus === 'absent'"
                                                xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                                fill="currentColor">
                                                <path fill-rule="evenodd"
                                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                                    clip-rule="evenodd" />
                                            </svg>

                                            <!-- Pending Icon (Circle/Question) -->
                                            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                        </button>
                                    </td>

                                    <td class="px-3 lg:px-4 py-4 lg:py-6">
                                        <div class="flex items-center gap-3 lg:gap-4">
                                            <div
                                                class="w-10 lg:w-12 h-10 lg:h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-lg lg:text-xl shrink-0">
                                                {{ e.studentName?.charAt(0) }}
                                            </div>
                                            <div class="min-w-0">
                                                <div class="font-black text-gray-900 text-base lg:text-lg">{{
                                                    e.studentName }}</div>
                                                <div
                                                    class="mt-0.5 lg:mt-1 text-[9px] lg:text-[10px] font-black uppercase tracking-[0.15em] lg:tracking-[0.2em] text-gray-400 whitespace-nowrap">
                                                    {{ $t('classroom.current_course') }}</div>
                                                <div
                                                    class="mt-0.5 lg:mt-1 text-xs lg:text-sm font-bold text-gray-700 leading-snug break-words">
                                                    {{ getStudentProgressSummary(e.id).currentCourse }}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="px-3 lg:px-4 py-4 lg:py-6">
                                        <div class="flex flex-col lg:flex-row gap-2 lg:gap-1">
                                            <span v-if="(e as any).isGuest"
                                                class="px-2 lg:px-3 py-1 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-wider lg:tracking-widest border bg-purple-50 text-purple-700 border-purple-100 whitespace-nowrap inline-block lg:inline">
                                                {{ $t('common.rescheduled') }}
                                            </span>
                                            <span
                                                class="px-2 lg:px-3 py-1 rounded-xl text-[9px] lg:text-[10px] font-black uppercase tracking-wider lg:tracking-widest border whitespace-nowrap inline-block lg:inline"
                                                :class="e.status === 'regular'
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                                    : (e.status === 'trial'
                                                        ? 'bg-amber-50 text-amber-700 border-amber-100'
                                                        : 'bg-gray-50 text-gray-400 border-gray-200')">
                                                {{ $t('student.internal_courses.status_' + e.status) }}
                                            </span>
                                        </div>
                                    </td>

                                    <td class="px-3 lg:px-4 py-4 lg:py-6">
                                        <div
                                            class="rounded-2xl border border-slate-200 bg-white p-2 lg:p-3 space-y-2 lg:space-y-3 min-w-[220px] lg:min-w-[200px]">
                                            <div
                                                class="text-[9px] lg:text-[11px] font-black uppercase tracking-[0.18em] lg:tracking-[0.22em] text-slate-400">
                                                {{ $t('classroom.today_course_summary') }}</div>
                                            <div class="text-xs lg:text-sm font-black text-slate-900 break-words">
                                                {{ getTodayCourseSummary(e).title }}</div>
                                            <div class="flex items-center justify-between gap-1.5 lg:gap-2">
                                                <span class="text-[10px] lg:text-[11px] font-bold text-slate-500">{{
                                                    $t('classroom.chapter_progress') }}</span>
                                                <span
                                                    class="text-[10px] lg:text-xs font-black text-slate-800 shrink-0">{{
                                                        getTodayCourseSummary(e).chapterProgress }}</span>
                                            </div>
                                            <div class="flex items-center justify-between gap-1.5 lg:gap-2">
                                                <span class="text-[10px] lg:text-[11px] font-bold text-slate-500">{{
                                                    $t('classroom.completion_status') }}</span>
                                                <span
                                                    class="inline-flex items-center rounded-full border px-2 lg:px-2.5 py-0.5 lg:py-1 text-[10px] lg:text-[11px] font-black tracking-wide shrink-0"
                                                    :class="getProgressToneClasses(getTodayCourseSummary(e).tone)">
                                                    {{ getTodayCourseSummary(e).completionStatus }}
                                                </span>
                                            </div>

                                            <div class="border-t border-slate-100 pt-2 lg:pt-3 space-y-2">
                                                <div
                                                    class="text-[9px] lg:text-[11px] font-black uppercase tracking-[0.18em] lg:tracking-[0.22em] text-slate-400">
                                                    {{ $t('classroom.learning_snapshot') }}</div>

                                                <div class="flex items-start justify-between gap-1.5 lg:gap-2">
                                                    <div class="min-w-0">
                                                        <div
                                                            class="text-[10px] lg:text-[11px] font-bold text-slate-500">
                                                            {{ $t('classroom.highest_progress') }}</div>
                                                        <div
                                                            class="text-[11px] lg:text-xs font-black text-slate-900 break-words">
                                                            {{ getStudentProgressSummary(e.id).highestProgressTitle }}
                                                        </div>
                                                    </div>
                                                    <span
                                                        class="shrink-0 inline-flex items-center rounded-full border px-1.5 lg:px-2 py-0.5 text-[9px] lg:text-[10px] font-black tracking-wider lg:tracking-wide"
                                                        :class="getProgressToneClasses(getStudentProgressSummary(e.id).highestProgressTone)">
                                                        {{ getStudentProgressSummary(e.id).highestProgressStatus }}
                                                    </span>
                                                </div>

                                                <div class="flex items-start justify-between gap-1.5 lg:gap-2">
                                                    <div class="min-w-0">
                                                        <div
                                                            class="text-[10px] lg:text-[11px] font-bold text-slate-500">
                                                            {{ $t('classroom.latest_progress') }}</div>
                                                        <div
                                                            class="text-[11px] lg:text-xs font-black text-slate-900 break-words">
                                                            {{ getStudentProgressSummary(e.id).latestProgressTitle }}
                                                        </div>
                                                    </div>
                                                    <span
                                                        class="shrink-0 inline-flex items-center rounded-full border px-1.5 lg:px-2 py-0.5 text-[9px] lg:text-[10px] font-black tracking-wider lg:tracking-wide"
                                                        :class="getProgressToneClasses(getStudentProgressSummary(e.id).latestProgressTone)">
                                                        {{ getStudentProgressSummary(e.id).latestProgressStatus }}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>

                                    <td class="px-3 lg:px-4 py-4 lg:py-6 text-right align-top">
                                        <div
                                            class="flex flex-col xl:flex-row justify-end items-end xl:items-center gap-1.5 lg:gap-2">
                                            <router-link
                                                :to="{ name: 'lesson-reports', params: { enrollmentId: e.id! } }"
                                                class="p-2.5 xl:p-3 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-90"
                                                :title="$t('classroom.view_reports')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            </router-link>
                                            <button @click="toggleSplitView(e.id!)"
                                                class="p-2.5 xl:p-3 rounded-2xl border border-gray-100 shadow-sm transition-all active:scale-90"
                                                :class="selectedEnrollmentId === e.id && showSplitView ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-gray-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100'"
                                                :title="$t('classroom.quick_edit')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                            <button @click="openKodingCheck(e)"
                                                class="p-2.5 xl:p-3 rounded-2xl bg-amber-50 text-amber-600 hover:text-amber-700 hover:bg-amber-100 border border-amber-100 transition-all active:scale-90"
                                                :title="$t('classroom.koding_check')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M9.75 17L8.25 12l1.5-5M14.25 7l1.5 5-1.5 5M4.5 12h15" />
                                                </svg>
                                            </button>
                                            <router-link :to="{ name: 'student-profile', params: { id: e.studentId } }"
                                                class="p-2.5 xl:p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-100 transition-all active:scale-90"
                                                :title="$t('classroom.view_profile')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                                </svg>
                                            </router-link>
                                        </div>
                                    </td>
                                </tr>
                                <tr v-if="visibleEnrollments.length === 0">
                                    <td :colspan="todayOccurrence ? 5 : 4"
                                        class="px-4 lg:px-8 py-12 lg:py-20 text-center font-black italic text-gray-300 tracking-widest text-xs lg:text-base">
                                        {{ $t('classroom.no_students_enrolled') }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- RIGHT COLUMN: Report Editor -->
                <div v-if="showSplitView && selectedEnrollmentId"
                    class="animate-in slide-in-from-right-4 duration-500 min-w-0 w-full">
                    <div class="sticky top-20 bg-white rounded-[2.5rem] border border-emerald-100 shadow-xl shadow-emerald-50/50 flex flex-col overflow-hidden"
                        style="max-height: calc(100vh - 7rem);">
                        <!-- Header: Fixed at top of sticky box -->
                        <div
                            class="flex items-center justify-between p-6 pb-4 shrink-0 bg-white z-20 border-b border-gray-50 shadow-sm shadow-gray-50/20">
                            <div class="flex items-center gap-4 min-w-0">
                                <!-- Avatar and Name -->
                                <div
                                    class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-lg shadow-emerald-100">
                                    {{visibleEnrollments.find(e => e.id ===
                                        selectedEnrollmentId)?.studentName?.charAt(0)}}
                                </div>
                                <div class="min-w-0">
                                    <div class="font-black text-gray-900 text-xl leading-tight truncate">
                                        {{visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.studentName}}
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
                        <div class="flex-1 overflow-y-auto p-6 pt-4 custom-scrollbar bg-gray-50/30">
                            <ReportEditor ref="quickReportEditorRef" v-if="reportMap.get(selectedEnrollmentId)"
                                :key="selectedEnrollmentId" :report-id="reportMap.get(selectedEnrollmentId)?.id"
                                :initial-version="reportMap.get(selectedEnrollmentId)?.version"
                                :loading="savingMap.get(selectedEnrollmentId!)" :show-manual-save="true"
                                :title="todayOccurrence ? `${new Date(todayOccurrence.occurrenceDate).toLocaleDateString()} ${todayOccurrence.effectiveStartTime?.slice(0, 5) || ''}` : undefined"
                                :course-name="visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.courseSubject + ' ' + visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.courseStage"
                                :course-display-name="visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.courseDisplayName"
                                :initial-classroom-name="session?.classroom_name" :initial-session-name="session?.name"
                                :initial-session-time="session ? `${session.start_time?.slice(0, 5) || ''}-${session.end_time?.slice(0, 5) || ''}` : ''"
                                :initial-student-name="visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.studentName"
                                :initial-student-id="visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.studentId"
                                :initial-lesson-id="reportMap.get(selectedEnrollmentId)?.lessonId"
                                :available-lessons="courseLessons"
                                :initial-report-external-link="reportMap.get(selectedEnrollmentId)?.externalLink"
                                :initial-is-completed="reportMap.get(selectedEnrollmentId)?.isCompleted"
                                :initial-progress-start="reportMap.get(selectedEnrollmentId)?.progressStart"
                                :initial-progress-end="reportMap.get(selectedEnrollmentId)?.progressEnd"
                                :initial-attendance-status="reportMap.get(selectedEnrollmentId)?.attendanceStatus"
                                :initial-absence-reason="reportMap.get(selectedEnrollmentId)?.absenceReason"
                                :initial-class-participation="parseFloat(reportMap.get(selectedEnrollmentId)?.classParticipation || '0')"
                                :initial-classroom-behavior="parseFloat(reportMap.get(selectedEnrollmentId)?.classroomBehavior || '0')"
                                :initial-contact-notes="reportMap.get(selectedEnrollmentId)?.contactNotes"
                                :initial-class-notes="reportMap.get(selectedEnrollmentId)?.classNotes"
                                :initial-content="reportMap.get(selectedEnrollmentId)?.content"
                                :initial-enrollment-external-link="visibleEnrollments.find(e => e.id === selectedEnrollmentId)?.externalLink"
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

        <ConfirmModal v-if="showRefreshConfirm" :is-open="showRefreshConfirm" :title="$t('classroom.refresh_schedule')"
            :message="$t('classroom.refresh_confirm')" :confirm-text="$t('common.refresh')" confirm-type="warning"
            :is-loading="isRefreshing" @confirm="handleConfirmRefresh" @close="showRefreshConfirm = false" />

        <div v-if="showKodingCheckModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            @click.self="showKodingCheckModal = false">
            <div class="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden">
                <div class="flex items-center justify-between border-b border-gray-100 px-6 py-5">
                    <div>
                        <h2 class="text-2xl font-black text-gray-900">{{ $t('classroom.koding_check_title') }}</h2>
                        <p class="mt-1 text-sm font-semibold text-gray-400">
                            {{ kodingTargetEnrollment?.studentName }} · {{ kodingTargetEnrollment?.displayName }}
                        </p>
                    </div>
                    <button @click="showKodingCheckModal = false"
                        class="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="space-y-5 px-6 py-6">
                    <div class="rounded-2xl border p-4"
                        :class="kodingTargetEnrollment?.kodingAdmissionId ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-rose-100 bg-rose-50 text-rose-900'">
                        <div class="text-xs font-black uppercase tracking-widest opacity-70">
                            {{ $t('student.internal_courses.koding_admission_id') }}
                        </div>
                        <div class="mt-1 font-mono text-sm font-bold break-all">
                            {{ kodingTargetEnrollment?.kodingAdmissionId || $t('classroom.koding_missing_admission_id') }}
                        </div>
                    </div>

                    <div class="grid gap-4 md:grid-cols-2">
                        <div>
                            <label class="mb-2 block text-sm font-bold text-gray-700">
                                {{ $t('classroom.koding_lesson') }}
                            </label>
                            <BaseDropdown v-model="kodingForm.lesson" :options="kodingLessonOptions" theme="amber" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-bold text-gray-700">
                                {{ $t('classroom.koding_comparison') }}
                            </label>
                            <SearchableSelect v-model="kodingForm.candidateKey" :options="kodingCandidateOptions"
                                :placeholder="$t('classroom.koding_select_comparison')"
                                @update:modelValue="handleKodingCandidateChange" />
                        </div>
                    </div>

                    <div v-if="isLoadingKodingCandidates"
                        class="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        {{ $t('classroom.koding_loading_candidates') }}
                    </div>

                    <div v-if="selectedKodingCandidate && selectedKodingCandidateCredentials.length === 0"
                        class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                        {{ $t('classroom.koding_no_account') }}
                    </div>

                    <div v-if="selectedKodingCandidateCredentials.length > 1"
                        class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        {{ $t('classroom.koding_multiple_accounts_warning') }}
                    </div>

                    <div v-if="selectedKodingCandidateCredentials.length > 0">
                        <label class="mb-2 block text-sm font-bold text-gray-700">
                            {{ $t('classroom.koding_account') }}
                        </label>
                        <BaseDropdown v-model="kodingForm.credentialId" :options="kodingCredentialOptions"
                            theme="amber" />
                    </div>
                </div>

                <div class="flex justify-end gap-3 border-t border-gray-100 bg-gray-50 px-6 py-5">
                    <button @click="showKodingCheckModal = false"
                        class="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-100">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="launchKodingCheck"
                        class="rounded-2xl bg-amber-500 px-6 py-3 text-sm font-black text-white shadow-lg shadow-amber-100 transition hover:bg-amber-600">
                        {{ $t('classroom.koding_open_check') }}
                    </button>
                </div>
            </div>
        </div>

        <div v-if="showAddStudentModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div
                class="bg-white rounded-2xl flex flex-col w-full max-w-2xl max-h-[85vh] shadow-2xl m-4 overflow-hidden">
                <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h3 class="text-xl font-bold text-gray-900">{{ $t('classroom.add_student_modal_title') }}</h3>
                    <button @click="closeAddStudentModal" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto p-6 space-y-5">
                    <p class="text-sm text-gray-500">{{ $t('classroom.add_student_modal_hint') }}</p>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2">{{ $t('classroom.add_student_search')
                        }}</label>
                        <input v-model="makeupSearch" type="text"
                            :placeholder="$t('classroom.add_student_search_placeholder')"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none" />
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2">{{ $t('classroom.add_student_student')
                        }}</label>
                        <BaseDropdown v-model="selectedMakeupStudentId" :options="makeupStudentOptions"
                            :placeholder="$t('classroom.add_student_select_student_placeholder')" theme="emerald"
                            @change="handleMakeupStudentChange" :disabled="isAddingStudent" />
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2">{{ $t('classroom.add_student_course')
                        }}</label>
                        <BaseDropdown v-model="selectedMakeupEnrollmentId" :options="makeupEnrollmentOptions"
                            :placeholder="$t('classroom.add_student_select_course_placeholder')" theme="emerald"
                            :disabled="isAddingStudent || !selectedMakeupStudentId" />
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2">{{
                            $t('classroom.add_student_join_date') }}</label>
                        <input type="date" v-model="makeupJoinDate"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none" />
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

        <CopyTemplateEditorModal v-model="showAttendanceTemplateModal" :title="$t('classroom.copy_template_title')"
            :hint="$t('classroom.copy_template_hint')" :variable-title="$t('classroom.copy_template_variables')"
            :content-title="$t('classroom.copy_template_content')"
            :preview-title="$t('classroom.copy_template_preview_title')"
            :preview-hint="$t('classroom.copy_template_preview_hint')"
            :preview-empty="$t('classroom.copy_template_preview_empty')" :template-text="attendanceTemplateText"
            :preview-text="attendanceTemplatePreviewText" :variable-count="attendanceTemplateVariables.length"
            :is-loading="isLoadingAttendanceTemplate" :loading-text="$t('classroom.copy_template_loading')"
            :loading-hint="$t('classroom.copy_template_loading_hint')" :save-loading="isSavingAttendanceTemplate"
            :cancel-text="$t('common.cancel')" :save-text="$t('common.save')" :saving-text="$t('common.saving')"
            @update:template-text="attendanceTemplateText = $event" @save="saveAttendanceTemplate">
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
                            <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1">
                                {{ $t('classroom.copy_template_load_from') }}
                            </label>
                            <BaseDropdown v-model="selectedAttendanceTemplateLoadKey"
                                :options="attendanceTemplateLoadOptionsDropdown"
                                :placeholder="$t('classroom.copy_template_load_from')" theme="amber" />
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
                            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                {{ $t('classroom.copy_template_variable_mode_label') }}
                            </label>
                            <BaseDropdown v-model="selectedAttendanceTemplateModes[variable.key]"
                                :options="variable.modeOptions" theme="gray" />
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
                            <div v-for="st in sessionTeachers.filter(st => {
                                if (!todayOccurrence) return false;
                                const ds = DateUtils.formatLocalDate(todayOccurrence.occurrenceDate);
                                return ds >= st.effective_from && (!st.effective_to || ds <= st.effective_to);
                            })" :key="st.id + st.effective_from"
                                class="flex items-center justify-between p-3 rounded-xl bg-white border border-emerald-100 shadow-sm">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs">
                                        {{ st.name.charAt(0) }}
                                    </div>
                                    <div>
                                        <div class="text-sm font-black text-gray-900">{{ st.name }}</div>
                                        <div class="text-[10px] font-bold text-gray-400">
                                            {{ st.effective_to ? `${st.effective_from} ~ ${st.effective_to}` :
                                                `${st.effective_from} ~ ${$t('classroom.default_teacher')}` }}
                                        </div>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1">
                                    <router-link to="/dashboard/teachers"
                                        class="p-2 text-gray-300 hover:text-emerald-500 transition-colors"
                                        :title="$t('common.profile')">
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
                            <div v-if="!sessionTeachers.some(st => {
                                if (!todayOccurrence) return false;
                                const ds = DateUtils.formatLocalDate(todayOccurrence.occurrenceDate);
                                return ds >= st.effective_from && (!st.effective_to || ds <= st.effective_to);
                            })" class="text-center py-4 text-xs font-bold text-gray-400 italic">
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
                                class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2" />
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
