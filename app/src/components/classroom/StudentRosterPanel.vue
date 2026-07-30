<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QuickAttendanceStatus } from './QuickAttendancePanel.vue'

export type RosterProgressTone = 'completed' | 'incomplete' | 'empty'

export interface StudentRosterItem {
    id: string
    studentId: string
    name: string
    initials: string
    currentCourse: string
    enrollmentStatus: string
    enrollmentTone: 'regular' | 'trial' | 'inactive'
    isGuest: boolean
    attendanceStatus: QuickAttendanceStatus
    attendanceLabel: string
    isSavingAttendance: boolean
    todayTitle: string
    todayProgress: string
    todayCompletion: string
    todayTone: RosterProgressTone
    highestTitle: string
    highestStatus: string
    highestTone: RosterProgressTone
    latestTitle: string
    latestStatus: string
    latestTone: RosterProgressTone
    isEditing: boolean
}

const props = withDefaults(defineProps<{
    items: StudentRosterItem[]
    resultCount: number
    hasOccurrence?: boolean
    attendanceDisabled?: boolean
    emptyMessage: string
    showClearFilters?: boolean
}>(), {
    hasOccurrence: false,
    attendanceDisabled: false,
    showClearFilters: false
})

const emit = defineEmits<{
    'set-attendance': [studentId: string, status: QuickAttendanceStatus]
    'view-reports': [studentId: string]
    'quick-edit': [studentId: string]
    'koding-check': [studentId: string]
    'view-profile': [studentId: string]
    'clear-filters': []
}>()

const { t } = useI18n()
const hasItems = computed(() => props.items.length > 0)

function progressToneClasses(tone: RosterProgressTone): string {
    if (tone === 'completed') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
    if (tone === 'incomplete') return 'border-red-100 bg-red-50 text-red-700'
    return 'border-slate-200 bg-slate-50 text-slate-500'
}

function enrollmentToneClasses(tone: StudentRosterItem['enrollmentTone']): string {
    if (tone === 'regular') return 'border-emerald-100 bg-emerald-50 text-emerald-700'
    if (tone === 'trial') return 'border-amber-100 bg-amber-50 text-amber-700'
    return 'border-slate-200 bg-slate-50 text-slate-500'
}

function attendanceToneClasses(status: QuickAttendanceStatus): string {
    if (status === 'present') return 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
    if (status === 'absent') return 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
    return 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
}

function nextAttendance(status: QuickAttendanceStatus): QuickAttendanceStatus {
    if (status === 'pending') return 'present'
    if (status === 'present') return 'absent'
    return 'pending'
}

function requestAttendance(item: StudentRosterItem) {
    if (props.attendanceDisabled || item.isSavingAttendance) return
    emit('set-attendance', item.id, nextAttendance(item.attendanceStatus))
}
</script>

