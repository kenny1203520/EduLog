import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { TeacherService } from '@/services/teacher/TeacherService'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'
import type { TeacherOverviewDTO } from '@/services/api/PageApiService'
import { useFeedback } from '@/composables/useFeedback'
import { useAuthStore } from '@/stores/useAuthStore'
import { getEffectiveTeacherAssignments } from '@/utils/effectiveTeacherAssignments'
import { DateUtils } from '@/utils/dateUtils'
import { HolidayQueryService } from '@/services/holiday/HolidayQueryService'
import { OccurrenceCommandService } from '@/services/occurrence/OccurrenceCommandService'

export type OccurrenceTeacher = TeacherOverviewDTO & { role?: SessionTeacherAssignmentDTO['role'] }

export interface TeacherAttendanceRow {
    teacher: OccurrenceTeacher
    onLeave: boolean
    present: boolean
    pending?: boolean
    canEdit: boolean
}

/** Assignments whose effective window contains `date` (YYYY-MM-DD). */
export function teachersEffectiveOn(assignments: SessionTeacherAssignmentDTO[], date: string): SessionTeacherAssignmentDTO[] {
    return assignments.filter(teacher =>
        date >= teacher.effective_from && (!teacher.effective_to || date <= teacher.effective_to)
    )
}

export function filterTeachersByName<T extends { name: string }>(teachers: T[], query: string): T[] {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return teachers
    return teachers.filter(teacher => teacher.name.toLowerCase().includes(normalized))
}

interface OccurrenceTeachersSource {
    sessionId: string
    session: Ref<any>
    todayOccurrence: Ref<any>
    isOccurrenceInHoliday: Ref<boolean>
}

