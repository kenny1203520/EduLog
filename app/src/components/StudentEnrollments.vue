<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toastification";
import { EnrollmentService } from "@/services/enrollment/EnrollmentService";
import { useStudentStore } from "@/stores/useStudentStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import EnrollStudentModal from "@/components/EnrollStudentModal.vue";
import TransferModal from "@/components/TransferModal.vue";
import ActivateTrialModal from "@/components/ActivateTrialModal.vue";
import StudentSuspensions from "@/components/StudentSuspensions.vue";
import ConfirmModal from "@/components/common/ConfirmModal.vue";
import TimeZoneSelect from "@/components/common/TimeZoneSelect.vue";
import KodingCodeCheckModal from "@/components/KodingCodeCheckModal.vue";

const props = defineProps<{
    studentId: string;
    enrollments: any[];
}>();

const { t } = useI18n();
const toast = useToast();
const studentStore = useStudentStore();
const preferences = usePreferencesStore();

const isModifying = ref(false);
const editingEnrollmentId = ref<string | null>(null);
const editEnrollmentForm = ref({
    enrollment_type: "",
    start_date: "",
    external_link: "",
    koding_admission_id: "",
    time_zone: "",
});

// Modal States
const showEnrollModal = ref(false);
const showTransferModal = ref(false);
const showActivateTrialModal = ref(false);
const showSuspensionsModal = ref(false);
const showKodingCheckModal = ref(false);
const selectedEnrollmentId = ref<string | null>(null);
const selectedKodingEnrollment = ref<any | null>(null);

// Deletion
const showDeleteConfirm = ref(false);
const enrollmentToDelete = ref<string | null>(null);

function startEditEnrollment(enrollment: any) {
    editingEnrollmentId.value = enrollment.id;
    editEnrollmentForm.value = {
        enrollment_type: enrollment.status,
        start_date: enrollment.startDate || enrollment.start_date,
        external_link: enrollment.externalLink || enrollment.external_link || "",
        koding_admission_id: enrollment.kodingAdmissionId || enrollment.koding_admission_id || "",
        time_zone: enrollment.timeZone || preferences.timeZone,
    };
}

function cancelEditEnrollment() {
    editingEnrollmentId.value = null;
}

async function saveEnrollment() {
    if (!editingEnrollmentId.value) return;
    try {
        isModifying.value = true;
        await EnrollmentService.update(editingEnrollmentId.value, {
            status: editEnrollmentForm.value.enrollment_type as any,
            start_date: editEnrollmentForm.value.start_date,
            time_zone: editEnrollmentForm.value.time_zone,
            external_link: editEnrollmentForm.value.external_link,
            koding_admission_id: editEnrollmentForm.value.koding_admission_id,
        });

        cancelEditEnrollment();
        await studentStore.loadStudent(props.studentId);
        toast.success(t("common.save_success"));
    } catch (e: any) {
        console.error(e);
        toast.error(
            e.message ||
            t(
                "student.errors.update_enrollment_failed",
                "Failed to update enrollment",
            ),
        );
    } finally {
        isModifying.value = false;
    }
}

function confirmRemoveEnrollment(id: string) {
    enrollmentToDelete.value = id;
    showDeleteConfirm.value = true;
}

async function handleRemoveEnrollment() {
    if (!enrollmentToDelete.value) return;
    try {
        isModifying.value = true;
        await EnrollmentService.delete(enrollmentToDelete.value);
        await studentStore.loadStudent(props.studentId);
        toast.success(t("common.deleted"));
    } catch (e: any) {
        console.error(e);
        toast.error(
            e.message ||
            t(
                "student.errors.delete_enrollment_failed",
                "Failed to remove enrollment",
            ),
        );
    } finally {
        isModifying.value = false;
        showDeleteConfirm.value = false;
        enrollmentToDelete.value = null;
    }
}

function openTransfer(id: string) {
    selectedEnrollmentId.value = id;
    showTransferModal.value = true;
}

function openActivateTrial(id: string) {
    selectedEnrollmentId.value = id;
    showActivateTrialModal.value = true;
}

function openSuspensions(id: string) {
    selectedEnrollmentId.value = id;
    showSuspensionsModal.value = true;
}

function openKodingCheck(enrollment: any) {
    selectedKodingEnrollment.value = enrollment;
    showKodingCheckModal.value = true;
}

