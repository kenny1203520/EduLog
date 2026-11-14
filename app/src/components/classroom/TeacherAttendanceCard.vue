<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { roleDisplayName } from '@/utils/roleDisplay'
import type { TeacherAttendanceRow } from '@/composables/session/useOccurrenceTeachers'

defineProps<{
    rows: TeacherAttendanceRow[]
    counts: { present: number; absent: number; onLeave: number; pending?: number }
    rosterFailed?: boolean
    leaveFailed?: boolean
    canManage: boolean
    isHoliday: boolean
}>()

const emit = defineEmits<{
    edit: []
    retry: []
    'toggle-attendance': [teacherId: string | undefined, present: boolean]
}>()

const { t } = useI18n()

function requestAttendanceChange(teacherId: string | undefined, current: string, event: Event) {
    const select = event.target as HTMLSelectElement
    const present = select.value === 'true'
    select.value = current
    emit('toggle-attendance', teacherId, present)
}
</script>

<template>
    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
                <h3 class="font-black text-gray-900">{{ $t('classroom.teacher_attendance_title') }}</h3>
                <p class="text-xs font-bold text-gray-400">
                    {{ $t('classroom.teacher_attendance_subtitle') }}
                    <span v-if="canManage"> · {{ $t('classroom.teacher_attendance_manager_edit') }}</span>
                </p>
                <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                    <span class="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{{ $t('classroom.teacher_attendance_present_count', { count: counts.present }) }}</span>
                    <span class="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{{ $t('classroom.teacher_attendance_absent_count', { count: counts.absent }) }}</span>
                    <span v-if="counts.onLeave" class="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{{ $t('classroom.teacher_attendance_leave_count', { count: counts.onLeave }) }}</span>
                </div>
            </div>

            <button v-if="canManage" type="button" @click="emit('edit')"
                class="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 transition-all text-xs font-black uppercase tracking-widest">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                        d="M12 4v16m8-8H4" />
                </svg>
                {{ $t('common.edit') }}
            </button>
        </div>

        <div v-if="leaveFailed && !rosterFailed" role="status">
            {{ $t('classroom.teacher_leave_failed') }}
            <button type="button" class="underline" @click="emit('retry')">{{ $t('classroom.retry_occurrence_data') }}</button>
        </div>
        <div v-if="rosterFailed" role="alert">
            {{ $t('classroom.teacher_roster_failed') }}
            <button type="button" class="underline" @click="emit('retry')">{{ $t('classroom.retry_occurrence_data') }}</button>
        </div>
        <div v-else-if="rows.length > 0" class="mt-2 divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-gray-50/70">
            <div v-for="{ teacher, onLeave, present, canEdit, pending } in rows" :key="teacher.id"
                class="flex min-w-0 items-center gap-3 px-4 py-3 transition-colors"
                :class="onLeave ? 'bg-amber-50/70' : (present ? 'bg-emerald-50/50' : '')">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold"
                    :class="onLeave ? 'bg-amber-100 text-amber-700' : (present ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500')">
                    {{ teacher.name.charAt(0) }}
                </div>
                <div class="min-w-0 flex-1 pr-2">
                    <div class="truncate font-bold text-gray-900">{{ teacher.name }}</div>
                    <div v-if="teacher.role" class="mt-0.5 text-[10px] font-black tracking-wide text-gray-500">
                        {{ roleDisplayName(teacher.role, t) }}
                    </div>
                </div>
                <span class="shrink-0 rounded-full px-3 py-1 text-[10px] font-black"
                    :class="onLeave ? 'bg-amber-100 text-amber-800' : (present ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600')">
                    {{ onLeave ? $t('classroom.teacher_on_leave') : (present ? $t('attendance.present') : (pending ? $t('classroom.teacher_attendance_pending') : $t('attendance.absent'))) }}
                </span>
                <select class="rounded border px-2 py-1"
                    :value="pending ? '' : String(present)"
                    :disabled="!canEdit || isHoliday || onLeave"
                    :aria-label="teacher.name + ' · ' + $t('classroom.teacher_attendance_title')"
                    @change="requestAttendanceChange(teacher.id, pending ? '' : String(present), $event)">
                    <option value="" disabled>{{ $t('classroom.teacher_attendance_pending') }}</option>
                    <option value="true">{{ $t('attendance.present') }}</option>
                    <option value="false">{{ $t('attendance.absent') }}</option>
                </select>
            </div>
        </div>
        <div v-else
            class="text-center py-6 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            <p class="text-xs font-bold text-gray-400 uppercase tracking-widest">{{
                $t('classroom.no_teachers_assigned') }}</p>
        </div>
    </div>
</template>
