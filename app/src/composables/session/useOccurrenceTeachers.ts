import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { HolidayService } from '@/services/holiday/HolidayService'
import { OccurrenceService } from '@/services/occurrence/OccurrenceService'
import { TeacherService } from '@/services/teacher/TeacherService'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'
import type { TeacherOverviewDTO } from '@/services/api/PageApiService'
import { isTeacherPresentForScope } from '@/services/report/TeacherAttendanceScope'
import { useFeedback } from '@/composables/useFeedback'
import { useAuthStore } from '@/stores/useAuthStore'
import { getEffectiveTeacherAssignments } from '@/utils/effectiveTeacherAssignments'
import { DateUtils } from '@/utils/dateUtils'

export type OccurrenceTeacher = TeacherOverviewDTO & { role?: SessionTeacherAssignmentDTO['role'] }

export interface TeacherAttendanceRow {
    teacher: OccurrenceTeacher
    onLeave: boolean
    present: boolean
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

    function isTeacherPresent(teacherId: string | undefined, userId: string | null | undefined): boolean {
        if (!teacherId || !todayOccurrence.value?.teacherAttendance) return false
        return isTeacherPresentForScope({
            teacherId,
            teacherUserId: userId,
            occurrenceTeacherIds: occurrenceTeachers.value.map(teacher => teacher.id).filter((id): id is string => Boolean(id)),
            teacherAttendance: todayOccurrence.value.teacherAttendance
        })
    }

    function canEditTeacherAttendance(teacher: TeacherOverviewDTO): boolean {
        return auth.user?.id === teacher.user_id || canManageTeacherAttendance.value
    }

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

    const teacherAttendanceRows = computed<TeacherAttendanceRow[]>(() => occurrenceTeachers.value.map(teacher => ({
        teacher,
        onLeave: isTeacherOnLeave(teacher.id),
        present: isTeacherPresent(teacher.id, teacher.user_id),
        canEdit: canEditTeacherAttendance(teacher),
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
            .map(async assignment => [assignment.id!, await HolidayService.isTeacherOnLeave(
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

            const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
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

    return {
        sessionTeachers,
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
