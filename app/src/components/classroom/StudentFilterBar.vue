<script setup lang="ts">
export type StudentAttendanceFilter = 'all' | 'present' | 'absent' | 'pending'

defineProps<{
    resultCount: number
}>()

const search = defineModel<string>('search', { required: true })
const attendance = defineModel<StudentAttendanceFilter>('attendance', { required: true })
</script>

<template>
    <div class="flex flex-col gap-3 rounded-[2rem] border border-gray-100 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <label class="relative min-w-0 flex-1" for="edulog-sessiondetailsview-291-24450">
            <span class="sr-only">{{ $t('classroom.student_search') }}</span>
            <svg class="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
            </svg>
            <input v-model="search" type="search" :placeholder="$t('classroom.student_search_placeholder')"
                class="w-full rounded-2xl border border-gray-100 bg-gray-50 py-3 pl-12 pr-10 font-bold text-gray-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" :aria-label="$t('classroom.student_search_placeholder')">
            <button v-if="search" type="button" @click="search = ''"
                class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" :aria-label="$t('common.clear')">×</button>
        </label>
        <select v-model="attendance" class="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 font-black text-gray-700 outline-none focus:border-emerald-500" id="edulog-sessiondetailsview-291-24450">
            <option value="all">{{ $t('classroom.student_filter_all') }}</option>
            <option value="present">{{ $t('attendance.present') }}</option>
            <option value="absent">{{ $t('attendance.absent') }}</option>
            <option value="pending">{{ $t('attendance.pending') }}</option>
        </select>
        <span class="shrink-0 px-2 text-center text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.student_filter_count', { count: resultCount }) }}</span>
    </div>
</template>
