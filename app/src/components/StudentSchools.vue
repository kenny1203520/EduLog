<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { StudentService } from '@/services/student/StudentService'
import { useStudentStore } from '@/stores/useStudentStore'
import { copyToClipboard as copyToClipboardUtil } from '@/utils/clipboard'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'

const props = defineProps<{
    studentId: string
    schools: any[]
}>()

const { t } = useI18n()
const toast = useToast()
const studentStore = useStudentStore()
const preferences = usePreferencesStore()

const isModifying = ref(false)
const isAddFormOpen = ref(false)
const newSchool = ref({ name: '', status: '', grade: '', class: '', start_date: '', end_date: '', time_zone: preferences.timeZone, school_student_id: '' })
const editingSchoolId = ref<string | null>(null)
const editSchoolForm = ref({ name: '', status: '', grade: '', class: '', start_date: '', end_date: '', time_zone: preferences.timeZone, school_student_id: '' })

// Confirm Modal state for deletion
const showDeleteConfirm = ref(false)
const schoolToDelete = ref<string | null>(null)

const schoolStatusOptions = computed(() => [
    { label: t('student.schools.status_options.enrolled'), value: 'enrolled' },
    { label: t('student.schools.status_options.graduated'), value: 'graduated' },
    { label: t('student.schools.status_options.incomplete'), value: 'incomplete' },
    { label: t('student.schools.status_options.suspended'), value: 'suspended' }
])

function resetNewSchoolForm() {
    newSchool.value = { name: '', status: '', grade: '', class: '', start_date: '', end_date: '', time_zone: preferences.timeZone, school_student_id: '' }
}

function closeAddSchoolForm() {
    isAddFormOpen.value = false
    resetNewSchoolForm()
}

async function addSchool() {
    if (!newSchool.value.status) {
        toast.error(t('student.schools.status') + ' is required')
        return
    }

    if (newSchool.value.status === 'enrolled') {
        if (!newSchool.value.grade) {
            toast.error(t('student.schools.grade_required'))
            return
        }
        if (!newSchool.value.start_date) {
            toast.error(t('student.schools.start_date') + ' is required for Enrolled status')
            return
        }
    } else {
        if (!newSchool.value.start_date || !newSchool.value.end_date) {
            toast.error(t('student.schools.start_date') + ' and ' + t('student.schools.end_date') + ' are required')
            return
        }
    }

    try {
        isModifying.value = true
        await StudentService.addSchool({ ...newSchool.value, student_id: props.studentId })
        closeAddSchoolForm()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('student.schools.add_btn') + ' ' + t('common.success'))
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || t('student.schools.add_failed', 'Failed to add school'))
    } finally {
        isModifying.value = false
    }
}

function startEditSchool(school: any) {
    editingSchoolId.value = school.id
    editSchoolForm.value = { ...school, time_zone: school.time_zone || preferences.timeZone }
}

function cancelEditSchool() {
    editingSchoolId.value = null
    editSchoolForm.value = { name: '', status: '', grade: '', class: '', start_date: '', end_date: '', time_zone: preferences.timeZone, school_student_id: '' }
}

async function saveSchool() {
    if (!editingSchoolId.value) return

    if (!editSchoolForm.value.status) {
        toast.error(t('student.schools.status') + ' is required')
        return
    }
    if (editSchoolForm.value.status === 'enrolled') {
        if (!editSchoolForm.value.grade) {
            toast.error(t('student.schools.grade_required'))
            return
        }
        if (!editSchoolForm.value.start_date) {
            toast.error(t('student.schools.start_date') + ' is required for Enrolled status')
            return
        }
    } else {
        if (!editSchoolForm.value.start_date || !editSchoolForm.value.end_date) {
            toast.error(t('student.schools.start_date') + ' and ' + t('student.schools.end_date') + ' are required')
            return
        }
    }

    try {
        isModifying.value = true
        await StudentService.updateSchool(editingSchoolId.value, editSchoolForm.value)
        cancelEditSchool()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.save_success'))
    } catch (e) {
        console.error(e)
        toast.error(t('student.schools.update_failed', 'Failed to update school'))
    } finally {
        isModifying.value = false
    }
}

function confirmDeleteSchool(id: string) {
    schoolToDelete.value = id
    showDeleteConfirm.value = true
}

async function handleDeleteSchool() {
    if (!schoolToDelete.value) return
    try {
        isModifying.value = true
        await StudentService.deleteSchool(schoolToDelete.value)
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.deleted'))
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || t('student.schools.delete_failed', 'Failed to delete school'))
    } finally {
        isModifying.value = false
        showDeleteConfirm.value = false
        schoolToDelete.value = null
    }
}

async function copyToClipboard(text: string) {
    if (!text) return
    const success = await copyToClipboardUtil(text)
    if (success) {
        toast.success(t('common.copy_success'))
    } else {
        toast.error(t('common.copy_error', 'Failed to copy to clipboard'))
    }
}

