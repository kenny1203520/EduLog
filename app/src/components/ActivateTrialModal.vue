<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { SessionService } from '@/services/session/SessionService'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

const props = defineProps<{
    isOpen: boolean
    studentId: string
    fromEnrollmentId: string | null
}>()

const emit = defineEmits(['close', 'success'])

const { t } = useI18n()
const toast = useToast()

const isSubmitting = ref(false)
const activateTrialForm = ref({
    class_session_id: '',
    effective_date: new Date().toISOString().split('T')[0]
})

const sessionOptions = ref<any[]>([])

async function fetchSessions() {
    try {
        const { data: sessions } = await SessionService.getClassSessions()
        sessionOptions.value = sessions.map(s => ({
            value: s.id,
            label: s.name
        }))
    } catch (e) {
        console.error(e)
    }
}

watch(() => props.isOpen, (val) => {
    if (val) {
        fetchSessions()
        activateTrialForm.value = {
            class_session_id: '',
            effective_date: new Date().toISOString().split('T')[0]
        }
    }
})


async function submitActivateTrial() {
    if (!props.fromEnrollmentId || !activateTrialForm.value.class_session_id || !activateTrialForm.value.effective_date) {
        toast.error(t('student.management.required_fields', 'Missing required fields'))
        return
    }

    try {
        isSubmitting.value = true
        await EnrollmentService.update(props.fromEnrollmentId, {
            status: 'active',
            class_session_id: activateTrialForm.value.class_session_id || undefined,
            start_date: activateTrialForm.value.effective_date
        })

        toast.success(t('common.success'))
        emit('success')
        emit('close')
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || 'Failed to activate trial')
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
                    <div class="p-3 bg-blue-50 rounded-2xl text-blue-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-2xl font-black text-gray-900 tracking-tight">{{
                            $t('student.activate_trial_modal.title') }}</h2>
                        <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mt-0.5">{{
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
            <div class="p-8 overflow-y-auto custom-scrollbar space-y-8">
                <div class="space-y-6">
                    <div class="space-y-2">
                        <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{{
                            $t('student.activate_trial_modal.to_classroom') }}</label>
                        <SearchableSelect v-model="activateTrialForm.class_session_id" :options="sessionOptions"
                            :placeholder="$t('common.select_placeholder')" />
                    </div>

                    <div class="space-y-2">
                        <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{{
                            $t('student.activate_trial_modal.effective_date') }}</label>
                        <input type="date" v-model="activateTrialForm.effective_date"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold text-gray-700 shadow-sm">
                    </div>
                </div>

                <div class="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                    <p class="text-[10px] font-bold text-blue-800 leading-relaxed uppercase tracking-wider">
                        {{ $t('student.activate_trial_modal.note') }}
                    </p>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex gap-4">
                <button @click="emit('close')"
                    class="flex-1 px-8 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="submitActivateTrial()" :disabled="isSubmitting"
                    class="flex-1 px-8 py-4 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 font-black shadow-xl shadow-blue-100 active:scale-95 cursor-pointer uppercase tracking-widest">
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
