import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { PageApiService } from '@/services/api/PageApiService'
import { SessionService } from '@/services/session/SessionService'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'
import { TeacherService } from '@/services/teacher/TeacherService'
import { parseClassSessionDate } from '@/services/session/ClassSessionInvalidation'
import { shouldApplyCommittedReport } from '@/services/report/CommittedReportState'
import type { OccurrenceLessonTransfer } from '@/services/enrollment/EnrollmentTransferQueryService'
import { useFeedback } from '@/composables/useFeedback'
import { useAuthStore } from '@/stores/useAuthStore'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { ClassSessionFactory } from '@/models/ClassSession'
import { Enrollment } from '@/models/Enrollment'
import { countRosterAttendance, getRosterEnrollments } from '@/models/RosterFilter'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '@/models/OccurrenceReport'
import type { QuickAttendanceStatus } from '@/components/classroom/QuickAttendancePanel.vue'
import type { StudentRosterItem } from '@/components/classroom/StudentRosterPanel.vue'
import { absenceReasonLabel } from '@/utils/absenceReason'
import { DateUtils } from '@/utils/dateUtils'
import { useSessionCalendar } from './useSessionCalendar'
import { useStudentProgress } from './useStudentProgress'
import { useOccurrenceTeachers } from './useOccurrenceTeachers'
import { useSessionReportEditor, type ReportEditorExpose } from './useSessionReportEditor'
import { useSessionRealtime, type RealtimeRefreshOptions } from './useSessionRealtime'
import { EnrollmentCommandService } from '@/services/enrollment/EnrollmentCommandService'
import { EnrollmentTransferQueryService } from '@/services/enrollment/EnrollmentTransferQueryService'
import { HolidayQueryService } from '@/services/holiday/HolidayQueryService'
import { OccurrenceCommandService } from '@/services/occurrence/OccurrenceCommandService'
import { OccurrenceQueryService } from '@/services/occurrence/OccurrenceQueryService'
import { OccurrenceSyncService } from '@/services/occurrence/OccurrenceSyncService'
import { ReportCommandService } from '@/services/report/ReportCommandService'
import { ReportQueryService } from '@/services/report/ReportQueryService'

export function isReportAuthorizationError(error: any): boolean {
    const code = error?.code
    const status = error?.status || error?.statusCode
    const message = typeof error?.message === 'string' ? error.message : ''
    return code === '42501' || status === 401 || status === 403 || /row-level security|permission denied/i.test(message)
}

/** Flattens the workspace session row into the shape the page renders. */
function normalizeWorkspaceSession(rawSession: any, fallback?: any) {
    return {
        ...(fallback ?? {}),
        ...rawSession,
        schedule_rules: rawSession.schedule_rules ?? rawSession.class_session_schedule_rules ?? [],
        classroom_name: rawSession.classrooms?.name ?? (fallback ? fallback.classroom_name : 'Unknown'),
        classroom_address: rawSession.classrooms?.address ?? (fallback ? fallback.classroom_address : ''),
        classroom_external_link: rawSession.classrooms?.external_link ?? (fallback ? fallback.classroom_external_link : ''),
    }
}

/**
 * The class-session page: the selected teaching day, its roster and reports,
 * attendance, and the background refreshes that keep them current.
 */
