<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CourseProgressGapHint, { type ProgressGapHintLesson } from './CourseProgressGapHint.vue'

export type QuickAttendanceStatus = 'pending' | 'present' | 'absent'

export interface QuickAttendanceStudent {
    id: string
    name: string
    currentCourse: string
    status: QuickAttendanceStatus
    isSaving: boolean
    disabled?: boolean
    disabledReason?: string
    progressGaps?: ProgressGapHintLesson[]
}

const props = withDefaults(defineProps<{
    students: QuickAttendanceStudent[]
    selectedIds: string[]
    counts: Record<QuickAttendanceStatus, number>
    expanded?: boolean
    disabled?: boolean
    emptyMessage: string
    showClearFilters?: boolean
}>(), {
    expanded: true,
    disabled: false,
    showClearFilters: false
})

const emit = defineEmits<{
    'set-attendance': [studentId: string, status: QuickAttendanceStatus]
    'batch-set-attendance': [status: QuickAttendanceStatus]
    'toggle-selection': [studentId: string]
    'toggle-select-all': []
    'update:expanded': [expanded: boolean]
    'add-student': []
    'clear-filters': []
    'focus-student': [studentId: string]
}>()

const { t } = useI18n()
const selectedSet = computed(() => new Set(props.selectedIds))
const selectableStudents = computed(() => props.students.filter(student => !student.disabled))
const allVisibleSelected = computed(() => selectableStudents.value.length > 0 && selectableStudents.value.every(student => selectedSet.value.has(student.id)))

const statuses: QuickAttendanceStatus[] = ['pending', 'present', 'absent']

function requestAttendance(student: QuickAttendanceStudent, status: QuickAttendanceStatus) {
    if (student.status === status || student.isSaving || student.disabled || props.disabled) return
    emit('set-attendance', student.id, status)
}

function statusClass(status: QuickAttendanceStatus, active: boolean): string {
    if (!active) return 'border-gray-100 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
    if (status === 'present') return 'border-emerald-600 bg-emerald-600 text-white'
    if (status === 'absent') return 'border-red-600 bg-red-600 text-white'
    return 'border-gray-700 bg-gray-700 text-white'
}
</script>