function formatSchoolDate(date: string | undefined, timeZone?: string) {
    return date ? DateUtils.displayDate(date, preferences.locale, timeZone || preferences.timeZone) : ''
}
</script>

<template>
    <section class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
        <h2 class="text-2xl font-bold mb-8 flex items-center gap-3 text-gray-800">
            <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="M4.26 10.147a60.436 60.436 0 0 0-.491 6.347A48.627 48.627 0 0 1 12 20.904a48.627 48.627 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.57 50.57 0 0 0-2.658-.813A59.905 59.905 0 0 1 12 3.493a59.902 59.902 0 0 1 10.499 5.516 50.548 50.548 0 0 0-2.658.813m-15.482 0A50.697 50.697 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                </svg>
            </div>
            {{ $t('student.sections.schools') }}
        </h2>

        <ul class="space-y-4 mb-8">
            <li v-for="s in schools" :key="s.id"
                class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
                <div v-if="editingSchoolId !== s.id" class="flex justify-between items-start">
                    <div class="space-y-2">
                        <div>
                            <div class="font-bold text-gray-800 text-xl">{{ s.name }}</div>

                            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
                                <div v-if="s.school_student_id"
                                    class="flex items-center gap-2 text-base font-bold text-gray-800 group">
                                    <span
                                        class="text-sm font-black text-gray-400 uppercase tracking-widest bg-gray-100 px-2 py-1 rounded border border-gray-200 inline-block mb-1">{{
                                            $t('student.schools.school_student_id') }}</span>
                                    <span class="font-mono text-gray-800 font-medium">{{ s.school_student_id
                                    }}</span>
                                    <button @click="copyToClipboard(s.school_student_id)"
                                        class="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
                                        :title="$t('common.copy')">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                            stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                            <path stroke-linecap="round" stroke-linejoin="round"
                                                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                        </svg>
                                    </button>
                                </div>

                                <div v-if="s.status === 'enrolled' && s.grade"
                                    class="flex items-center gap-2 text-base font-bold text-gray-800">
                                    <span
                                        class="text-sm font-black text-gray-400 uppercase tracking-widest bg-gray-100 px-2 py-1 rounded border border-gray-200 inline-block mb-1">{{
                                            $t('student.schools.grade') }}</span>
                                    <span class="font-medium text-gray-800">{{ s.grade }}</span>
                                </div>

                                <div v-if="s.status === 'enrolled' && s.class"
                                    class="flex items-center gap-2 text-base font-bold text-gray-800">
                                    <span
                                        class="text-sm font-black text-gray-400 uppercase tracking-widest bg-gray-100 px-2 py-1 rounded border border-gray-200 inline-block mb-1">{{
                                            $t('student.schools.class') }}</span>
                                    <span class="font-medium text-gray-800">{{ s.class }}</span>
                                </div>
                            </div>
                        </div>

                        <div class="flex flex-wrap items-center gap-3 mt-4">
                            <span v-if="s.status"
                                :class="[
                                    'px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest border',
                                    s.status === 'enrolled' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                                    'bg-gray-100 text-gray-500 border-gray-200'
                                ]">
                                {{ $t(`student.schools.status_options.${s.status}`) }}
                            </span>
                            <span
                                class="bg-white border border-gray-100 text-gray-500 px-3 py-1 rounded-full text-sm font-bold flex items-center gap-2 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="2" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v7.5" />
                                </svg>
                                {{ formatSchoolDate(s.start_date, s.time_zone) }} - {{ s.end_date ? formatSchoolDate(s.end_date, s.time_zone) : $t('student.schools.present') }}
                                <span class="text-[12px] text-gray-400 font-medium">({{ s.time_zone || 'Asia/Taipei' }})</span>
                            </span>
                        </div>
                    </div>
                    <div class="flex space-x-1">
                        <button @click="startEditSchool(s)"
                            class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            :title="$t('common.edit')">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                            </svg>
                        </button>
                        <button @click="confirmDeleteSchool(s.id!)"
                            class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            :title="$t('common.delete')">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Edit Mode -->
                <div v-else class="space-y-4">
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div class="min-w-0 space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.schools.name') }}</label>
                            <input v-model="editSchoolForm.name"
                                class="w-full px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200">
                        </div>
                        <div class="min-w-0 space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.schools.status') }}</label>
                            <BaseDropdown v-model="editSchoolForm.status" :options="schoolStatusOptions"
                                theme="emerald" />
                        </div>
                    </div>

                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div class="min-w-0 space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.schools.school_student_id') }}</label>
                            <input v-model="editSchoolForm.school_student_id"
                                class="w-full px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200">
                        </div>

                        <div class="grid min-w-0 grid-cols-2 gap-4">
                            <div class="space-y-1">
                                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                    $t('student.schools.grade') }}</label>
                                <input v-model="editSchoolForm.grade"
                                    :disabled="editSchoolForm.status !== 'enrolled'"
                                    :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''"
                                    class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                            </div>
                            <div class="space-y-1">
                                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                    $t('student.schools.class') }}</label>
                                <input v-model="editSchoolForm.class"
                                    :disabled="editSchoolForm.status !== 'enrolled'"
                                    :placeholder="editSchoolForm.status !== 'enrolled' ? '-' : ''"
                                    class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.schools.start_date') }}</label>
                            <input type="date" v-model="editSchoolForm.start_date"
                                class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            <p v-if="editSchoolForm.status === 'enrolled'"
                                class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required')
                                }}</p>
                        </div>

                        <div class="space-y-1">
                            <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                                $t('student.schools.end_date') }}</label>
                            <input type="date" v-model="editSchoolForm.end_date"
                                class="w-full border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                            <p class="text-[10px] text-gray-400 text-right mt-0.5">{{
                                $t('student.schools.present') }}</p>
                        </div>
                    </div>

                    <TimeZoneSelect v-model="editSchoolForm.time_zone" :label="$t('common.time_zone')" dense />

                    <div class="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                        <button @click="cancelEditSchool"
                            class="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 hover:bg-gray-100 rounded transition-colors cursor-pointer">{{
                                $t('student.cancel') }}</button>
                        <button @click="saveSchool" :disabled="isModifying"
                            class="px-8 py-2.5 bg-emerald-600 text-white rounded-xl text-base font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            <svg v-if="isModifying" class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            {{ $t('student.save_details') }}
                        </button>
                    </div>
                </div>
            </li>
        </ul>

        <div class="border-t border-gray-100 pt-8 mt-4">
            <button type="button" data-testid="student-school-add-toggle" @click="isAddFormOpen = !isAddFormOpen"
                class="mb-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-black uppercase tracking-widest text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700">
                <span class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    {{ $t('student.schools.add_title') }}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                    :class="{ 'rotate-180': isAddFormOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
                </svg>
            </button>

            <div
                v-if="isAddFormOpen" data-testid="student-school-add-form"
                class="bg-gray-50 p-4 rounded-xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
                <div class="grid grid-cols-2 md:grid-cols-2 gap-4 mb-4">
                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.schools.name') }}</label>
                        <input v-model="newSchool.name"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                    </div>
                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.schools.status') }}</label>
                        <BaseDropdown v-model="newSchool.status" :options="schoolStatusOptions"
                            theme="emerald" />
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.schools.school_student_id') }}</label>
                        <input v-model="newSchool.school_student_id"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none">
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                $t('student.schools.grade') }}</label>
                            <input v-model="newSchool.grade" :disabled="newSchool.status !== 'enrolled'"
                                :placeholder="newSchool.status !== 'enrolled' ? '-' : ''"
                                class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                                $t('student.schools.class') }}</label>
                            <input v-model="newSchool.class" :disabled="newSchool.status !== 'enrolled'"
                                :placeholder="newSchool.status !== 'enrolled' ? '-' : ''"
                                class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-emerald-500 outline-none transition-colors">
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.schools.start_date') }}</label>
                        <input type="date" v-model="newSchool.start_date"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                        <p v-if="newSchool.status === 'enrolled'"
                            class="text-[10px] text-red-500 text-right mt-0.5">* {{ $t('student.required') }}
                        </p>
                    </div>

                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{{
                            $t('student.schools.end_date') }}</label>
                        <input type="date" v-model="newSchool.end_date"
                            class="w-full border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:ring-2 focus:ring-emerald-500 outline-none">
                        <p class="text-[10px] text-gray-400 text-right mt-0.5">{{ $t('student.schools.present')
                        }}</p>
                    </div>
                </div>

                <div class="mb-4">
                    <TimeZoneSelect v-model="newSchool.time_zone" :label="$t('common.time_zone')" dense />
                </div>

                <div class="flex flex-col gap-3 sm:flex-row">
                    <button @click="closeAddSchoolForm" :disabled="isModifying"
                        class="w-full rounded-xl border border-gray-200 bg-white py-4 text-base font-black uppercase tracking-widest text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-50 sm:w-40">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="addSchool" :disabled="isModifying"
                        class="w-full bg-emerald-600 text-white py-4 rounded-xl hover:bg-emerald-700 text-base font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-50 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <svg v-if="isModifying" class="animate-spin h-4 w-4 text-emerald-600" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                            stroke-width="2" stroke="currentColor" class="w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        {{ $t('student.schools.add_btn') }}
                    </button>
                </div>
            </div>
        </div>

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.schools.delete')"
            :message="$t('student.schools.confirm_delete')" :confirm-text="$t('common.delete')" :is-dangerous="true"
            :is-loading="isModifying" @close="showDeleteConfirm = false" @confirm="handleDeleteSchool" />
    </section>
</template>