const kodingCheckTarget = computed(() => {
    if (!selectedKodingEnrollment.value) return null;
    return {
        ...selectedKodingEnrollment.value,
        studentName: studentStore.currentStudent?.displayName || studentStore.currentStudent?.name || "",
        courseDisplayName: selectedKodingEnrollment.value.courseDisplayName || selectedKodingEnrollment.value.displayName,
    };
});

async function refreshData() {
    await studentStore.loadStudent(props.studentId);
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
                {{ $t("student.sections.internal_courses") }}
            </h2>
        </div>

        <div v-if="enrollments.length === 0"
            class="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 font-medium italic mb-6">
            {{ $t("student.internal_courses.no_enrollments") }}
        </div>

        <div v-else class="grid grid-cols-1 gap-4 mb-6">
            <div v-for="e in enrollments" :key="e.id"
                class="bg-gray-50 p-4 sm:p-6 rounded-2xl border border-transparent hover:border-emerald-100 transition-all group hover:shadow-lg hover:shadow-emerald-50/50">
                <div v-if="editingEnrollmentId !== e.id">
                    <div class="space-y-4">
                        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div class="min-w-0 flex-1 space-y-3">
                            <div>
                                <div class="min-w-0 break-words font-black text-gray-900 text-xl sm:text-2xl tracking-tight leading-tight">
                                    {{ e.courseDisplayName || e.courseSubject }}
                                </div>
                                <div
                                    class="min-w-0 text-sm font-bold text-gray-500 mt-2 flex flex-wrap gap-x-2 gap-y-1 leading-relaxed">
                                    <span>{{ e.classroomName || "No Classroom" }}</span>
                                    <span v-if="e.classSessionName || e.formattedSchedule"
                                        class="text-gray-300">•</span>
                                    <span>{{ e.classSessionName }}</span>
                                    <span v-if="e.classSessionDayKey" class="ml-1">
                                        {{ $t(`common.days.${e.classSessionDayKey}`) }}
                                        {{ e.classSessionStartTime?.slice(0, 5) }} -
                                        {{ e.classSessionEndTime?.slice(0, 5) }}
                                    </span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-3">
                                <span v-if="e.status" :class="[
                                    'px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border',
                                    e.status === 'regular'
                                        ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                        : e.status === 'trial'
                                            ? 'bg-blue-50 text-blue-600 border-blue-100'
                                            : e.status === 'completed'
                                                ? 'bg-gray-100 text-gray-600 border-gray-200'
                                                : 'bg-rose-50 text-rose-600 border-rose-100',
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
                                    <span class="text-[12px] text-gray-400 font-medium">({{ e.timeZone || 'Asia/Taipei'
                                        }})</span>
                                </span>
                            </div>
                        </div>

                        <div class="flex shrink-0 items-center justify-end gap-1 lg:pt-1">
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
                        </div>

                        <div
                            class="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                                <router-link :to="{ name: 'lesson-reports', params: { enrollmentId: e.id } }" target="_blank" rel="noopener noreferrer" :title="$t('student.internal_courses.view_reports') + ' · ' + $t('common.opens_new_tab')"
                                    class="inline-flex min-h-11 w-full justify-center whitespace-normal text-center leading-tight px-3 py-2 bg-emerald-600 border border-emerald-600 text-white text-sm font-black rounded-xl hover:bg-emerald-700 transition-all shadow-sm cursor-pointer active:scale-95 items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                                    </svg>
                                    {{ $t("student.internal_courses.view_reports") }}
                                    <svg class="h-3.5 w-3.5 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3h7m0 0v7m0-7L10 14" /></svg>
                                </router-link>
                                <a v-if="e.externalLink"
                                    :href="e.externalLink"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="inline-flex min-h-11 w-full justify-center whitespace-normal text-center leading-tight px-3 py-2 bg-white border border-blue-100 text-blue-600 text-sm font-black rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm cursor-pointer active:scale-95 items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                                    </svg>
                                    {{ $t("student.internal_courses.external_overview") }}
                                </a>
                                <button @click="openTransfer(e.id)"
                                    class="inline-flex min-h-11 w-full items-center justify-center whitespace-normal text-center leading-tight px-3 py-2 bg-white border border-amber-100 text-amber-600 text-sm font-black rounded-xl hover:bg-amber-50 hover:border-amber-200 transition-all shadow-sm cursor-pointer active:scale-95">
                                    {{ $t("student.internal_courses.transfer_btn") }}
                                </button>
                                <button @click="openKodingCheck(e)"
                                    class="inline-flex min-h-11 w-full items-center justify-center whitespace-normal text-center leading-tight px-3 py-2 bg-white border border-orange-100 text-orange-600 text-sm font-black rounded-xl hover:bg-orange-50 hover:border-orange-200 transition-all shadow-sm cursor-pointer active:scale-95">
                                    {{ $t("classroom.koding_check") }}
                                </button>
                                <button v-if="e.status === 'trial'" @click="openActivateTrial(e.id)"
                                    class="inline-flex min-h-11 w-full items-center justify-center whitespace-normal text-center leading-tight px-3 py-2 bg-white border border-blue-100 text-blue-600 text-sm font-black rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all shadow-sm cursor-pointer active:scale-95">
                                    {{ $t("student.activate_trial_btn") }}
                                </button>
                        </div>
                    </div>
                </div>

                <!-- Edit Mode -->
                <div v-else class="space-y-4">
                    <div class="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                        <p class="text-xs font-black text-emerald-600 uppercase tracking-widest mb-2">
                            {{ $t("student.internal_courses.edit_enrollment") }}
                        </p>
                        <h3 class="text-xl font-black text-gray-900 leading-tight break-words">
                            {{ e.courseDisplayName || e.courseSubject }}
                        </h3>
                        <p class="mt-2 text-sm font-bold text-gray-500 leading-relaxed break-words">
                            <span>{{ e.classroomName || "No Classroom" }}</span>
                            <span v-if="e.classSessionName || e.formattedSchedule" class="mx-2 text-gray-300">•</span>
                            <span>{{ e.classSessionName }}</span>
                            <span v-if="e.classSessionDayKey" class="ml-1">
                                {{ $t(`common.days.${e.classSessionDayKey}`) }}
                                {{ e.classSessionStartTime?.slice(0, 5) }} -
                                {{ e.classSessionEndTime?.slice(0, 5) }}
                            </span>
                        </p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t("student.enroll_modal.type") }}</label>
                            <select v-model="editEnrollmentForm.enrollment_type"
                                class="w-full px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all">
                                <option value="regular">
                                    {{ $t("student.internal_courses.status_regular") }}
                                </option>
                                <option value="trial">
                                    {{ $t("student.internal_courses.status_trial") }}
                                </option>
                                <option value="completed">
                                    {{ $t("student.internal_courses.status_completed") }}
                                </option>
                                <option value="dropped">
                                    {{ $t("student.internal_courses.status_dropped") }}
                                </option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t("student.internal_courses.start_date") }}</label>
                            <input type="date" v-model="editEnrollmentForm.start_date"
                                class="w-full px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t("student.internal_courses.external_link") }}</label>
                            <input type="url" v-model="editEnrollmentForm.external_link"
                                class="w-full px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                :placeholder="$t('common.optional')" />
                        </div>
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t("student.internal_courses.koding_admission_id") }}</label>
                            <input type="text" v-model="editEnrollmentForm.koding_admission_id"
                                class="w-full px-4 py-3 text-base font-bold bg-white shadow-sm border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                :placeholder="$t('common.optional')" />
                        </div>
                        <div class="space-y-1">
                            <TimeZoneSelect v-model="editEnrollmentForm.time_zone" :label="$t('common.time_zone')" />
                        </div>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button @click="cancelEditEnrollment"
                            class="px-4 py-2 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                            {{ $t("common.cancel") }}
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
                            {{ $t("common.save") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Add Enrollment Button at the bottom -->
        <button @click="showEnrollModal = true"
            class="w-full py-5 bg-white border-2 border-dashed border-gray-200 rounded-[2.5rem] text-gray-500 text-lg font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600 transition-all cursor-pointer group shadow-sm">
            <div class="p-2 bg-gray-100 rounded-xl group-hover:bg-emerald-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3"
                    stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
            </div>
            {{ $t("student.enroll_btn") }}
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

        <KodingCodeCheckModal :is-open="showKodingCheckModal" :target="kodingCheckTarget"
            @close="showKodingCheckModal = false" />

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.enrollment_delete_title')"
            :message="$t('student.enrollment_delete_message')" :confirm-text="$t('common.delete')" :is-dangerous="true"
            :is-loading="isModifying" @close="showDeleteConfirm = false" @confirm="handleRemoveEnrollment" />
    </section>
</template>
