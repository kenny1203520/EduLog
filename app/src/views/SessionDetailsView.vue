<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { EnrollmentService } from '@/services/EnrollmentService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import type { Enrollment } from '@/models/Enrollment'
import type { Lesson } from '@/models/Course'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import type { OccurrenceReport } from '@/models/OccurrenceReport'
import { DateUtils } from '@/utils/DateUtils'

import ReportEditor from '@/components/ReportEditor.vue'
import OccurrenceCalendar from '@/components/OccurrenceCalendar.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

type ReportEditorExpose = {
    saveNow: () => Promise<void>
}

const { t } = useI18n()
const toast = useToast()

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const sessionOccurrences = ref<ClassOccurrence[]>([])
const weekAnchorDate = ref(new Date())
const isCalendarExpanded = ref(false)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving
const selectedEnrollmentIds = ref<Set<string>>(new Set())
const isQuickAttendanceExpanded = ref(false)
const showAddStudentModal = ref(false)
const isAddingStudent = ref(false)
const makeupCandidates = ref<Enrollment[]>([])
const makeupSearch = ref('')
const selectedMakeupStudentId = ref<string>('')
const selectedMakeupEnrollmentId = ref<string>('')
const makeupJoinDate = ref(DateUtils.formatLocalDate(new Date()))

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

    return CourseService.getLessonsByCourse(courseId).then(lessons => {
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

function getNextClassDate(today: Date, classDayOfWeek?: number): Date {
    if (classDayOfWeek === undefined) {
        const defaultNextDay = new Date(today)
        defaultNextDay.setDate(defaultNextDay.getDate() + 1)
        defaultNextDay.setHours(0, 0, 0, 0)
        return defaultNextDay
    }

    const normalizedToday = new Date(today)
    normalizedToday.setHours(0, 0, 0, 0)

    const diff = (classDayOfWeek - normalizedToday.getDay() + 7) % 7
    const daysUntilNextClass = diff === 0 ? 7 : diff
    const nextClassDate = new Date(normalizedToday)
    nextClassDate.setDate(nextClassDate.getDate() + daysUntilNextClass)
    return nextClassDate
}

function isInCurrentCycle(report: OccurrenceReport, classDayOfWeek?: number): boolean {
    const reportDate = getReportDate(report)
    if (!reportDate) {
        return false
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const nextClassDate = getNextClassDate(today, classDayOfWeek)

    return reportDate >= today && reportDate < nextClassDate
}

function pickHighestProgressReport(
    reportsAtHighestLesson: OccurrenceReport[]
): OccurrenceReport | undefined {
    if (reportsAtHighestLesson.length === 0) {
        return undefined
    }

    return [...reportsAtHighestLesson].sort((left, right) => {
        const completedDiff = Number(right.isCompleted === true) - Number(left.isCompleted === true)
        if (completedDiff !== 0) {
            return completedDiff
        }

        return getReportTimestamp(right) - getReportTimestamp(left)
    })[0]
}

function buildStudentProgressSummary(enrollment: Enrollment, reports: OccurrenceReport[], lessons: Lesson[]): StudentProgressSummary {
    const currentCourse = enrollment.displayName || enrollment.courseDisplayName || [enrollment.courseSubject, enrollment.courseStage].filter(Boolean).join(' ')
    const lessonSequenceById = new Map(
        lessons
            .filter(lesson => !!lesson.id)
            .map(lesson => [lesson.id as string, lesson.sequence])
    )

    const reportsWithLesson = reports.filter(report => {
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

    const reportsByOccurrenceDate = [...reports].sort((left, right) => getReportTimestamp(right) - getReportTimestamp(left))
    const latestReport = reportsByOccurrenceDate.find(report => !isInCurrentCycle(report, enrollment.classSessionDayOfWeek)) || reportsByOccurrenceDate[0]
    const latestLesson = latestReport?.lessonId ? lessons.find(lesson => lesson.id === latestReport.lessonId) : undefined

    return {
        currentCourse: currentCourse || t('classroom.progress_no_record'),
        highestProgressTitle: formatLessonHeading(highestLessonNumber, highestLesson),
        highestProgressStatus: formatProgressRange(highestReport),
        highestProgressTone: getProgressTone(highestReport),
        latestProgressTitle: formatLessonHeading(latestLesson?.sequence, getLessonTitle(lessons, undefined, latestReport?.lessonId)),
        latestProgressStatus: formatProgressRange(latestReport),
        latestProgressTone: getProgressTone(latestReport)
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

async function loadStudentProgressSummaries(enrollmentList: Enrollment[]) {
    const uniqueCourseIds = [...new Set(enrollmentList.map(enrollment => enrollment.courseId).filter(Boolean))]
    await Promise.all(uniqueCourseIds.map(courseId => getLessonsForCourse(courseId)))

    const summaryEntries = await Promise.all(enrollmentList.map(async enrollment => {
        if (!enrollment.id) {
            return [enrollment.id, getDefaultProgressSummary()] as const
        }

        const lessons = await getLessonsForCourse(enrollment.courseId)
        const reports = await OccurrenceReportService.getAllReportsByEnrollment(enrollment.id)
        return [enrollment.id, buildStudentProgressSummary(enrollment, reports, lessons)] as const
    }))

    studentProgressSummaries.value = Object.fromEntries(summaryEntries.filter(([id]) => !!id)) as Record<string, StudentProgressSummary>
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

    return new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString()
})

const weekRangeLabel = computed(() => {
    const start = new Date(weekAnchorDate.value)
    start.setDate(start.getDate() - 3)

    const end = new Date(weekAnchorDate.value)
    end.setDate(end.getDate() + 3)

    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
})

function normalizeDateInput(value: string | Date | undefined): string {
    if (!value) {
        return DateUtils.formatLocalDate(new Date())
    }

    if (value instanceof Date) {
        return DateUtils.formatLocalDate(value)
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return DateUtils.formatLocalDate(new Date())
    }

    return DateUtils.formatLocalDate(parsed)
}

const filteredMakeupStudents = computed(() => {
    const studentMap = new Map<string, { studentId: string; studentName: string; studentEmail?: string }>()

    makeupCandidates.value.forEach(item => {
        if (!item.studentId || !item.studentName) {
            return
        }
        if (!studentMap.has(item.studentId)) {
            studentMap.set(item.studentId, {
                studentId: item.studentId,
                studentName: item.studentName,
                studentEmail: item.studentEmail
            })
        }
    })

    const students = [...studentMap.values()]
    const keyword = makeupSearch.value.trim().toLowerCase()

    if (!keyword) {
        return students
    }

    return students.filter(student => {
        return [student.studentName, student.studentEmail]
            .filter(Boolean)
            .some(text => text!.toLowerCase().includes(keyword))
    })
})

const selectedStudentEnrollments = computed(() => {
    if (!selectedMakeupStudentId.value) {
        return []
    }

    return makeupCandidates.value.filter(item => item.studentId === selectedMakeupStudentId.value)
})

const selectedMakeupEnrollment = computed(() => {
    return makeupCandidates.value.find(item => item.id === selectedMakeupEnrollmentId.value) || null
})

function handleMakeupStudentChange() {
    selectedMakeupEnrollmentId.value = ''
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
    rangeStart.setDate(rangeStart.getDate() - 42)

    const rangeEnd = new Date(anchorDate)
    rangeEnd.setDate(rangeEnd.getDate() + 42)

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

        guests.forEach(guest => {
            if (guest) {
                ; (guest as any).isGuest = true
                if (!enrollments.value.find(e => e.id === guest.id)) {
                    enrollments.value.push(guest)
                }
            }
        })
    }

    for (const enr of enrollments.value) {
        if (enr.id && !reportMap.value.has(enr.id)) {
            reportMap.value.set(enr.id, null)
        }
    }
}

async function setCurrentOccurrence(occurrence: ClassOccurrence | null) {
    todayOccurrence.value = occurrence

    if (occurrence?.occurrenceDate) {
        weekAnchorDate.value = new Date(occurrence.occurrenceDate)
    }

    await loadReportsForCurrentOccurrence()
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
    const today = new Date()
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

        // 1. Get session details
        session.value = await CourseService.getSessionDetails(sessionId)

        // 2. Get all students enrolled in this session
        const { data: allEnrollments } = await CourseService.getEnrollmentsBySession(sessionId)
        enrollments.value = allEnrollments

        // 2.5 Load lessons for each course and build student progress summaries
        await loadStudentProgressSummaries(allEnrollments)

        if (allEnrollments.length > 0 && allEnrollments[0]?.courseId) {
            courseLessons.value = courseLessonsByCourseId.value[allEnrollments[0].courseId] || []
        }

        // 3. Find or Create Today's Occurrence
        const today = new Date()
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

function navigateToProfile(studentId: string) {
    router.push({ name: 'student-profile', params: { id: studentId } })
}

function navigateToReports(enrollmentId: string) {
    router.push({ name: 'lesson-reports', params: { enrollmentId } })
}

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

async function copyAttendanceInfo() {
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

    const text = `${t('classroom.class_info_title')}\n` +
        `${session.value.name} (${date} ${time})\n\n` +
        `${t('classroom.present_list')}: ${presentList}\n` +
        `${t('classroom.absent_list')}: ${absentList}\n` +
        `${t('classroom.pending_list')}: ${pendingList}`

    try {
        await navigator.clipboard.writeText(text)
        toast.success(t('classroom.copy_success'))
    } catch (err) {
        console.error('Failed to copy: ', err)
        toast.error('Failed to copy to clipboard')
    }
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

async function toggleClassStatus(event: any) {
    if (!todayOccurrence.value) return
    const isHeld = event.target.checked

    try {
        const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
            is_conducted: isHeld
        })
        todayOccurrence.value.isConducted = updated.isConducted
    } catch (e) {
        console.error('Failed to update class status:', e)
        event.target.checked = !isHeld
    }
}

async function toggleSplitView(enrollmentId: string) {
    await quickReportEditorRef.value?.saveNow()

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
    await quickReportEditorRef.value?.saveNow()
    showSplitView.value = false
    selectedEnrollmentId.value = null
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

    if (selected.status !== 'active' && normalizedJoinDate >= DateUtils.formatLocalDate(new Date())) {
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

function handleSaveError(error: string) {
    toast.error(`Failed to save report: ${error}`)
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
</script>

<template>
    <div class="space-y-8 animate-in fade-in duration-500">
        <!-- Header -->
        <div class="flex items-center gap-4">
            <button @click="router.back()"
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

                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" :checked="todayOccurrence.isConducted"
                                    @change="toggleClassStatus($event)" class="sr-only peer">
                                <div
                                    class="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                                </div>
                            </label>
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
                                            :class="e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-200'">
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
                                    <button @click.stop="navigateToReports(e.id!)"
                                        class="flex items-center justify-center gap-2 p-3 rounded-2xl bg-emerald-600 text-white border border-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span class="text-xs font-black tracking-wide">{{ $t('common.reports') }}</span>
                                    </button>

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

                                <button @click.stop="navigateToProfile(e.studentId)"
                                    class="w-full flex items-center justify-center gap-2 p-3 rounded-2xl bg-gray-50 text-gray-500 border border-gray-100 active:scale-95 transition-all">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    <span class="text-xs font-bold">{{ $t('common.profile') }}</span>
                                </button>
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
                                                :class="e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-200'">
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
                                            <button @click="navigateToReports(e.id!)"
                                                class="p-2.5 xl:p-3 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-90"
                                                :title="$t('classroom.view_reports')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                </svg>
                                            </button>
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
                                            <button @click="navigateToProfile(e.studentId)"
                                                class="p-2.5 xl:p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-100 transition-all active:scale-90"
                                                :title="$t('classroom.view_profile')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="2"
                                                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                                </svg>
                                            </button>
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
                                class="h-full border-none shadow-none rounded-none" />

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
                        <select v-model="selectedMakeupStudentId" @change="handleMakeupStudentChange"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                            :disabled="isAddingStudent">
                            <option value="">{{ $t('classroom.add_student_select_student_placeholder') }}</option>
                            <option v-for="student in filteredMakeupStudents" :key="student.studentId"
                                :value="student.studentId">
                                {{ student.studentName }}{{ student.studentEmail ? ` (${student.studentEmail})` : '' }}
                            </option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-sm font-bold text-gray-700 mb-2">{{ $t('classroom.add_student_course')
                        }}</label>
                        <select v-model="selectedMakeupEnrollmentId"
                            class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                            :disabled="isAddingStudent || !selectedMakeupStudentId">
                            <option value="">{{ $t('classroom.add_student_select_course_placeholder') }}</option>
                            <option v-for="candidate in selectedStudentEnrollments" :key="candidate.id"
                                :value="candidate.id">
                                {{ candidate.courseDisplayName || `${candidate.courseSubject} ${candidate.courseStage}`
                                }}
                                {{ candidate.classSessionName ? ` · ${candidate.classSessionName}` : '' }}
                            </option>
                            <option v-if="selectedMakeupStudentId && selectedStudentEnrollments.length === 0" disabled>
                                {{ $t('classroom.add_student_no_active_courses') }}
                            </option>
                        </select>
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
