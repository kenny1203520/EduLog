<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { useStudentStore } from '@/stores/useStudentStore'
import EnrollStudentModal from '@/components/EnrollStudentModal.vue'
import TransferModal from '@/components/TransferModal.vue'
import ActivateTrialModal from '@/components/ActivateTrialModal.vue'
import StudentSuspensions from '@/components/StudentSuspensions.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'

const props = defineProps<{
    studentId: string
    enrollments: any[]
}>()

const { t } = useI18n()
const toast = useToast()
const studentStore = useStudentStore()

const isModifying = ref(false)
const editingEnrollmentId = ref<string | null>(null)
const editEnrollmentForm = ref({ enrollment_type: '', start_date: '', external_link: '' })

// Modal States
const showEnrollModal = ref(false)
const showTransferModal = ref(false)
const showActivateTrialModal = ref(false)
const showSuspensionsModal = ref(false)
const selectedEnrollmentId = ref<string | null>(null)

// Deletion
const showDeleteConfirm = ref(false)
const enrollmentToDelete = ref<string | null>(null)

function startEditEnrollment(enrollment: any) {
    editingEnrollmentId.value = enrollment.id
    editEnrollmentForm.value = {
        enrollment_type: enrollment.status,
        start_date: enrollment.startDate || enrollment.start_date,
        external_link: enrollment.externalLink || enrollment.external_link || ''
    }
}

function cancelEditEnrollment() {
    editingEnrollmentId.value = null
}

async function saveEnrollment() {
    if (!editingEnrollmentId.value) return
    try {
        isModifying.value = true
        await EnrollmentService.update(editingEnrollmentId.value, {
            status: editEnrollmentForm.value.enrollment_type as any,
            start_date: editEnrollmentForm.value.start_date,
            external_link: editEnrollmentForm.value.external_link
        })
        cancelEditEnrollment()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.save_success'))
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || t('student.errors.update_enrollment_failed', 'Failed to update enrollment'))
    } finally {
        isModifying.value = false
    }
}

function confirmRemoveEnrollment(id: string) {
    enrollmentToDelete.value = id
    showDeleteConfirm.value = true
}

async function handleRemoveEnrollment() {
    if (!enrollmentToDelete.value) return
    try {
        isModifying.value = true
        await EnrollmentService.delete(enrollmentToDelete.value)
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.deleted'))
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || t('student.errors.delete_enrollment_failed', 'Failed to remove enrollment'))
    } finally {
        isModifying.value = false
        showDeleteConfirm.value = false
        enrollmentToDelete.value = null
    }
}

function openTransfer(id: string) {
    selectedEnrollmentId.value = id
    showTransferModal.value = true
}

function openActivateTrial(id: string) {
    selectedEnrollmentId.value = id
    showActivateTrialModal.value = true
}

function openSuspensions(id: string) {
    selectedEnrollmentId.value = id
    showSuspensionsModal.value = true
}

async function refreshData() {
    await studentStore.loadStudent(props.studentId)
}
</script>

