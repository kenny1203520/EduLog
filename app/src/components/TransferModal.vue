<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { domainErrorCode, hasDomainErrorCode } from '@/services/errors/mapDomainError'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { SessionService } from '@/services/session/SessionService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import { useCapacityCheck } from '@/composables/useCapacityCheck'
import CapacityProgressBar from '@/components/common/CapacityProgressBar.vue'
import BaseDatePicker from '@/components/common/BaseDatePicker.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { formatClassSessionOption } from '@/utils/sessionSchedule'
import { SessionEligibilityPolicy } from '@/models/SessionEligibilityPolicy'
import TransferReportConflictModal from '@/components/TransferReportConflictModal.vue'
import type { SingleLessonTransferConflict, SingleLessonTransferResult } from '@/services/enrollment/SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import type { ClassTransferResult } from '@/services/enrollment/EnrollmentTransferService'

const NOTE_MAX_LENGTH = 200

const props = defineProps<{
    isOpen: boolean
    studentId: string
    fromEnrollmentId: string | null
}>()

const emit = defineEmits(['close', 'success'])

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()
const preferences = usePreferencesStore()

const isSubmitting = ref(false)
const isResolvingConflict = ref(false)
const transferConflict = ref<SingleLessonTransferConflict | null>(null)
const isLoadingReports = ref(false)
const isLoadingClassrooms = ref(false)
const isLoadingEnrollment = ref(false)
const selectedClassroomId = ref('')
const transferForm = ref({
    mode: 'class' as 'class' | 'single',
    single_source_mode: 'report' as 'report' | 'date',
    to_session_id: '',
    effective_date: DateUtils.todayString(preferences.timeZone),
    selected_report_id: '',
    original_date: DateUtils.todayString(preferences.timeZone),
    target_date: DateUtils.todayString(preferences.timeZone),
    note: ''
})

const classrooms = ref<any[]>([])
const sessions = ref<any[]>([])
const reportOptions = ref<any[]>([])
const currentEnrollment = ref<any | null>(null)
const transferDateForCapacity = computed(() => (
    transferForm.value.mode === 'single'
        ? transferForm.value.target_date
        : transferForm.value.effective_date
))

const eligibleSessions = computed(() => {
    if (!currentEnrollment.value?.courseId) return []
    return SessionEligibilityPolicy.filter(sessions.value, {
        courseId: currentEnrollment.value.courseId,
        classroomId: selectedClassroomId.value || null
    })
})

const classroomOptions = computed(() => {
    const eligibleIds = SessionEligibilityPolicy.classroomIds(
        sessions.value,
        currentEnrollment.value?.courseId || ''
    )
    return [
        { value: '', label: t('classroom.all_rooms') },
        ...classrooms.value
            .filter(classroom => classroom.id && eligibleIds.has(classroom.id))
            .map(classroom => ({ value: classroom.id, label: classroom.name }))
    ]
})

const sessionOptions = computed(() => eligibleSessions.value.map((session: any) => ({
    value: session.id,
    label: formatSessionOptionLabel(session)
})))

// Capacity Check (Assuming 1 lesson for simple capacity check on transfer effective date)
// Or we could pass a larger count if we want to check long-term capacity
const { maxEnrollment, capacity, isChecking, isFull } = useCapacityCheck(
    computed(() => transferForm.value.to_session_id),
    transferDateForCapacity,
    ref(1)
)

function formatTime(time: string | undefined | null): string {
    return time ? time.slice(0, 5) : ''
}

function formatTimeRange(start?: string | null, end?: string | null): string {
    const startText = formatTime(start)
    if (!startText) return ''

    const endText = formatTime(end)
    return endText ? `${startText}-${endText}` : startText
}

function formatWeekdayFromIndex(dayOfWeek: number | undefined | null): string {
    if (dayOfWeek === undefined || dayOfWeek === null) return ''

    const anchor = new Date(2023, 0, 1 + dayOfWeek)
    return anchor.toLocaleDateString(preferences.locale, { weekday: 'short' })
}

function formatWeekdayFromDate(dateValue: string | Date | undefined): string {
    if (!dateValue) return ''

    const date = typeof dateValue === 'string'
        ? DateUtils.parseLocalDate(dateValue)
        : dateValue

    return date?.toLocaleDateString(preferences.locale, { weekday: 'short' }) || ''
}

function formatSessionOptionLabel(session: any): string {
    return formatClassSessionOption(session, preferences.locale, t)
}

