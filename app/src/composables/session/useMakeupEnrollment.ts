import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { Enrollment } from '@/models/Enrollment'
import { DateUtils } from '@/utils/dateUtils'
import { EnrollmentCommandService } from '@/services/enrollment/EnrollmentCommandService'
import { EnrollmentQueryService } from '@/services/enrollment/EnrollmentQueryService'

type Translate = (key: string) => string

/** Normalizes a date input (Date, YYYY-MM-DD or any parseable string) to YYYY-MM-DD, defaulting to today. */
export function normalizeDateInput(value: string | Date | undefined, timeZone: string): string {
    if (!value) {
        return DateUtils.todayString(timeZone)
    }

    if (value instanceof Date) {
        return DateUtils.formatLocalDate(value)
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value
    }

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return DateUtils.todayString(timeZone)
    }

    return DateUtils.formatLocalDate(parsed)
}

/** Student dropdown options: filtered by name, one option per student. */
export function buildMakeupStudentOptions(t: Translate, candidates: Enrollment[], search: string) {
    const query = search.toLowerCase().trim()
    let students = candidates

    if (query) {
        students = students.filter(s =>
            s.studentName?.toLowerCase().includes(query)
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
}

/** Maps a failed make-up submit to the inline message shown in the modal. */
export function makeupSubmitErrorKey(error: any): string {
    if (error?.message?.includes('Invalid date format')) return 'classroom.add_student_invalid_date'
    if (error?.message?.includes('DUPLICATE_OCCURRENCE_REPORT')) return 'classroom.add_student_duplicate_report'
    if (error?.message?.includes('MAKEUP_DATE_NOT_CLASS_DAY')) return 'classroom.add_student_not_class_day'
    return 'classroom.add_student_retry_error'
}

interface MakeupEnrollmentOptions {
    sessionId: string
    todayOccurrence: Ref<any>
    selectedDateKey: Ref<string | null>
    /** Reloads the displayed roster after a make-up report lands on the selected date. */
    refreshRosterForDate: (date: string) => Promise<void>
    /** Moves focus to the inline error once it is rendered. */
    focusSubmitError: () => void
}

/** The "add a make-up student to this class" modal. */
export function useMakeupEnrollment(options: MakeupEnrollmentOptions) {
    const { t } = useI18n()
    const toast = useToast()
    const { errorKey, reportError } = useFeedback()
    const preferences = usePreferencesStore()

    const showAddStudentModal = ref(false)
    const isAddingStudent = ref(false)
    const makeupSubmitError = ref('')
    const makeupCandidates = ref<Enrollment[]>([])
    const makeupSearch = ref('')
    const selectedMakeupStudentId = ref<string | null>(null)
    const selectedMakeupEnrollmentId = ref<string | null>(null)
    const makeupJoinDate = ref(DateUtils.todayString(preferences.timeZone))

    const makeupStudentOptions = computed(() => buildMakeupStudentOptions(t, makeupCandidates.value, makeupSearch.value))

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

    const selectedMakeupEnrollment = computed(() => {
        return makeupCandidates.value.find(item => item.id === selectedMakeupEnrollmentId.value) || null
    })

    function handleMakeupStudentChange() {
        selectedMakeupEnrollmentId.value = null
    }

    watch([selectedMakeupStudentId, selectedMakeupEnrollmentId, makeupJoinDate], () => {
        makeupSubmitError.value = ''
    })

    async function openAddStudentModal() {
        showAddStudentModal.value = true
        makeupSubmitError.value = ''
        makeupSearch.value = ''
        selectedMakeupStudentId.value = ''
        selectedMakeupEnrollmentId.value = ''
        makeupJoinDate.value = normalizeDateInput(options.todayOccurrence.value?.occurrenceDate, preferences.timeZone)

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

        const normalizedJoinDate = normalizeDateInput(makeupJoinDate.value, preferences.timeZone)
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
                options.sessionId,
                normalizedJoinDate
            )

            if (options.selectedDateKey.value === normalizedJoinDate) {
                try {
                    await options.refreshRosterForDate(normalizedJoinDate)
                } catch (refreshError) {
                    // The makeup report is already committed; a roster refresh
                    // failure must not make retrying the add operation duplicate it.
                    console.error('Failed to refresh the class roster after adding a makeup report:', refreshError)
                }
            }

            toast.success(t('classroom.add_student_success'))
            closeAddStudentModal()
        } catch (error: any) {
            const errorMessage = t(makeupSubmitErrorKey(error))
            makeupSubmitError.value = errorMessage
            await nextTick()
            options.focusSubmitError()
        } finally {
            isAddingStudent.value = false
        }
    }

    return {
        showAddStudentModal,
        isAddingStudent,
        makeupSubmitError,
        makeupSearch,
        selectedMakeupStudentId,
        selectedMakeupEnrollmentId,
        makeupJoinDate,
        makeupStudentOptions,
        makeupEnrollmentOptions,
        selectedMakeupEnrollment,
        handleMakeupStudentChange,
        openAddStudentModal,
        closeAddStudentModal,
        submitAddStudentToClass,
    }
}