<template>
    <section class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <div class="flex justify-between items-center mb-8">
            <h2 class="text-2xl font-bold flex items-center gap-3 text-gray-800">
                <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                        stroke="currentColor" class="w-6 h-6">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.25c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                    </svg>
                </div>
                {{ $t('student.sections.internal_courses') }}
            </h2>
        </div>

        <div v-if="enrollments.length === 0"
            class="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 font-medium italic mb-6">
            {{ $t('student.internal_courses.no_enrollments') }}
        </div>

        <div v-else class="grid grid-cols-1 gap-4 mb-6">
            <div v-for="e in enrollments" :key="e.id"
                class="bg-gray-50 p-6 rounded-2xl border border-transparent hover:border-emerald-100 transition-all group hover:shadow-lg hover:shadow-emerald-50/50">
                <div v-if="editingEnrollmentId !== e.id">
                    <div class="flex justify-between items-start">
                        <div class="space-y-3">
                            <div>
                                <div class="font-black text-gray-900 text-2xl tracking-tight leading-tight">
                                    {{ e.courseDisplayName || e.courseSubject }}
                                </div>
                                <div class="text-sm font-bold text-gray-400 uppercase tracking-widest mt-2 flex flex-wrap gap-x-2">
                                    <span>{{ e.classroomName || 'No Classroom' }}</span>
                                    <span v-if="e.classSessionName || e.formattedSchedule" class="text-gray-300">•</span>
                                    <span>{{ e.classSessionName }} {{ e.formattedSchedule }}</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-3">
                                <span v-if="e.status" :class="[
                                    'px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border',
                                    e.status === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                                    e.status === 'trial' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                    e.status === 'completed' ? 'bg-gray-100 text-gray-600 border-gray-200' :
                                    'bg-rose-50 text-rose-600 border-rose-100'
                                ]">
                                    {{ $t(`student.internal_courses.status_${e.status}`) }}
                                </span>
                                <span
                                    class="bg-white border border-gray-100 text-gray-500 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
                                    </svg>
                                    {{ e.formattedStartDate }}
                                </span>
                            </div>
                        </div>

                        <div class="flex flex-col items-end gap-2">
                            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                <button @click="openSuspensions(e.id)"
                                    class="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all cursor-pointer"
                                    title="Suspensions">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M14.25 9v6m-4.5 0V9M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                    </svg>
                                </button>
                                <button @click="startEditEnrollment(e)"
                                    class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all cursor-pointer"
                                    title="Edit">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                    </svg>
                                </button>
                                <button @click="confirmRemoveEnrollment(e.id)"
                                    class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
                                    title="Delete">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="2" stroke="currentColor" class="w-5 h-5">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            </div>

                            <div class="flex gap-2">
                                <button @click="openTransfer(e.id)"
                                    class="px-4 py-2 bg-white border border-amber-100 text-amber-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-amber-50 hover:border-amber-200 transition-all shadow-sm cursor-pointer active:scale-95">
                                    {{ $t('student.internal_courses.transfer_btn') }}
                                </button>
                                <button v-if="e.enrollment_type === 'trial'" @click="openActivateTrial(e.id)"
                                    class="px-4 py-2 bg-white border border-blue-100 text-blue-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm cursor-pointer active:scale-95">
                                    {{ $t('student.activate_trial_btn') }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Edit Mode -->
                <div v-else class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.enroll_modal.type') }}</label>
                            <select v-model="editEnrollmentForm.enrollment_type"
                                class="px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all">
                                <option value="active">{{ $t('student.internal_courses.status_active') }}</option>
                                <option value="trial">{{ $t('student.internal_courses.status_trial') }}</option>
                                <option value="completed">{{ $t('student.internal_courses.status_completed') }}</option>
                                <option value="dropped">{{ $t('student.internal_courses.status_dropped') }}</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.internal_courses.start_date') }}</label>
                            <input type="date" v-model="editEnrollmentForm.start_date"
                                class="px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all">
                        </div>
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.internal_courses.external_link') }}</label>
                            <input type="url" v-model="editEnrollmentForm.external_link"
                                class="px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                :placeholder="$t('common.optional')">
                        </div>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button @click="cancelEditEnrollment"
                            class="px-4 py-2 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                            {{ $t('common.cancel') }}
                        </button>
                        <button @click="saveEnrollment" :disabled="isModifying"
                            class="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-black hover:bg-emerald-700 shadow-lg shadow-emerald-50 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2">
                            <svg v-if="isModifying" class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            {{ $t('common.save') }}
                        </button>
                    </div>
                </div>
        </div>
    </div>

    <!-- Add Enrollment Button at the bottom -->
        <button @click="showEnrollModal = true"
            class="w-full py-8 bg-white border-2 border-dashed border-gray-200 rounded-[2.5rem] text-gray-500 text-lg font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600 transition-all cursor-pointer group shadow-sm">
            <div class="p-2 bg-gray-100 rounded-xl group-hover:bg-emerald-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3"
                    stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
            </div>
            {{ $t('student.enroll_btn') }}
        </button>

        <!-- Modals -->
        <EnrollStudentModal :is-open="showEnrollModal" :student-id="studentId" @close="showEnrollModal = false"
            @success="refreshData" />

        <TransferModal :is-open="showTransferModal" :student-id="studentId" :from-enrollment-id="selectedEnrollmentId"
            @close="showTransferModal = false" @success="refreshData" />

        <ActivateTrialModal :is-open="showActivateTrialModal" :student-id="studentId"
            :from-enrollment-id="selectedEnrollmentId" @close="showActivateTrialModal = false" @success="refreshData" />

        <StudentSuspensions v-if="showSuspensionsModal" :enrollment-id="selectedEnrollmentId!"
            @close="showSuspensionsModal = false" />

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.enrollment_delete_title')"
            :message="$t('student.enrollment_delete_message')" :confirm-text="$t('common.delete')" :is-dangerous="true"
            :is-loading="isModifying" @close="showDeleteConfirm = false" @confirm="handleRemoveEnrollment" />
    </section>
</template>