const currentEnrollmentDetails = computed(() => {
    const enrollment = currentEnrollment.value
    if (!enrollment) return null

    const scheduleParts = [
        formatWeekdayFromIndex(enrollment.classSessionDayOfWeek),
        formatTimeRange(enrollment.classSessionStartTime, enrollment.classSessionEndTime)
    ].filter(Boolean)

    return {
        className: [
            enrollment.classSessionName,
            scheduleParts.join(' ')
        ].filter(Boolean).join(' · '),
        courseName: enrollment.displayName,
        classroomName: enrollment.classroomName
    }
})

async function fetchCurrentEnrollment() {
    currentEnrollment.value = null

    if (!props.studentId || !props.fromEnrollmentId) return

    try {
        isLoadingEnrollment.value = true
        const enrollments = await EnrollmentService.getByStudentId(props.studentId)
        currentEnrollment.value = enrollments.find((enrollment: any) => enrollment.id === props.fromEnrollmentId) || null
    } catch (e) {
        console.error(e)
    } finally {
        isLoadingEnrollment.value = false
    }
}

async function fetchSessions() {
    try {
        const { data } = await SessionService.getAllClassSessions()
        sessions.value = data
    } catch (e) {
        console.error(e)
    }
}

async function fetchClassrooms() {
    try {
        isLoadingClassrooms.value = true
        const { data } = await ClassroomService.getAllClassrooms()
        classrooms.value = data
    } catch (e) {
        console.error(e)
    } finally {
        isLoadingClassrooms.value = false
    }
}

function getOccurrenceData(report: any): any {
    return Array.isArray(report?.class_occurrence) ? report.class_occurrence[0] : report?.class_occurrence
}

async function fetchReports() {
    reportOptions.value = []

    if (!props.fromEnrollmentId) return

    try {
        isLoadingReports.value = true
        const reports = await OccurrenceReportService.getReportsWithDetails(props.fromEnrollmentId)
        reportOptions.value = reports
            .map((report: any) => {
                const occurrence = getOccurrenceData(report)
                if (!report.id || !occurrence?.occurrence_date) return null

                const sessionName = occurrence.class_session?.name || ''
                const lessonTitle = report.lesson?.title || ''
                const date = DateUtils.displayDate(occurrence.occurrence_date, preferences.locale, preferences.timeZone)
                const weekday = formatWeekdayFromDate(occurrence.occurrence_date)
                const time = formatTimeRange(
                    occurrence.actual_start_time ||
                    occurrence.original_start_time ||
                    occurrence.class_session?.start_time,
                    occurrence.actual_end_time ||
                    occurrence.original_end_time ||
                    occurrence.class_session?.end_time
                )
                const dateParts = [
                    date,
                    weekday ? `(${weekday})` : '',
                    time
                ].filter(Boolean).join(' ')
                const contextParts = [
                    sessionName,
                    lessonTitle
                ].filter(Boolean)

                return {
                    value: report.id,
                    label: contextParts.length > 0
                        ? `${dateParts} · ${contextParts.join(' · ')}`
                        : dateParts
                }
            })
            .filter(Boolean)

        if (reportOptions.value.length === 0 && transferForm.value.mode === 'single') {
            transferForm.value.single_source_mode = 'date'
        }
    } catch (e) {
        console.error(e)
        reportError(e, 'student.transfer_modal.load_reports_failed')
    } finally {
        isLoadingReports.value = false
    }
}

const classSummary = ref<ClassTransferResult | null>(null)

function closeModal() {
    classSummary.value = null
    emit('close')
}

watch(() => props.isOpen, (val) => {
    if (val) {
        selectedClassroomId.value = ''
        transferConflict.value = null
        classSummary.value = null
        fetchClassrooms()
        fetchSessions()
        fetchReports()
        transferForm.value = {
            mode: 'class',
            single_source_mode: 'report',
            to_session_id: '',
            effective_date: DateUtils.todayString(preferences.timeZone),
            selected_report_id: '',
            original_date: DateUtils.todayString(preferences.timeZone),
            target_date: DateUtils.todayString(preferences.timeZone),
            note: ''
        }
        fetchCurrentEnrollment()
    }
})

watch(selectedClassroomId, () => {
    if (
        transferForm.value.to_session_id &&
        !sessionOptions.value.some(option => option.value === transferForm.value.to_session_id)
    ) {
        transferForm.value.to_session_id = ''
    }
})

