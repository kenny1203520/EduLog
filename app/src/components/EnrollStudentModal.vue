<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { SessionService } from '@/services/session/SessionService'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import { useCapacityCheck } from '@/composables/useCapacityCheck'
import CapacityProgressBar from '@/components/common/CapacityProgressBar.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

const props = defineProps<{
    isOpen: boolean
    studentId: string
}>()

const emit = defineEmits(['close', 'success'])

const { t } = useI18n()
const toast = useToast()
const preferences = usePreferencesStore()

const isSubmitting = ref(false)
const enrollForm = ref({
    course_catalog_id: '',
    class_session_id: '',
    enrollment_type: 'regular' as 'regular' | 'trial',
    start_date: DateUtils.todayString(preferences.timeZone),
    generate_count: 10
})

const catalogOptions = ref<any[]>([])
const sessionOptions = ref<any[]>([])
const fullCourses = ref<any[]>([])

// Capacity Check Composable
const { maxEnrollment, capacity, isChecking, isFull } = useCapacityCheck(
    computed(() => enrollForm.value.class_session_id),
    computed(() => enrollForm.value.start_date),
    computed(() => enrollForm.value.generate_count)
)

async function fetchOptions() {
    try {
        const [{ data: catalogs }, { data: sessions }] = await Promise.all([
            CourseCatalogService.getCourses(),
            SessionService.getClassSessions()
        ])
        fullCourses.value = catalogs
        catalogOptions.value = catalogs.map(c => ({
            value: c.id,
            label: c.displayName
        }))
        sessionOptions.value = sessions.map(s => ({
            id: s.id,
            value: s.id,
            label: s.name
        }))
    } catch (e) {
        console.error(e)
    }
}

watch(() => enrollForm.value.course_catalog_id, (newId) => {
    if (newId && enrollForm.value.enrollment_type === 'regular') {
        const course = fullCourses.value.find(c => c.id === newId)
        if (course && course.lessons) {
            enrollForm.value.generate_count = course.lessons.length
        }
    }
})

watch(() => enrollForm.value.enrollment_type, (newType) => {
    if (newType === 'trial') {
        enrollForm.value.generate_count = 1
    } else if (newType === 'regular' && enrollForm.value.course_catalog_id) {
        const course = fullCourses.value.find(c => c.id === enrollForm.value.course_catalog_id)
        if (course && course.lessons) {
            enrollForm.value.generate_count = course.lessons.length
        }
    }
})

watch(() => props.isOpen, (val) => {
    if (val) {
        fetchOptions()
        enrollForm.value = {
            course_catalog_id: '',
            class_session_id: '',
            enrollment_type: 'regular',
            start_date: DateUtils.todayString(preferences.timeZone),
            generate_count: 10
        }
    }
})

async function submitEnrollment() {
    if (!enrollForm.value.course_catalog_id || !enrollForm.value.class_session_id || !enrollForm.value.start_date) {
        toast.error(t('student.management.required_fields', 'Missing required fields'))
        return
    }

    if (isFull.value) {
        toast.error(t('student.errors.session_full', 'Selected session is full in the chosen period'))
        return
    }

    const enrollmentData = {
        student_id: props.studentId,
        course_id: enrollForm.value.course_catalog_id,
        class_session_id: enrollForm.value.class_session_id,
        status: enrollForm.value.enrollment_type as any,
        start_date: enrollForm.value.start_date,
    }

    try {
        isSubmitting.value = true
        await EnrollmentService.create(enrollmentData, {
            targetReportCount: enrollForm.value.generate_count
        })

        toast.success(t('common.success'))
        emit('success')
        emit('close')
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || 'Failed to enroll student')
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
                    <div class="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                            stroke="currentColor" class="w-6 h-6">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-3xl font-black text-gray-900 tracking-tight">{{ $t('student.enroll_modal.title')
                            }}</h2>
                        <p class="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('student.enroll_modal.subtitle') }}</p>
                    </div>
                </div>
                <button @click="emit('close')"
                    class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all cursor-pointer">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="p-8 overflow-y-auto custom-scrollbar space-y-8">
                <!-- Course & Classroom -->
                <div class="grid grid-cols-1 gap-6">
                    <TimeZoneSelect :label="$t('common.time_zone')" dense />

                    <div class="space-y-2">
                        <label
                            class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.course') }}</label>
                        <SearchableSelect v-model="enrollForm.course_catalog_id" :options="catalogOptions"
                            :placeholder="$t('common.select_placeholder')" />
                    </div>

                    <div class="space-y-4">
                        <label
                            class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.classroom') }}</label>
                        <SearchableSelect v-model="enrollForm.class_session_id" :options="sessionOptions"
                            :placeholder="$t('common.select_placeholder')" />

                        <!-- Modular Capacity Progress Bar -->
                        <div v-if="enrollForm.class_session_id"
                            class="mt-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 animate-in fade-in duration-500">
                            <CapacityProgressBar :current="maxEnrollment" :capacity="capacity"
                                :is-loading="isChecking" />
                        </div>
                    </div>
                </div>

                <!-- Type, Count & Dates -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="space-y-2">
                        <label
                            class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.type') }}</label>
                        <BaseDropdown v-model="enrollForm.enrollment_type" :options="[
                            { label: $t('student.enroll_modal.type_regular'), value: 'regular' },
                            { label: $t('student.enroll_modal.type_trial'), value: 'trial' }
                        ]" theme="emerald" />
                    </div>

                    <div class="space-y-2">
                        <label
                            class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.start_date') }}</label>
                        <input type="date" v-model="enrollForm.start_date"
                            class="px-5 py-4 text-lg font-bold bg-gray-50 border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all text-gray-700 shadow-sm">
                    </div>

                    <div class="space-y-2">
                        <label
                            class="block text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.generate_count') || 'Expected Lessons' }}</label>
                        <input type="number" v-model.number="enrollForm.generate_count" min="1" max="100"
                            class="px-5 py-4 text-lg font-bold bg-gray-50 border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all text-gray-700 shadow-sm">
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="p-8 border-t border-gray-50 shrink-0 bg-gray-50/50 flex gap-4">
                <button @click="emit('close')"
                    class="flex-1 px-8 py-4 text-base font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="submitEnrollment()" :disabled="isSubmitting"
                    class="flex-1 px-8 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3 font-black shadow-xl shadow-emerald-100 active:scale-95 cursor-pointer uppercase tracking-widest">
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
