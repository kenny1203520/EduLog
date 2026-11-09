<script setup lang="ts">
import { ref } from 'vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import type { Enrollment } from '@/models/Enrollment'

type Option = { label: string; value: string | null }

defineProps<{
    submitError: string
    busy: boolean
    studentOptions: Option[]
    enrollmentOptions: Option[]
    selectedEnrollment: Enrollment | null
}>()

const emit = defineEmits<{
    close: []
    submit: []
    'student-change': []
}>()

const search = defineModel<string>('search', { required: true })
const studentId = defineModel<string | null>('studentId', { required: true })
const enrollmentId = defineModel<string | null>('enrollmentId', { required: true })
const joinDate = defineModel<string>('joinDate', { required: true })

const makeupSubmitErrorElement = ref<HTMLElement | null>(null)

defineExpose({
    focusSubmitError: () => makeupSubmitErrorElement.value?.focus()
})
</script>

<template>
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div
            role="dialog" aria-modal="true" aria-labelledby="makeup-add-student-title"
            class="bg-white rounded-2xl flex flex-col w-full max-w-2xl max-h-[85vh] shadow-2xl m-4 overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 id="makeup-add-student-title" class="text-xl font-bold text-gray-900">{{ $t('classroom.add_student_modal_title') }}</h3>
                <button @click="emit('close')" :aria-label="$t('common.close')" class="text-gray-400 hover:text-gray-600 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-6 space-y-5">
                <p class="text-sm text-gray-500">{{ $t('classroom.add_student_modal_hint') }}</p>

                <div v-if="submitError" ref="makeupSubmitErrorElement" role="alert" tabindex="-1"
                    class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium leading-6 text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500">
                    {{ submitError }}
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-531-43853">{{ $t('classroom.add_student_search')
                    }}</label>
                    <input v-model="search" type="text"
                        :placeholder="$t('classroom.add_student_search_placeholder')"
                        class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"  id="edulog-sessiondetailsview-531-43853"/>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-539-44367">{{ $t('classroom.add_student_student')
                    }}</label>
                    <BaseDropdown v-model="studentId" :options="studentOptions"
                        :placeholder="$t('classroom.add_student_select_student_placeholder')" theme="emerald"
                        @change="emit('student-change')" :disabled="busy"  id="edulog-sessiondetailsview-539-44367"/>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-547-44890">{{ $t('classroom.add_student_course')
                    }}</label>
                    <BaseDropdown v-model="enrollmentId" :options="enrollmentOptions"
                        :placeholder="$t('classroom.add_student_select_course_placeholder')" theme="emerald"
                        :disabled="busy || !studentId"  id="edulog-sessiondetailsview-547-44890"/>
                </div>

                <div>
                    <label class="block text-sm font-bold text-gray-700 mb-2" for="edulog-sessiondetailsview-555-45409">{{
                        $t('classroom.add_student_join_date') }}</label>
                    <input type="date" v-model="joinDate"
                        class="w-full border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"  id="edulog-sessiondetailsview-555-45409"/>
                </div>

                <div v-if="selectedEnrollment" class="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
                    <p class="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-2">{{
                        $t('classroom.add_student_selected_summary') }}</p>
                    <p class="text-sm text-emerald-900 font-semibold">{{ selectedEnrollment.studentName }}</p>
                    <p class="text-xs text-emerald-800 mt-1">{{ selectedEnrollment.courseDisplayName ||
                        `${selectedEnrollment.courseSubject} ${selectedEnrollment.courseStage}` }}</p>
                    <p class="text-xs text-emerald-700 mt-1">{{ selectedEnrollment.classSessionName ||
                        $t('classroom.session') }}</p>
                </div>
            </div>

            <div class="px-6 py-5 border-t border-gray-100 flex justify-end gap-3 bg-gray-50/50">
                <button @click="emit('close')"
                    class="px-5 py-2.5 text-gray-600 hover:bg-gray-200/60 font-bold rounded-xl transition-all">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="emit('submit')"
                    :disabled="busy || !enrollmentId || !joinDate"
                    class="px-8 py-2.5 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                    <svg v-if="busy" class="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    {{ $t('classroom.add_student_submit') }}
                </button>
            </div>
        </div>
    </div>
</template>