watch(() => transferForm.value.to_session_id, sessionId => {
    if (!sessionId) return
    const selectedSession = sessions.value.find(session => session.id === sessionId)
    selectedClassroomId.value = selectedSession?.classroom_id || ''
})

watch(() => transferForm.value.mode, (mode) => {
    if (mode === 'single' && reportOptions.value.length === 0) {
        transferForm.value.single_source_mode = 'date'
    }
})

async function submitTransfer() {
    if (!props.fromEnrollmentId || !transferForm.value.to_session_id) {
        errorKey('student.management.required_fields')
        return
    }

    if (transferForm.value.mode === 'class' && !transferForm.value.effective_date) {
        errorKey('student.management.required_fields')
        return
    }

    if (
        transferForm.value.mode === 'single' &&
        (
            !transferForm.value.target_date ||
            (
                transferForm.value.single_source_mode === 'report' &&
                !transferForm.value.selected_report_id
            ) ||
            (
                transferForm.value.single_source_mode === 'date' &&
                !transferForm.value.original_date
            )
        )
    ) {
        errorKey('student.management.required_fields')
        return
    }

    if (isFull.value) {
        errorKey('student.errors.session_full')
        return
    }

    try {
        isSubmitting.value = true

        let singleResult: SingleLessonTransferResult | null = null
        if (transferForm.value.mode === 'single') {
            if (transferForm.value.single_source_mode === 'date') {
                singleResult = await EnrollmentService.transferSingleLessonFromDate(
                    props.fromEnrollmentId,
                    transferForm.value.original_date,
                    transferForm.value.to_session_id,
                    transferForm.value.target_date,
                    { createIfMissing: true }
                )
            } else {
                singleResult = await EnrollmentService.transferSingleLessonReport(
                    transferForm.value.selected_report_id,
                    transferForm.value.to_session_id,
                    transferForm.value.target_date
                )
            }
        } else {
            const classResult = await EnrollmentService.transferClass(
                props.fromEnrollmentId,
                transferForm.value.to_session_id,
                transferForm.value.effective_date,
                transferForm.value.note
            )
            // Keep the dialog open on the summary so the moves can be reviewed.
            toast.success(t('common.success'))
            emit('success')
            classSummary.value = classResult
            return
        }

        if (singleResult?.status === 'conflict') {
            transferConflict.value = singleResult.conflict
            return
        }

        toast.success(t('common.success'))
        emit('success')
        emit('close')
    } catch (e: any) {
        console.error(e)
        const message = domainErrorCode(e) || ''

        // Codes with friendlier, context-specific wording than the generic
        // errors.domain.* mapper keep it; everything else -- including codes
        // that used to fall through to a raw/English message -- now routes
        // through reportError so nothing untranslated reaches the user.
        // (ORIGINAL_REPORT_NOT_FOUND was a dead branch: nothing ever threw it.)
        if (message.includes('TARGET_DATE_NOT_CLASS_DAY')) {
            errorKey('student.transfer_modal.target_date_not_class_day')
        } else if (message.includes('TARGET_REPORT_ALREADY_EXISTS')) {
            errorKey('student.transfer_modal.target_report_exists')
        } else if (message.includes('TARGET_SESSION_SAME_AS_CURRENT')) {
            errorKey('student.transfer_modal.same_session_error')
        } else if (message.includes('TARGET_SESSION_COURSE_MISMATCH')) {
            errorKey('student.errors.session_course_mismatch')
        } else if (message.includes('ORIGINAL_REPORT_AMBIGUOUS')) {
            errorKey('student.transfer_modal.original_report_ambiguous')
        } else if (message.includes('ORIGINAL_DATE_NOT_CLASS_DAY')) {
            errorKey('student.transfer_modal.original_date_not_class_day')
        } else {
            reportError(e)
        }
    } finally {
        isSubmitting.value = false
    }
}

async function resolveTransferConflict(selections: TransferReportFieldSelections) {
    const conflict = transferConflict.value
    if (!conflict) return

    try {
        isResolvingConflict.value = true
        const result = await EnrollmentService.resolveSingleLessonTransferConflict(
            conflict,
            selections
        )
        if (result.status === 'completed') {
            transferConflict.value = null
            toast.success(t('common.success'))
            emit('success')
            emit('close')
        }
    } catch (e: any) {
        console.error(e)
        if (hasDomainErrorCode(e, 'TRANSFER_CONFLICT_STALE')) {
            errorKey('student.transfer_conflict.stale')
        } else {
            reportError(e)
        }
    } finally {
        isResolvingConflict.value = false
    }
}