export function useSessionWorkspace(quickReportEditorRef: Readonly<Ref<ReportEditorExpose | null>>) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const preferences = usePreferencesStore()
    const route = useRoute()
    const router = useRouter()
    const auth = useAuthStore()

    const sessionId = route.params.id as string
    const session = ref<any>(null)
    const sessionTimeZone = computed(() => DateUtils.isValidTimeZone(session.value?.time_zone) ? session.value.time_zone : preferences.timeZone)
    const todayOccurrence = ref<any>(null)
    const selectedDateKey = ref<string | null>(parseClassSessionDate(route.query.date) || null)
    const weekAnchorDate = ref(DateUtils.todayDate(preferences.timeZone))
    const isCalendarExpanded = ref(false)
    const isOccurrenceInHoliday = ref(false)
    const enrollments = ref<Enrollment[]>([])
    const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
    const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving
    const selectedEnrollmentIds = ref<Set<string>>(new Set())
    const isQuickAttendanceExpanded = ref(true)
    const isOccurrenceLoading = ref(false)
    const occurrenceLoadError = ref<string | null>(null)
    const previousOccurrence = ref<ClassOccurrence | null>(null)
    const nextOccurrence = ref<ClassOccurrence | null>(null)
    const loading = ref(true)
    const isRefreshing = ref(false)
    const showRefreshConfirm = ref(false)
    const studentSearchQuery = ref('')
    const studentAttendanceFilter = ref<'all' | 'present' | 'absent' | 'pending'>('all')
    const showKodingCheckModal = ref(false)
    const kodingTargetEnrollment = ref<Enrollment | null>(null)
    const kodingInitialLessonId = ref<string | null>(null)
    let occurrenceLoadToken = 0
    let reportLoadRequest = 0
    let reportProvisionRequests = new Map<string, Promise<OccurrenceReport[]>>()
    let workspaceRosterDate: string | null = null
    let realtimeRefreshRequest = 0
    let selectedDateRequest = 0
    let hasLoadedInitialData = false

    const calendar = useSessionCalendar({ sessionId, selectedDateKey, reportError })
    const { findOccurrenceByDate, loadSessionOccurrences } = calendar
    const progress = useStudentProgress({ todayOccurrence, selectedDateKey, enrollments, reportMap })
    const {
        getLessonsForCourse,
        loadStudentProgressSummaries,
        loadStudentProgressGaps,
        progressGapCheckFailed,
    } = progress
    const teachers = useOccurrenceTeachers({ sessionId, session, todayOccurrence, isOccurrenceInHoliday })
    const { sessionTeachers, loadOccurrenceTeachers } = teachers

    // Keep complete roster metrics separate from the workflow filter.
    const rosterLists = computed(() => getRosterEnrollments(
        enrollments.value,
        reportMap.value,
        studentSearchQuery.value,
        studentAttendanceFilter.value
    ))
    const allRosterEnrollments = computed(() => rosterLists.value.all)
    const filteredEnrollments = computed(() => rosterLists.value.filtered)

    const editor = useSessionReportEditor({
        todayOccurrence,
        selectedDateKey,
        enrollments,
        rosterEnrollments: allRosterEnrollments,
        reportMap,
        quickReportEditorRef,
        savingMap,
        getLessonsForCourse,
        onProgressChanged: (enrollmentId, occurrence) => void refreshStudentProgressAfterSave(enrollmentId, occurrence),
    })
    const {
        showSplitView,
        selectedEnrollmentId,
        courseLessons,
        selectedEditorEnrollmentSnapshot,
        selectedEditorEnrollment,
    } = editor

    const realtime = useSessionRealtime({
        sessionId,
        userId: () => auth.user?.id,
        selectedDate: () => selectedDateKey.value || DateUtils.todayString(sessionTimeZone.value),
        refresh: refreshCurrentOccurrenceFromRealtime,
    })
    const { isRealtimeRefreshing, realtimeRefreshError, lastRealtimeUpdateAt } = realtime

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
            session.value = normalizeWorkspaceSession(workspace.session, session.value)
        }
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
                progress.clearStudentProgress()
                isOccurrenceInHoliday.value = false
                teachers.clearOccurrenceTeachers()
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
            editor.resetEditorSelection()
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

    async function loadData() {
        try {
            loading.value = true
            occurrenceLoadError.value = null
            reportMap.value = new Map()
            progress.studentProgressSummaries.value = {}

            const workspace = (await PageApiService.getClassSessionWorkspace(sessionId)).data
            const rawSession = workspace.session as any
            session.value = normalizeWorkspaceSession(rawSession)
            const allEnrollments = workspace.enrollments.map(enrollment => new Enrollment(enrollment))
            enrollments.value = allEnrollments
            workspaceRosterDate = typeof rawSession.roster_date === 'string' ? rawSession.roster_date : null
            const [teacherAssignments, canManageAttendance] = await Promise.all([
                TeacherService.getSessionTeachers(sessionId),
                PermissionPolicyService.canUpdateOccurrence(sessionId)
            ])
            sessionTeachers.value = teacherAssignments
            teachers.canManageTeacherAttendance.value = canManageAttendance
            teachers.allTeachersList.value = workspace.teachers

            if (allEnrollments[0]?.courseId) courseLessons.value = progress.cachedLessonsFor(allEnrollments[0].courseId)

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

    async function refreshCurrentOccurrenceFromRealtime(options: RealtimeRefreshOptions = {}) {
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
                    courseLessons.value = progress.cachedLessonsFor(selectedEditorEnrollment.value.courseId)
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
                progress.clearStudentProgress()
            }

            if (requestId !== realtimeRefreshRequest) return
            lastRealtimeUpdateAt.value = new Date()
        } catch (error) {
            if (requestId !== realtimeRefreshRequest) return
            console.error('Failed to refresh class session after a remote change:', error)
            realtimeRefreshError.value = true
        } finally {
            if (requestId === realtimeRefreshRequest) isRealtimeRefreshing.value = false
        }
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

    /** Reloads the displayed day after a make-up student was added to `date`. */
    async function refreshRosterForDate(date: string) {
        const displayDate = DateUtils.parseLocalDate(date)
        if (!displayDate) return
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

    onMounted(async () => {
        await loadData()
        realtime.startClassSessionRealtime()
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
        progressGaps: progress.studentProgressGaps.value[enrollment.id!] || []
    })))

    const studentRosterItems = computed<StudentRosterItem[]>(() => filteredEnrollments.value.map(enrollment => {
        const summary = progress.getStudentProgressSummary(enrollment.id)
        const today = progress.getTodayCourseSummary(enrollment)
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
            currentCourse: summary.currentCourse,
            enrollmentStatus: t('student.internal_courses.status_' + enrollment.status),
            enrollmentTone: enrollment.status === 'regular' ? 'regular' : enrollment.status === 'trial' ? 'trial' : 'inactive',
            isGuest: Boolean((enrollment as any).isGuest),
            transferInLabel: transferInLabels.value.get(enrollment.id!) ?? null,
            classTransferInLabel: calendar.classTransferInIds.value.has(enrollment.id!) ? t('classroom.lesson_transfer.class_transferred_in') : null,
            attendanceStatus,
            attendanceLabel: t('attendance.' + attendanceStatus),
            absenceReason,
            absenceReasonLabel: absenceReasonText,
            isSavingAttendance: savingMap.value.get(enrollment.id!) === true,
            todayTitle: today.title,
            todayProgress: today.chapterProgress,
            todayCompletion: today.completionStatus,
            todayTone: today.tone,
            highestTitle: summary.highestProgressTitle,
            highestStatus: summary.highestProgressStatus,
            highestTone: summary.highestProgressTone,
            latestTitle: summary.latestProgressTitle,
            latestStatus: summary.latestProgressStatus,
            latestTone: summary.latestProgressTone,
            isEditing: selectedEnrollmentId.value === enrollment.id && showSplitView.value,
            reportAvailable: reportMap.value.has(enrollment.id!),
            progressGaps: progress.studentProgressGaps.value[enrollment.id!] || []
        }
    }))

    function openStudentKodingCheck(enrollmentId: string) {
        const enrollment = enrollments.value.find(item => item.id === enrollmentId)
        if (!enrollment) return
        kodingTargetEnrollment.value = enrollment
        kodingInitialLessonId.value = reportMap.value.get(enrollment.id!)?.lessonId || null
        showKodingCheckModal.value = true
    }

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

    return {
        ...calendar,
        ...progress,
        ...teachers,
        ...editor,
        ...realtime,
        sessionId,
        session,
        todayOccurrence,
        selectedDateKey,
        isCalendarExpanded,
        isOccurrenceInHoliday,
        reportMap,
        savingMap,
        selectedEnrollmentIds,
        isQuickAttendanceExpanded,
        isOccurrenceLoading,
        occurrenceLoadError,
        previousOccurrence,
        nextOccurrence,
        loading,
        isRefreshing,
        showRefreshConfirm,
        studentSearchQuery,
        studentAttendanceFilter,
        showKodingCheckModal,
        kodingTargetEnrollment,
        kodingInitialLessonId,
        displayedOccurrenceDate,
        occurrenceNavigationLabel,
        calendarToday,
        sessionTimeLabel,
        isPlannedClassDate,
        pendingTransferCancel,
        cancellingTransferId,
        transferredOutStudents,
        openTransferTarget,
        confirmTransferCancel,
        handleCalendarDateSelect,
        moveOccurrence,
        goToToday,
        toggleCalendarPanel,
        allRosterEnrollments,
        filteredEnrollments,
        highlightedEnrollmentId,
        hasActiveStudentFilters,
        clearStudentFilters,
        focusRosterStudent,
        attendanceCounts,
        occupiedRosterCount,
        loadData,
        refreshRosterForDate,
        setAttendance,
        batchSetAttendance,
        toggleEnrollmentSelection,
        toggleSelectAll,
        quickAttendanceStudents,
        studentRosterItems,
        openStudentKodingCheck,
        requestRefreshSchedule,
        handleConfirmRefresh,
        toggleIsConducted,
    }
}
