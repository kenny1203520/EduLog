<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { SessionService } from '@/services/session/SessionService'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import { useCapacityCheck } from '@/composables/useCapacityCheck'
import CapacityProgressBar from '@/components/common/CapacityProgressBar.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

const props = defineProps<{
    isOpen: boolean
    studentId: string
    fromEnrollmentId: string | null
}>()

const emit = defineEmits(['close', 'success'])

const { t } = useI18n()
const toast = useToast()
const preferences = usePreferencesStore()

const isSubmitting = ref(false)
const isLoadingReports = ref(false)
const transferForm = ref({
    mode: 'class' as 'class' | 'single',
    to_session_id: '',
    effective_date: DateUtils.todayString(preferences.timeZone),
    selected_report_id: '',
    target_date: DateUtils.todayString(preferences.timeZone)
})

const sessionOptions = ref<any[]>([])
const reportOptions = ref<any[]>([])
const transferDateForCapacity = computed(() => (
    transferForm.value.mode === 'single'
        ? transferForm.value.target_date
        : transferForm.value.effective_date
))

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
    const scheduleParts = [
        formatWeekdayFromIndex(session.day_of_week),
        formatTimeRange(session.start_time, session.end_time)
    ].filter(Boolean)

    return scheduleParts.length > 0
        ? `${session.name} · ${scheduleParts.join(' ')}`
        : session.name
}

async function fetchSessions() {
    try {
        const { data: sessions } = await SessionService.getClassSessions()
        sessionOptions.value = sessions.map((s: any) => ({
            value: s.id,
            label: s.name
        }))
    } catch (e) {
        console.error(e)
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
                const time = formatTime(
                    occurrence.actual_start_time ||
                    occurrence.original_start_time ||
                    occurrence.class_session?.start_time
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
    } catch (e) {
        console.error(e)
        toast.error(t('student.transfer_modal.load_reports_failed'))
    } finally {
        isLoadingReports.value = false
    }
}

watch(() => props.isOpen, (val) => {
    if (val) {
        fetchSessions()
        fetchReports()
        transferForm.value = {
            mode: 'class',
            to_session_id: '',
            effective_date: DateUtils.todayString(preferences.timeZone),
            selected_report_id: '',
            target_date: DateUtils.todayString(preferences.timeZone)
        }
    }
})

async function submitTransfer() {
    if (!props.fromEnrollmentId || !transferForm.value.to_session_id) {
        toast.error(t('student.management.required_fields', 'Missing required fields'))
        return
    }

    if (transferForm.value.mode === 'class' && !transferForm.value.effective_date) {
        toast.error(t('student.management.required_fields', 'Missing required fields'))
        return
    }

    if (transferForm.value.mode === 'single' && (!transferForm.value.selected_report_id || !transferForm.value.target_date)) {
        toast.error(t('student.management.required_fields', 'Missing required fields'))
        return
    }

    if (isFull.value) {
        toast.error(t('student.errors.session_full', 'Selected session is full on the effective date'))
        return
    }

    try {
        isSubmitting.value = true

        if (transferForm.value.mode === 'single') {
            await EnrollmentService.transferSingleLessonReport(
                transferForm.value.selected_report_id,
                transferForm.value.to_session_id,
                transferForm.value.target_date
            )
        } else {
            // Compatibility parameter: transfer service keeps the argument but uses transferDate for the new rule.
            const originalLastDate = DateUtils.addDaysToDateString(transferForm.value.effective_date, -1)

            await EnrollmentService.transferClass(
                props.fromEnrollmentId,
                transferForm.value.to_session_id,
                originalLastDate,
                transferForm.value.effective_date
            )
        }

        toast.success(t('common.success'))
        emit('success')
        emit('close')
    } catch (e: any) {
        console.error(e)
        const message = e.message || ''

        if (message.includes('TARGET_DATE_NOT_CLASS_DAY')) {
            toast.error(t('student.transfer_modal.target_date_not_class_day'))
        } else if (message.includes('TARGET_REPORT_ALREADY_EXISTS')) {
            toast.error(t('student.transfer_modal.target_report_exists'))
        } else if (message.includes('TARGET_SESSION_SAME_AS_CURRENT')) {
            toast.error(t('student.transfer_modal.same_session_error'))
        } else if (message.includes('ORIGINAL_REPORT_NOT_FOUND')) {
            toast.error(t('student.transfer_modal.original_report_not_found'))
        } else if (message.includes('ORIGINAL_REPORT_AMBIGUOUS')) {
            toast.error(t('student.transfer_modal.original_report_ambiguous'))
        } else {
            toast.error(message || 'Failed to transfer student')
        }
    } finally {
        isSubmitting.value = false
    }
}

</script>

<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md px-4"
        @click.self="emit('close')">
        <div
            class="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl flex flex-col overflow-hidden animate-in zoom-in fade-in duration-300">
            <!-- Header -->
            <div class="flex items-center justify-between p-8 border-b border-gray-50 shrink-0">
                <div class="flex items-center gap-4">
                    <div class="p-3 bg-amber-50 rounded-2xl text-amber-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-3xl font-black text-gray-900 tracking-tight">{{
                            $t('student.transfer_modal.title')
                        }}</h2>
                        <p class="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('student.transfer_modal.subtitle') }}</p>
                    </div>
                </div>
                <button @click="emit('close')"
                    class="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="p-8 overflow-y-auto custom-scrollbar space-y-8">
                <div class="space-y-6">
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

                    <div v-if="transferForm.mode === 'single'" class="space-y-4">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                            $t('student.transfer_modal.original_report') }}</label>
                        <SearchableSelect v-model="transferForm.selected_report_id" :options="reportOptions"
                            :placeholder="isLoadingReports ? $t('common.loading') : $t('student.transfer_modal.original_report_placeholder')" />
                        <p v-if="!isLoadingReports && reportOptions.length === 0"
                            class="text-sm font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                            {{ $t('student.transfer_modal.no_reports') }}
                        </p>
                    </div>

                    <div class="space-y-4">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                            $t('student.transfer_modal.to_classroom') }}</label>
                        <SearchableSelect v-model="transferForm.to_session_id" :options="sessionOptions"
                            :placeholder="$t('common.select_placeholder')" />

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
                        <input v-if="transferForm.mode === 'single'" type="date" v-model="transferForm.target_date"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all text-lg font-bold text-gray-700 shadow-sm">
                        <input v-else type="date" v-model="transferForm.effective_date"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all text-lg font-bold text-gray-700 shadow-sm">
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
            <div class="p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex gap-4">
                <button @click="emit('close')"
                    class="flex-1 px-8 py-4 text-base font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="submitTransfer()" :disabled="isSubmitting"
                    class="flex-1 px-8 py-4 bg-amber-600 text-white rounded-2xl hover:bg-amber-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 font-black shadow-xl shadow-amber-100 active:scale-95 cursor-pointer uppercase tracking-widest">
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

    </div>
</template>
