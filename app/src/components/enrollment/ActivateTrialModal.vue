<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { SessionService } from '@/services/session/SessionService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import TimeZoneSelect from '@/components/ui/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/dateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { formatClassSessionOption } from '@/utils/sessionSchedule'
import { SessionEligibilityPolicy } from '@/models/SessionEligibilityPolicy'
import { EnrollmentQueryService } from '@/services/enrollment/EnrollmentQueryService'
import { EnrollmentCommandService } from '@/services/enrollment/EnrollmentCommandService'

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
const isLoadingClassrooms = ref(false)
const isLoadingEnrollment = ref(false)
const selectedClassroomId = ref('')
const activateTrialForm = ref({
    class_session_id: '',
    effective_date: DateUtils.todayString(preferences.timeZone),
    target_total_reports: 1
})

const classrooms = ref<any[]>([])
const sessions = ref<any[]>([])
const currentEnrollment = ref<any | null>(null)

const defaultReportCount = computed(() => Math.max(1, currentEnrollment.value?.lessonCount || 1))

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

const sessionOptions = computed(() => eligibleSessions.value.map(session => ({
    value: session.id,
    label: formatSessionOptionLabel(session)
})))

function formatSessionOptionLabel(session: any): string {
    return formatClassSessionOption(session, preferences.locale, t)
}