/** Teacher assignments, leave and attendance for the selected occurrence, plus the one-day assignment modal. */
export function useOccurrenceTeachers(source: OccurrenceTeachersSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const auth = useAuthStore()
    const { sessionId, session, todayOccurrence, isOccurrenceInHoliday } = source

    const sessionTeachers = ref<SessionTeacherAssignmentDTO[]>([])
    const canManageTeacherAttendance = ref(false)
    const teacherRosterFailed = ref(false)
    const teacherLeaveFailed = ref(false)
    let rosterRequest = 0
    const teacherLeaveById = ref<Record<string, boolean>>({})
    const occurrenceTeachers = ref<OccurrenceTeacher[]>([])
    const allTeachersList = ref<TeacherOverviewDTO[]>([])
    const showTeacherEditModal = ref(false)
    const teacherSearchQuery = ref('')
    const selectedTeacherIds = ref<Set<string>>(new Set())
    const isSavingTeachers = ref(false)

    const currentSessionTeachers = computed(() => {
        const occurrence = todayOccurrence.value
        if (!occurrence?.occurrenceDate) return []
        return teachersEffectiveOn(sessionTeachers.value, DateUtils.formatLocalDate(occurrence.occurrenceDate))
    })

    const filteredTeachers = computed(() => filterTeachersByName(allTeachersList.value, teacherSearchQuery.value))

    function isTeacherOnLeave(teacherId?: string): boolean {
        return Boolean(teacherId && teacherLeaveById.value[teacherId])
    }

    function attendanceValue(teacherId?: string, userId?: string | null): boolean | undefined {
        if (!teacherId) return undefined
        const values = todayOccurrence.value?.teacherAttendance ?? {}
        return values[teacherId] ?? (userId ? values[userId] : undefined)
    }

    function isTeacherPresent(teacherId?: string, userId?: string | null): boolean {
        return attendanceValue(teacherId, userId) === true
    }

    function canEditTeacherAttendance(teacher: TeacherOverviewDTO): boolean {
        return auth.user?.id === teacher.user_id || canManageTeacherAttendance.value
    }

    const teacherAttendanceCounts = computed(() => {
        let present = 0
        let absent = 0
        let onLeave = 0
        let pending = 0
        for (const teacher of occurrenceTeachers.value) {
            if (teacher.id && teacherLeaveById.value[teacher.id]) onLeave++
            else if (isTeacherPresent(teacher.id, teacher.user_id)) present++
            else if (attendanceValue(teacher.id, teacher.user_id) === false) absent++
            else pending++
        }
        return { present, absent, onLeave, ...(pending ? { pending } : {}) }
    })

    const teacherAttendanceRows = computed<TeacherAttendanceRow[]>(() => occurrenceTeachers.value.map(teacher => ({
        teacher,
        onLeave: isTeacherOnLeave(teacher.id),
        present: isTeacherPresent(teacher.id, teacher.user_id),
        canEdit: canEditTeacherAttendance(teacher),
        pending: attendanceValue(teacher.id, teacher.user_id) === undefined,
    })))

    function clearOccurrenceTeachers() {
        occurrenceTeachers.value = []
        teacherLeaveById.value = {}
        selectedTeacherIds.value = new Set()
    }

    async function loadOccurrenceTeachers() {
        if (!todayOccurrence.value) {
            clearOccurrenceTeachers()
            return
        }
        const request = ++rosterRequest
        const occurrence = todayOccurrence.value
        const dateStr = DateUtils.formatLocalDate(occurrence.occurrenceDate)
        teacherRosterFailed.value = false
        teacherLeaveFailed.value = false
        try {
            const assignments = await TeacherService.getSessionTeachers(sessionId, dateStr)
            if (request !== rosterRequest || todayOccurrence.value?.id !== occurrence.id) return
            sessionTeachers.value = assignments
        } catch {
            if (request === rosterRequest && todayOccurrence.value?.id === occurrence.id) {
                clearOccurrenceTeachers()
                teacherRosterFailed.value = true
            }
            return
        }
        const assignmentsByTeacher = getEffectiveTeacherAssignments(sessionTeachers.value, dateStr)
        selectedTeacherIds.value = new Set(assignmentsByTeacher.flatMap(assignment => assignment.id ? [assignment.id] : []))
        occurrenceTeachers.value = assignmentsByTeacher
        teacherLeaveById.value = {}
        const leaveResults = await Promise.allSettled(assignmentsByTeacher
            .filter(assignment => assignment.id)
            .map(async assignment => [assignment.id!, await HolidayQueryService.isTeacherOnLeave(
                dateStr,
                assignment.id!,
                session.value?.classroom_id,
                sessionId
            )] as const))
        if (request !== rosterRequest || todayOccurrence.value?.id !== occurrence.id) return
        teacherLeaveFailed.value = leaveResults.some(result => result.status === 'rejected')
        teacherLeaveById.value = Object.fromEntries(leaveResults.flatMap(result =>
            result.status === 'fulfilled' ? [result.value] : []
        ))
    }

    async function toggleTeacherAttendance(teacherId: string | undefined, isPresent: boolean) {
        if (!todayOccurrence.value || !teacherId) return
        const occurrenceId = todayOccurrence.value.id

        // Guard: check if occurrence is in a holiday period
        if (isOccurrenceInHoliday.value && isPresent) {
            errorKey('report.error.cannot_set_teacher_present_during_holiday')
            return
        }

        try {
            const updated = await OccurrenceCommandService.updateOccurrence(occurrenceId, {
                teacher_attendance: { [teacherId]: isPresent }
            })
            if (todayOccurrence.value?.id === occurrenceId) {
                todayOccurrence.value.teacherAttendance = {
                    ...todayOccurrence.value.teacherAttendance,
                    [teacherId]: updated.teacherAttendance?.[teacherId] ?? isPresent,
                }
            }
        } catch (e: any) {
            console.error('Failed to update teacher attendance:', e)
            if (e.code === 'TEACHER_ON_LEAVE') {
                errorKey('report.error.cannot_set_teacher_present_during_leave')
            } else if (e.code === 'HOLIDAY_OCCURRENCE') {
                errorKey('report.error.cannot_set_teacher_present_during_holiday')
            } else {
                errorKey('common.save_error')
            }
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
            await loadOccurrenceTeachers()

            toast.success(t('common.save_success'))
        } catch (e) {
            console.error('Failed to remove assignment:', e)
            reportError(e, 'common.save_error')
        } finally {
            isSavingTeachers.value = false
        }
    }

    return {
        sessionTeachers,
        teacherRosterFailed,
        teacherLeaveFailed,
        canManageTeacherAttendance,
        allTeachersList,
        occurrenceTeachers,
        currentSessionTeachers,
        filteredTeachers,
        teacherAttendanceCounts,
        teacherAttendanceRows,
        showTeacherEditModal,
        teacherSearchQuery,
        isTeacherOnLeave,
        isTeacherPresent,
        canEditTeacherAttendance,
        clearOccurrenceTeachers,
        loadOccurrenceTeachers,
        toggleTeacherAttendance,
        openTeacherEditModal,
        addTeacherForToday,
        removeAssignment,
    }
}