<template>
    <section class="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <header class="space-y-5 p-5 sm:p-6 md:p-8">
            <div class="flex flex-wrap items-start justify-between gap-4">
                <button type="button" class="flex min-w-0 items-center gap-4 text-left" @click="emit('update:expanded', !expanded)"
                    :aria-expanded="expanded">
                    <span class="shrink-0 rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                        <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </span>
                    <span class="min-w-0">
                        <span class="block text-xl font-black text-gray-900">{{ t('classroom.quick_attendance_title') }}</span>
                        <span class="block text-xs font-bold text-gray-400">{{ t('classroom.quick_attendance_subtitle') }}</span>
                    </span>
                </button>
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" class="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-50"
                        @click="emit('add-student')">
                        {{ t('classroom.add_student_to_class') }}
                    </button>
                    <button type="button" class="rounded-xl bg-gray-50 p-2 text-gray-400" @click="emit('update:expanded', !expanded)"
                        :aria-label="t('classroom.quick_attendance_title')" :aria-expanded="expanded">
                        <svg class="h-5 w-5 transition-transform" :class="expanded ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Attendance summary">
                <div class="min-w-0 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 sm:px-4">
                    <p class="truncate text-[10px] font-black uppercase tracking-wider text-emerald-700">{{ t('classroom.attendance_present_count') }}</p>
                    <p class="mt-1 text-2xl font-black text-emerald-700">{{ counts.present }}</p>
                </div>
                <div class="min-w-0 rounded-2xl border border-gray-100 bg-gray-50 px-3 py-3 sm:px-4">
                    <p class="truncate text-[10px] font-black uppercase tracking-wider text-gray-500">{{ t('classroom.attendance_pending_count') }}</p>
                    <p class="mt-1 text-2xl font-black text-gray-700">{{ counts.pending }}</p>
                </div>
                <div class="min-w-0 rounded-2xl border border-red-100 bg-red-50 px-3 py-3 sm:px-4">
                    <p class="truncate text-[10px] font-black uppercase tracking-wider text-red-700">{{ t('classroom.attendance_absent_count') }}</p>
                    <p class="mt-1 text-2xl font-black text-red-700">{{ counts.absent }}</p>
                </div>
            </div>
        </header>

        <div v-show="expanded" class="space-y-5 border-t border-gray-50 px-5 pb-6 pt-5 sm:px-6 md:px-8 md:pb-8">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" class="rounded-xl border px-4 py-2 text-xs font-black transition"
                        :class="allVisibleSelected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-100 bg-white text-gray-500 hover:bg-gray-50'"
                        :disabled="selectableStudents.length === 0" @click="emit('toggle-select-all')">
                        {{ allVisibleSelected ? t('common.deselect_all') : t('common.select_all') }}
                    </button>
                    <span class="text-xs font-black text-gray-400">{{ selectedIds.length }} {{ t('common.selected') }}</span>
                </div>
                <div class="flex flex-1 flex-wrap justify-end gap-2">
                    <button v-for="status in statuses" :key="status" type="button"
                        class="min-w-[6rem] flex-1 rounded-xl border px-3 py-2 text-xs font-black transition sm:flex-none"
                        :class="statusClass(status, true)" :disabled="disabled || selectedIds.length === 0"
                        :title="disabled ? t('classroom.attendance_action_disabled') : undefined"
                        @click="emit('batch-set-attendance', status)">
                        {{ t(`attendance.${status}`) }}
                    </button>
                </div>
            </div>

            <div v-if="students.length === 0" class="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <p class="font-black text-gray-500">{{ emptyMessage }}</p>
                <button v-if="showClearFilters" type="button" class="mt-3 rounded-xl bg-white px-4 py-2 text-xs font-black text-emerald-700 shadow-sm hover:bg-emerald-50"
                    @click="emit('clear-filters')">
                    {{ t('classroom.clear_student_filters') }}
                </button>
            </div>

            <div v-else class="attendance-grid">
                <article v-for="student in students" :key="student.id" :data-student-id="student.id" class="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div class="flex min-w-0 items-start gap-3">
                        <input type="checkbox" class="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                            :checked="selectedSet.has(student.id)" :aria-label="`${t('classroom.attendance_select_student')} ${student.name}`"
                            :disabled="student.disabled" :title="student.disabledReason"
                            @change="emit('toggle-selection', student.id)">
                        <div class="min-w-0 flex-1">
                            <button type="button" class="max-w-full break-words text-left text-base font-black text-gray-900 underline-offset-4 transition hover:text-emerald-700 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                                :aria-label="`${t('classroom.student_name')}: ${student.name}`" @click="emit('focus-student', student.id)">
                                {{ student.name }}
                            </button>
                            <p class="mt-1 break-words text-xs font-bold text-slate-500">{{ student.currentCourse }}</p>
                            <CourseProgressGapHint :lessons="student.progressGaps || []" />
                            <p class="mt-1 text-xs font-bold" :class="student.status === 'present' ? 'text-emerald-600' : student.status === 'absent' ? 'text-red-600' : 'text-gray-400'">
                                {{ student.disabled ? student.disabledReason : t(`attendance.${student.status}`) + ' · ' + (student.isSaving ? t('common.saving') : t('classroom.attendance_saved')) }}
                            </p>
                        </div>
                    </div>
                    <div class="mt-4 grid grid-cols-3 gap-2" role="group" :aria-label="`${student.name} ${t('classroom.quick_attendance_title')}`">
                        <button v-for="status in statuses" :key="status" type="button"
                            class="min-w-0 rounded-xl border px-2 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                            :data-attendance-status="status" :class="statusClass(status, student.status === status)" :aria-pressed="student.status === status"
                            :aria-label="`${student.name}: ${t(`attendance.${status}`)}`"
                            :disabled="disabled || student.isSaving || student.disabled" :title="student.disabledReason || (student.isSaving ? t('common.saving') : disabled ? t('classroom.attendance_action_disabled') : undefined)"
                            @click="requestAttendance(student, status)">
                            {{ t(`attendance.${status}`) }}
                        </button>
                    </div>
                </article>
            </div>
        </div>
    </section>
</template>

<style scoped>
.attendance-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: 0.75rem;
}
</style>