<template>
    <section class="roster-container overflow-hidden rounded-[2.5rem] border border-slate-200/80 bg-white shadow-sm">
        <header class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:px-8">
            <div class="min-w-0">
                <div class="flex items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                    </span>
                    <div class="min-w-0">
                        <h3 class="text-lg font-black text-slate-900 sm:text-xl">{{ t('classroom.student_roster_title') }}</h3>
                        <p class="mt-0.5 text-xs font-bold leading-5 text-slate-400">{{ t('classroom.student_roster_subtitle') }}</p>
                    </div>
                </div>
            </div>
            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-right">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.student_filter_result') }}</p>
                <p class="text-lg font-black text-slate-800">{{ resultCount }}</p>
            </div>
        </header>

        <div v-if="!hasItems" class="px-5 py-16 text-center sm:px-8">
            <span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
                <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </span>
            <p class="mt-4 font-black text-slate-500">{{ emptyMessage }}</p>
            <button v-if="showClearFilters" type="button" class="mt-4 rounded-xl bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100"
                @click="emit('clear-filters')">
                {{ t('classroom.clear_student_filters') }}
            </button>
        </div>

        <div v-else class="roster-cards p-4 sm:p-5">
            <article v-for="item in items" :key="item.id" :data-enrollment-id="item.id"
                class="group flex min-w-0 flex-col rounded-3xl border border-slate-200 bg-white p-4 transition hover:border-emerald-200 hover:shadow-lg hover:shadow-emerald-100/40 sm:p-5">
                <div class="flex min-w-0 items-start gap-3">
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-lg font-black text-emerald-700">
                        {{ item.initials }}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <h4 class="break-words text-base font-black text-slate-900 sm:text-lg">{{ item.name }}</h4>
                            <span class="rounded-full border px-2 py-0.5 text-[10px] font-black" :class="enrollmentToneClasses(item.enrollmentTone)">
                                {{ item.enrollmentStatus }}
                            </span>
                            <span v-if="item.isGuest" class="rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-[10px] font-black text-purple-700">
                                {{ t('common.rescheduled') }}
                            </span>
                        </div>
                        <p class="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-500">{{ item.currentCourse }}</p>
                    </div>
                    <button v-if="hasOccurrence" type="button"
                        class="shrink-0 rounded-xl border px-2.5 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                        :class="attendanceToneClasses(item.attendanceStatus)" :disabled="attendanceDisabled || item.isSavingAttendance"
                        :aria-label="`${item.name}: ${item.attendanceLabel}`" @click="requestAttendance(item)">
                        <span class="inline-flex items-center gap-1.5">
                            <span class="h-2 w-2 rounded-full" :class="item.attendanceStatus === 'present' ? 'bg-emerald-500' : item.attendanceStatus === 'absent' ? 'bg-red-500' : 'bg-slate-400'"></span>
                            {{ item.isSavingAttendance ? t('common.saving') : item.attendanceLabel }}
                        </span>
                    </button>
                </div>

                <div class="mt-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0 flex-1">
                            <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.today_course_summary') }}</p>
                            <p class="mt-1 break-words text-sm font-black leading-5 text-slate-900">{{ item.todayTitle }}</p>
                        </div>
                        <span class="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black" :class="progressToneClasses(item.todayTone)">
                            {{ item.todayCompletion }}
                        </span>
                    </div>
                    <div class="mt-3 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
                        <span class="text-xs font-bold text-slate-500">{{ t('classroom.chapter_progress') }}</span>
                        <span class="text-xs font-black text-slate-800">{{ item.todayProgress }}</span>
                    </div>
                </div>

                <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div class="min-w-0 rounded-2xl border border-slate-100 px-3 py-2.5">
                        <p class="text-[10px] font-black uppercase tracking-wide text-slate-400">{{ t('classroom.highest_progress') }}</p>
                        <p class="mt-1 line-clamp-2 text-xs font-black leading-5 text-slate-800">{{ item.highestTitle }}</p>
                        <span class="mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black" :class="progressToneClasses(item.highestTone)">{{ item.highestStatus }}</span>
                    </div>
                    <div class="min-w-0 rounded-2xl border border-slate-100 px-3 py-2.5">
                        <p class="text-[10px] font-black uppercase tracking-wide text-slate-400">{{ t('classroom.latest_progress') }}</p>
                        <p class="mt-1 line-clamp-2 text-xs font-black leading-5 text-slate-800">{{ item.latestTitle }}</p>
                        <span class="mt-1 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black" :class="progressToneClasses(item.latestTone)">{{ item.latestStatus }}</span>
                    </div>
                </div>

                <div class="mt-auto grid grid-cols-2 gap-2 pt-4 sm:grid-cols-4">
                    <button type="button" class="rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-emerald-700"
                        @click="emit('view-reports', item.id)">{{ t('classroom.view_reports') }}</button>
                    <button type="button" class="rounded-xl border px-3 py-2.5 text-xs font-black transition"
                        :class="item.isEditing ? 'border-blue-600 bg-blue-600 text-white' : 'border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100'"
                        @click="emit('quick-edit', item.id)">{{ t('classroom.quick_edit') }}</button>
                    <button type="button" class="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs font-black text-amber-700 transition hover:bg-amber-100"
                        @click="emit('koding-check', item.id)">{{ t('classroom.koding_check') }}</button>
                    <button type="button" class="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-600 transition hover:bg-slate-50"
                        @click="emit('view-profile', item.studentId)">{{ t('common.profile') }}</button>
                </div>
            </article>
        </div>

        <div v-if="hasItems" class="roster-table overflow-x-auto">
            <table class="w-full min-w-[1040px] table-fixed text-left">
                <thead class="border-b border-slate-100 bg-slate-50/80">
                    <tr>
                        <th class="w-[24%] px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.student_name') }}</th>
                        <th class="w-[14%] px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('attendance.status') }}</th>
                        <th class="w-[22%] px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.today_course_summary') }}</th>
                        <th class="w-[24%] px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.learning_snapshot') }}</th>
                        <th class="w-[16%] px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">{{ t('classroom.actions') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    <tr v-for="item in items" :key="item.id" :data-enrollment-id="item.id" class="align-top transition hover:bg-emerald-50/20">
                        <td class="px-6 py-5">
                            <div class="flex min-w-0 gap-3">
                                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 font-black text-emerald-700">{{ item.initials }}</div>
                                <div class="min-w-0">
                                    <div class="flex flex-wrap items-center gap-1.5">
                                        <p class="break-words font-black text-slate-900">{{ item.name }}</p>
                                        <span class="rounded-full border px-2 py-0.5 text-[9px] font-black" :class="enrollmentToneClasses(item.enrollmentTone)">{{ item.enrollmentStatus }}</span>
                                    </div>
                                    <p class="mt-1 line-clamp-2 text-xs font-bold leading-5 text-slate-500">{{ item.currentCourse }}</p>
                                </div>
                            </div>
                        </td>
                        <td class="px-4 py-5">
                            <button v-if="hasOccurrence" type="button" class="rounded-xl border px-3 py-2 text-xs font-black transition disabled:opacity-50"
                                :class="attendanceToneClasses(item.attendanceStatus)" :disabled="attendanceDisabled || item.isSavingAttendance" @click="requestAttendance(item)">
                                {{ item.isSavingAttendance ? t('common.saving') : item.attendanceLabel }}
                            </button>
                            <p class="mt-2 text-[10px] font-bold text-slate-400">{{ item.isGuest ? t('common.rescheduled') : item.enrollmentStatus }}</p>
                        </td>
                        <td class="px-4 py-5">
                            <p class="line-clamp-2 text-sm font-black leading-5 text-slate-900">{{ item.todayTitle }}</p>
                            <div class="mt-2 flex flex-wrap items-center gap-2">
                                <span class="text-xs font-bold text-slate-500">{{ item.todayProgress }}</span>
                                <span class="rounded-full border px-2 py-0.5 text-[9px] font-black" :class="progressToneClasses(item.todayTone)">{{ item.todayCompletion }}</span>
                            </div>
                        </td>
                        <td class="px-4 py-5">
                            <div class="space-y-2">
                                <div class="flex min-w-0 items-start justify-between gap-2">
                                    <div class="min-w-0"><p class="text-[10px] font-bold text-slate-400">{{ t('classroom.highest_progress') }}</p><p class="line-clamp-1 text-xs font-black text-slate-800">{{ item.highestTitle }}</p></div>
                                    <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black" :class="progressToneClasses(item.highestTone)">{{ item.highestStatus }}</span>
                                </div>
                                <div class="flex min-w-0 items-start justify-between gap-2">
                                    <div class="min-w-0"><p class="text-[10px] font-bold text-slate-400">{{ t('classroom.latest_progress') }}</p><p class="line-clamp-1 text-xs font-black text-slate-800">{{ item.latestTitle }}</p></div>
                                    <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black" :class="progressToneClasses(item.latestTone)">{{ item.latestStatus }}</span>
                                </div>
                            </div>
                        </td>
                        <td class="px-6 py-5">
                            <div class="grid grid-cols-2 gap-2">
                                <button type="button" class="rounded-xl bg-emerald-600 px-2 py-2 text-[10px] font-black text-white hover:bg-emerald-700" @click="emit('view-reports', item.id)">{{ t('classroom.view_reports') }}</button>
                                <button type="button" class="rounded-xl border border-blue-100 bg-blue-50 px-2 py-2 text-[10px] font-black text-blue-700 hover:bg-blue-100" @click="emit('quick-edit', item.id)">{{ t('classroom.quick_edit') }}</button>
                                <button type="button" class="rounded-xl border border-amber-100 bg-amber-50 px-2 py-2 text-[10px] font-black text-amber-700 hover:bg-amber-100" @click="emit('koding-check', item.id)">{{ t('classroom.koding_check') }}</button>
                                <button type="button" class="rounded-xl border border-slate-200 bg-white px-2 py-2 text-[10px] font-black text-slate-600 hover:bg-slate-50" @click="emit('view-profile', item.studentId)">{{ t('common.profile') }}</button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>

<style scoped>
.roster-container {
    container-name: student-roster;
    container-type: inline-size;
}

.roster-cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
}

.roster-table {
    display: none;
}

@container student-roster (min-width: 46rem) {
    .roster-cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
    }
}

@container student-roster (min-width: 68rem) {
    .roster-cards {
        display: none;
    }

    .roster-table {
        display: block;
    }
}
</style>