async function fetchCurrentEnrollment() {
    currentEnrollment.value = null
    if (!props.studentId || !props.fromEnrollmentId) return

    try {
        isLoadingEnrollment.value = true
        const enrollments = await EnrollmentQueryService.getByStudentId(props.studentId)
        currentEnrollment.value = enrollments.find((enrollment: any) => enrollment.id === props.fromEnrollmentId) || null
        activateTrialForm.value.target_total_reports = defaultReportCount.value
    } catch (e) {
        console.error(e)
    } finally {
        isLoadingEnrollment.value = false
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

async function fetchSessions() {
    try {
        const { data } = await SessionService.getAllClassSessions()
        sessions.value = data
    } catch (e) {
        console.error(e)
    }
}

watch(() => props.isOpen, async (val) => {
    if (val) {
        selectedClassroomId.value = ''
        activateTrialForm.value = {
            class_session_id: '',
            effective_date: DateUtils.todayString(preferences.timeZone),
            target_total_reports: 1
        }
        await Promise.all([fetchClassrooms(), fetchSessions(), fetchCurrentEnrollment()])
        const originalClassroomId = currentEnrollment.value?.classroomId || ''
        const originalSessionId = currentEnrollment.value?.classSessionId || ''
        selectedClassroomId.value = originalClassroomId
        if (originalSessionId && eligibleSessions.value.some(session => session.id === originalSessionId)) {
            activateTrialForm.value.class_session_id = originalSessionId
        }
    }
})

watch(selectedClassroomId, () => {
    if (
        activateTrialForm.value.class_session_id &&
        !sessionOptions.value.some(option => option.value === activateTrialForm.value.class_session_id)
    ) {
        activateTrialForm.value.class_session_id = ''
    }
})

watch(() => activateTrialForm.value.class_session_id, sessionId => {
    if (!sessionId) return
    const selectedSession = sessions.value.find(session => session.id === sessionId)
    selectedClassroomId.value = selectedSession?.classroom_id || ''
})


async function submitActivateTrial() {
    if (!props.fromEnrollmentId || !activateTrialForm.value.class_session_id || !activateTrialForm.value.effective_date) {
        errorKey('student.management.required_fields')
        return
    }

    try {
        isSubmitting.value = true
        await EnrollmentCommandService.update(props.fromEnrollmentId, {
            status: 'regular',
            class_session_id: activateTrialForm.value.class_session_id || undefined,
            start_date: activateTrialForm.value.effective_date,
            time_zone: preferences.timeZone
        }, {
            targetTotalReports: Math.max(1, Math.floor(Number(activateTrialForm.value.target_total_reports) || 1))
        })

        toast.success(t('common.success'))
        emit('success')
        emit('close')
    } catch (e: any) {
        console.error(e)
        if (e.message?.includes('TARGET_SESSION_COURSE_MISMATCH')) errorKey('student.errors.session_course_mismatch')
        else reportError(e, 'student.errors.activate_trial_failed')
    } finally {
        isSubmitting.value = false
    }
}

</script>

<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-md p-2 sm:items-center sm:p-4"
        @click.self="emit('close')">
        <div
            class="bg-white rounded-[1.75rem] sm:rounded-[2.5rem] shadow-2xl w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh] min-h-0 flex flex-col overflow-hidden animate-in zoom-in fade-in duration-300">
            <!-- Header -->
            <div class="flex items-center justify-between gap-4 p-5 sm:p-8 border-b border-gray-50 shrink-0">
                <div class="flex items-center gap-3 sm:gap-4 min-w-0">
                    <div class="p-2.5 sm:p-3 bg-blue-50 rounded-2xl text-blue-600 shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight truncate">{{
                            $t('student.activate_trial_modal.title') }}</h2>
                        <p class="text-xs sm:text-sm font-bold text-gray-400 uppercase tracking-widest mt-1 leading-snug">{{
                            $t('student.activate_trial_modal.subtitle') }}</p>
                    </div>
                </div>
                <button @click="emit('close')"
                    class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="flex-1 min-h-0 p-5 sm:p-8 overflow-y-auto overscroll-contain custom-scrollbar space-y-6 sm:space-y-8">
                <div class="space-y-5 sm:space-y-6">
                    <TimeZoneSelect :label="$t('common.time_zone')" dense />

                    <div class="space-y-2">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1" for="edulog-activatetrialmodal-39-2516">{{
                            $t('student.activate_trial_modal.classroom_filter') }}</label>
                        <SearchableSelect v-model="selectedClassroomId" :options="classroomOptions"
                            :placeholder="isLoadingClassrooms ? $t('common.loading') : $t('classroom.all_rooms')"
                            :disabled="!currentEnrollment"  id="edulog-activatetrialmodal-39-2516"/>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1" for="edulog-activatetrialmodal-47-3067">{{
                            $t('student.activate_trial_modal.to_classroom') }}</label>
                        <SearchableSelect v-model="activateTrialForm.class_session_id" :options="sessionOptions"
                            :placeholder="$t('common.select_placeholder')" :disabled="!currentEnrollment"  id="edulog-activatetrialmodal-47-3067"/>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1" for="edulog-activatetrialmodal-54-3560">{{
                            $t('student.activate_trial_modal.effective_date') }}</label>
                        <input type="date" v-model="activateTrialForm.effective_date"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-gray-700 shadow-sm" id="edulog-activatetrialmodal-54-3560">
                    </div>

                    <div class="space-y-2">
                        <label class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1" for="edulog-activatetrialmodal-61-4132">{{
                            $t('student.activate_trial_modal.target_total_reports') }}</label>
                        <input type="number" min="1" step="1" v-model.number="activateTrialForm.target_total_reports"
                            :disabled="isLoadingEnrollment"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-gray-700 shadow-sm disabled:opacity-60" id="edulog-activatetrialmodal-61-4132">
                        <p class="text-xs font-bold text-gray-400 ml-1">
                            {{ $t('student.activate_trial_modal.target_total_reports_hint', defaultReportCount, { named: { count: defaultReportCount } }) }}
                        </p>
                    </div>
                </div>

                <div class="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                    <p class="text-[10px] font-bold text-blue-800 leading-relaxed uppercase tracking-wider">
                        {{ $t('student.activate_trial_modal.note') }}
                    </p>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-5 sm:p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex gap-3 sm:gap-4">
                <button @click="emit('close')"
                    class="flex-1 px-4 sm:px-8 py-4 text-sm sm:text-base font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="submitActivateTrial()" :disabled="isSubmitting"
                    class="flex-1 px-4 sm:px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 text-sm sm:text-base font-black shadow-xl shadow-blue-100 active:scale-95 cursor-pointer uppercase tracking-widest">
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

<style scoped>
.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgb(37 99 235 / 0.45) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
    width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgb(37 99 235 / 0.35);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: padding-box;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgb(37 99 235 / 0.55);
}
</style>