</script>

<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-md p-2 sm:items-center sm:p-4"
        @click.self="closeModal">
        <div
            class="bg-white rounded-[1.75rem] sm:rounded-[2.5rem] shadow-2xl w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] min-h-0 flex flex-col overflow-hidden animate-in zoom-in fade-in duration-300">
            <!-- Header -->
            <div class="flex items-center justify-between gap-4 p-5 sm:p-8 border-b border-gray-50 shrink-0">
                <div class="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div class="p-2.5 sm:p-3 bg-amber-50 rounded-2xl text-amber-600 shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight truncate">{{
                            $t('student.transfer_modal.title')
                        }}</h2>
                        <p class="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-widest mt-1 leading-snug">{{
                            $t('student.transfer_modal.subtitle') }}</p>
                    </div>
                </div>
                <button @click="closeModal" :aria-label="$t('common.close')"
                    class="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all cursor-pointer shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Result: what the class transfer did to the reports -->
            <div v-if="classSummary" class="flex-1 min-h-0 p-5 sm:p-8 overflow-y-auto space-y-4" role="status">
                <h3 class="text-lg font-black text-gray-900">{{ $t('student.transfer_modal.summary_title') }}</h3>
                <p class="text-sm font-medium text-gray-600 leading-relaxed">
                    {{ $t('student.transfer_modal.summary_effective', { date: DateUtils.displayDateWithWeekday(classSummary.effectiveDate, preferences.locale) }) }}
                </p>
                <dl class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div class="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <dt class="text-xs font-bold text-gray-500">{{ $t('student.transfer_modal.summary_moved') }}</dt>
                        <dd class="text-xl font-black text-gray-900 tabular-nums">{{ classSummary.movedReports }}</dd>
                    </div>
                    <div class="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <dt class="text-xs font-bold text-gray-500">{{ $t('student.transfer_modal.summary_created') }}</dt>
                        <dd class="text-xl font-black text-gray-900 tabular-nums">{{ classSummary.createdReports }}</dd>
                    </div>
                    <div class="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <dt class="text-xs font-bold text-gray-500">{{ $t('student.transfer_modal.summary_retained') }}</dt>
                        <dd class="text-xl font-black text-gray-900 tabular-nums">{{ classSummary.retainedReports.length }}</dd>
                    </div>
                    <div class="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3">
                        <dt class="text-xs font-bold text-gray-500">{{ $t('student.transfer_modal.summary_removed') }}</dt>
                        <dd class="text-xl font-black text-gray-900 tabular-nums">{{ classSummary.removedPlaceholders }}</dd>
                    </div>
                </dl>
                <p v-if="classSummary.missingCount > 0"
                    class="flex items-start gap-2 text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 shrink-0" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                    </svg>
                    <span>{{ $t('student.transfer_modal.summary_missing', { count: classSummary.missingCount }) }}</span>
                </p>
                <template v-if="classSummary.retainedReports.length">
                    <p class="text-sm font-medium text-gray-600 leading-relaxed">{{ $t('student.transfer_modal.retained_body', { count: classSummary.retainedReports.length }) }}</p>
                </template>
                <ul v-if="classSummary.retainedReports.length" class="space-y-2">
                    <li v-for="report in classSummary.retainedReports" :key="report.reportId"
                        class="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                        <span class="font-bold text-gray-800">{{ DateUtils.displayDateWithWeekday(report.occurrenceDate, preferences.locale) }}</span>
                        <router-link v-if="fromEnrollmentId" :to="{ name: 'lesson-reports', params: { enrollmentId: fromEnrollmentId } }"
                            class="min-h-[44px] inline-flex items-center rounded-xl px-3 text-xs font-black text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                            @click="closeModal">
                            {{ $t('student.transfer_modal.retained_open') }}
                        </router-link>
                    </li>
                </ul>
            </div>

            <!-- Body -->
            <div v-else class="flex-1 min-h-0 p-5 sm:p-8 overflow-y-auto overscroll-contain custom-scrollbar space-y-6 sm:space-y-8">
                <div class="space-y-5 sm:space-y-6">
                    <TimeZoneSelect :label="$t('common.time_zone')" dense />

                    <div class="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
                        <button type="button" @click="transferForm.mode = 'class'"
                            :class="[
                                'rounded-xl px-4 py-3 text-sm font-black uppercase tracking-widest transition-all',
                                transferForm.mode === 'class'
                                    ? 'bg-white text-amber-700 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                            ]">
                            {{ $t('student.transfer_modal.mode_class') }}
                        </button>
                        <button type="button" @click="transferForm.mode = 'single'"
                            :class="[
                                'rounded-xl px-4 py-3 text-sm font-black uppercase tracking-widest transition-all',
                                transferForm.mode === 'single'
                                    ? 'bg-white text-amber-700 shadow-sm'
                                    : 'text-gray-400 hover:text-gray-600'
                            ]">
                            {{ $t('student.transfer_modal.mode_single') }}
                        </button>
                    </div>

                    <div v-if="transferForm.mode === 'class'" class="bg-gray-50 rounded-2xl p-4 sm:p-5 border border-gray-100">
                        <p class="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                            {{ $t('student.transfer_modal.current_class') }}
                        </p>
                        <p v-if="isLoadingEnrollment" class="text-sm font-black text-gray-800 leading-relaxed">
                            {{ $t('common.loading') }}
                        </p>
                        <div v-else-if="currentEnrollmentDetails" class="space-y-3">
                            <div class="grid grid-cols-[4rem_1fr] gap-3">
                                <span class="text-xs font-black text-gray-400 uppercase tracking-widest pt-0.5">
                                    {{ $t('student.transfer_modal.class_label') }}
                                </span>
                                <span class="min-w-0 text-sm font-black text-gray-900 leading-relaxed break-words">
                                    {{ currentEnrollmentDetails.className || '-' }}
                                </span>
                            </div>
                            <div class="grid grid-cols-[4rem_1fr] gap-3">
                                <span class="text-xs font-black text-gray-400 uppercase tracking-widest pt-0.5">
                                    {{ $t('student.transfer_modal.course_label') }}
                                </span>
                                <span class="min-w-0 text-sm font-bold text-gray-700 leading-relaxed break-words">
                                    {{ currentEnrollmentDetails.courseName || '-' }}
                                </span>
                            </div>
                            <div class="grid grid-cols-[4rem_1fr] gap-3">
                                <span class="text-xs font-black text-gray-400 uppercase tracking-widest pt-0.5">
                                    {{ $t('student.transfer_modal.classroom_label') }}
                                </span>
                                <span class="min-w-0 text-sm font-bold text-gray-700 leading-relaxed break-words">
                                    {{ currentEnrollmentDetails.classroomName || '-' }}
                                </span>
                            </div>
                        </div>
                        <p v-else class="text-sm font-black text-gray-800 leading-relaxed">
                            {{ $t('student.transfer_modal.current_class_unavailable') }}
                        </p>
                    </div>

                    <div v-if="transferForm.mode === 'single'" class="space-y-4">
                        <div class="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
                            <button type="button" @click="transferForm.single_source_mode = 'report'"
                                :class="[
                                    'rounded-xl px-4 py-3 text-sm font-black uppercase tracking-widest transition-all',
                                    transferForm.single_source_mode === 'report'
                                        ? 'bg-white text-amber-700 shadow-sm'
                                        : 'text-gray-400 hover:text-gray-600'
                                ]">
                                {{ $t('student.transfer_modal.source_report') }}
                            </button>
                            <button type="button" @click="transferForm.single_source_mode = 'date'"
                                :class="[
                                    'rounded-xl px-4 py-3 text-sm font-black uppercase tracking-widest transition-all',
                                    transferForm.single_source_mode === 'date'
                                        ? 'bg-white text-amber-700 shadow-sm'
                                        : 'text-gray-400 hover:text-gray-600'
                                ]">
                                {{ $t('student.transfer_modal.source_date') }}
                            </button>
                        </div>

                        <div v-if="transferForm.single_source_mode === 'report'" class="space-y-2">
                            <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.transfer_modal.original_report') }}</label>
                            <SearchableSelect v-model="transferForm.selected_report_id" :options="reportOptions"
                                :placeholder="isLoadingReports ? $t('common.loading') : $t('student.transfer_modal.original_report_placeholder')" />
                        </div>

                        <div v-else class="space-y-2">
                            <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.transfer_modal.original_date') }}</label>
                            <BaseDatePicker v-model="transferForm.original_date"
                                theme="amber" :placeholder="$t('student.transfer_modal.original_date')" />
                        </div>

                        <p v-if="!isLoadingReports && reportOptions.length === 0 && transferForm.single_source_mode === 'report'"
                            class="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                            {{ $t('student.transfer_modal.no_reports') }}
                        </p>
                        <p v-if="transferForm.single_source_mode === 'date'"
                            class="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                            {{ $t('student.transfer_modal.source_date_hint') }}
                        </p>
                    </div>

                    <div class="space-y-4">
                        <div class="space-y-2">
                            <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.transfer_modal.classroom_filter') }}</label>
                            <SearchableSelect v-model="selectedClassroomId" :options="classroomOptions"
                                :placeholder="isLoadingClassrooms ? $t('common.loading') : $t('classroom.all_rooms')"
                                :disabled="!currentEnrollment" />
                        </div>

                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                            $t('student.transfer_modal.to_classroom') }}</label>
                        <SearchableSelect v-model="transferForm.to_session_id" :options="sessionOptions"
                            :placeholder="$t('common.select_placeholder')" :disabled="!currentEnrollment" />

                        <!-- Modular Capacity Progress Bar -->
                        <div v-if="transferForm.to_session_id" class="mt-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 animate-in fade-in duration-500">
                            <CapacityProgressBar 
                                :current="maxEnrollment" 
                                :capacity="capacity" 
                                :is-loading="isChecking"
                            />
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                            transferForm.mode === 'single'
                                ? $t('student.transfer_modal.target_date')
                                : $t('student.transfer_modal.effective_date') }}</label>
                        <BaseDatePicker v-if="transferForm.mode === 'single'" v-model="transferForm.target_date"
                            theme="amber" :placeholder="$t('student.transfer_modal.target_date')" />
                        <BaseDatePicker v-else v-model="transferForm.effective_date"
                            theme="amber" :placeholder="$t('student.transfer_modal.effective_date')" />
                    </div>

                    <div v-if="transferForm.mode === 'class'" class="space-y-2">
                        <label for="transfer-note" class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1">
                            {{ $t('student.transfer_modal.note_label') }}
                        </label>
                        <textarea id="transfer-note" v-model="transferForm.note" rows="2" :maxlength="NOTE_MAX_LENGTH"
                            :placeholder="$t('student.transfer_modal.note_placeholder')"
                            aria-describedby="transfer-note-count"
                            class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"></textarea>
                        <p id="transfer-note-count" class="text-right text-xs font-bold text-gray-500 tabular-nums">
                            {{ transferForm.note.length }} / {{ NOTE_MAX_LENGTH }}
                        </p>
                    </div>
                </div>

                <div class="bg-amber-50 rounded-2xl p-4 border border-amber-100">
                    <p class="text-sm font-bold text-amber-800 leading-relaxed uppercase tracking-wider">
                        {{ transferForm.mode === 'single'
                            ? $t('student.transfer_modal.single_note')
                            : $t('student.transfer_modal.note') }}
                    </p>
                </div>
            </div>

            <!-- Footer -->
            <div v-if="classSummary" class="p-5 sm:p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex">
                <button @click="closeModal"
                    class="flex-1 px-4 sm:px-8 py-4 bg-amber-600 text-white rounded-2xl hover:bg-amber-700 transition-colors text-sm sm:text-base font-black cursor-pointer uppercase tracking-widest">
                    {{ $t('student.transfer_modal.retained_done') }}
                </button>
            </div>
            <div v-else class="p-5 sm:p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex gap-3 sm:gap-4">
                <button @click="closeModal"
                    class="flex-1 px-4 sm:px-8 py-4 text-sm sm:text-base font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="submitTransfer()" :disabled="isSubmitting"
                    class="flex-1 px-4 sm:px-8 py-4 bg-amber-600 text-white rounded-2xl hover:bg-amber-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 text-sm sm:text-base font-black shadow-xl shadow-amber-100 active:scale-95 cursor-pointer uppercase tracking-widest">
                    <svg v-if="isSubmitting" class="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                        </path>
                    </svg>
                    {{ $t('common.confirm') }}
                </button>
            </div>
        </div>

        <TransferReportConflictModal v-if="transferConflict" :conflict="transferConflict"
            :is-resolving="isResolvingConflict"
            @cancel="transferConflict = null"
            @resolve="resolveTransferConflict" />

    </div>
</template>

<style scoped>
.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgb(217 119 6 / 0.45) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
    width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgb(217 119 6 / 0.35);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgb(217 119 6 / 0.55);
}
</style>
