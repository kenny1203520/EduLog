<template>
    <div class="occurrence-calendar">
        <BaseCalendar :compact="props.compact" :model-value="props.modelValue"
            :is-date-disabled="props.markClassDays ? isNonClassDay : null"
            :get-day-tone="props.markClassDays ? classDayTone : null"
            @select-date="handleSelectDate"
            @range-change="emit('range-change', $event)">
            <template #day="{ day }">
                <!-- Class-day mode: one corner dot for report completion -->
                <template v-if="props.markClassDays">
                    <span v-if="completionFor(day.date)" class="absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white"
                        :class="completionDotClass(completionFor(day.date)!)"
                        :title="$t(`classroom.calendar.completion_${completionFor(day.date)}`)">
                        <span class="sr-only">{{ $t(`classroom.calendar.completion_${completionFor(day.date)}`) }}</span>
                    </span>
                    <!-- Students who joined by a make-up or a class transfer -->
                    <span v-if="joinCountFor(day.date)"
                        class="absolute left-0.5 bottom-0.5 inline-flex items-center gap-0.5 rounded-md bg-purple-100 px-1 text-[9px] font-black leading-4 text-purple-800"
                        :title="joinLabelFor(day.date)">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-2.5 w-2.5" aria-hidden="true">
                            <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                        </svg>
                        <span aria-hidden="true">{{ joinCountFor(day.date) }}</span>
                        <span class="sr-only">{{ joinLabelFor(day.date) }}</span>
                    </span>
                </template>
                <!-- Occurrence Indicators -->
                <div v-else-if="getOccurrencesForDate(day.date).length > 0"
                    :class="props.compact ? 'absolute left-1 bottom-1 flex flex-wrap gap-0.5' : 'mt-1 flex flex-wrap gap-1'">
                    <div v-for="occurrence in getOccurrencesForDate(day.date).slice(0, 4)" :key="occurrence.id"
                        class="rounded-full transition-transform hover:scale-125 shadow-sm"
                        :class="[getOccurrenceIndicatorClass(occurrence), props.compact ? 'w-1.5 h-1.5' : 'w-2 h-2']">
                    </div>
                    <div v-if="getOccurrencesForDate(day.date).length > 4" class="text-[8px] font-black text-gray-400 self-center">
                        +{{ getOccurrencesForDate(day.date).length - 4 }}
                    </div>
                </div>
            </template>

            <template #details="{ selectedDate }">
                <!-- Selected Day Details -->
                <div v-if="!props.compact && selectedDate && getOccurrencesForDate(selectedDate).length > 0"
                    class="mt-8 p-6 bg-gray-50 rounded-[1.5rem] border border-gray-100 animate-in slide-in-from-top-4 duration-300">
                    <h3 class="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                        {{ formatSelectedDate(selectedDate) }}
                    </h3>
                    <div class="space-y-3">
                        <div v-for="occurrence in getOccurrencesForDate(selectedDate)" :key="occurrence.id"
                            @click="$emit('select-occurrence', occurrence)"
                            class="group flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white p-4 transition-all hover:border-emerald-100 hover:shadow-md active:scale-[0.98] cursor-pointer">
                            <div class="flex min-w-0 items-center gap-3">
                                <div
                                    class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                        stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div class="min-w-0">
                                    <div
                                        class="break-words font-black leading-tight text-gray-900 transition-colors group-hover:text-emerald-700">
                                        {{ occurrence.sessionName }}</div>
                                    <div class="mt-0.5 break-words text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                        {{ occurrence.effectiveStartTime }} - {{ occurrence.effectiveEndTime }}
                                    </div>
                                </div>
                            </div>
                            <span :class="getOccurrenceStatusBadgeClass(occurrence.status)"
                                class="shrink-0 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest">
                                {{ $t(`attendance.${props.occurrenceStatuses[occurrence.id!] || occurrence.status}`) }}
                            </span>
                        </div>
                    </div>
                </div>
            </template>
        </BaseCalendar>
        <ul v-if="props.markClassDays" class="mt-3 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[11px] font-bold text-gray-600"
            :aria-label="$t('classroom.calendar.legend')">
            <li class="flex items-center gap-1.5"><span class="h-3 w-3 rounded border border-emerald-200 bg-emerald-100" aria-hidden="true" />{{ $t('classroom.calendar.held') }}</li>
            <li class="flex items-center gap-1.5"><span class="h-3 w-3 rounded border border-sky-400 bg-sky-50" aria-hidden="true" />{{ $t('classroom.calendar.upcoming') }}</li>
            <li class="flex items-center gap-1.5"><span class="h-3 w-3 rounded border border-gray-200 bg-gray-100" aria-hidden="true" />{{ $t('classroom.calendar.cancelled') }}</li>
            <li class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" /><span class="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" /><span class="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />{{ $t('classroom.calendar.completion') }}</li>
            <li class="flex items-center gap-1.5"><span class="inline-flex h-3 items-center rounded bg-purple-100 px-1 text-[9px] font-black text-purple-800" aria-hidden="true">1</span>{{ $t('classroom.calendar.joined') }}</li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/dateUtils'
import BaseCalendar from '../ui/BaseCalendar.vue'
import { classifyClassDay, reportCompletionLevel, type ClassDayKind, type ReportCompletionLevel } from '@/models/ClassCalendarDay'
import type { RosterFlagCount } from '@/models/ClassTimeline'

interface Props {
    occurrences?: ClassOccurrence[]
    existingReportIds?: Set<string>
    occurrenceStatuses?: Record<string, string>
    compact?: boolean
    modelValue?: string | Date | null
    /** Tint class days, disable days without a lesson and show a report-completion dot. */
    markClassDays?: boolean
    /** Whether the schedule rules plan a lesson on a date (YYYY-MM-DD) not generated yet. */
    isPlannedDate?: ((date: string) => boolean) | null
    /** Report counts per lesson date (YYYY-MM-DD). */
    reportCompletion?: Record<string, { total: number; completed: number }>
    /** Today in the class time zone (YYYY-MM-DD). */
    today?: string | null
    /** Students who joined by a make-up or a class transfer, per date (YYYY-MM-DD). */
    joinFlags?: Record<string, RosterFlagCount>
}

const props = withDefaults(defineProps<Props>(), {
    occurrences: () => [],
    existingReportIds: () => new Set(),
    occurrenceStatuses: () => ({}),
    compact: false,
    modelValue: null,
    markClassDays: false,
    isPlannedDate: null,
    reportCompletion: () => ({}),
    today: null,
    joinFlags: () => ({})
})

const emit = defineEmits<{
    'select-date': [date: Date]
    'select-occurrence': [occurrence: ClassOccurrence]
    'range-change': [range: { start: string; end: string }]
}>()

const { locale, t } = useI18n()

// Methods
function getOccurrencesForDate(date: Date): ClassOccurrence[] {
    const dateStr = DateUtils.formatLocalDate(date)
    return props.occurrences.filter(occ => {
        return DateUtils.formatLocalDate(occ.occurrenceDate) === dateStr
    })
}

function classDayKind(date: Date): ClassDayKind {
    const dateStr = DateUtils.formatLocalDate(date)
    return classifyClassDay(dateStr, props.today || DateUtils.todayString(), getOccurrencesForDate(date), props.isPlannedDate)
}

function isNonClassDay(date: Date) {
    return classDayKind(date) === 'none'
}

function classDayTone(date: Date): string | null {
    switch (classDayKind(date)) {
        case 'held': return 'bg-emerald-100 border-emerald-200'
        case 'upcoming': return 'bg-sky-50 border-sky-400'
        case 'cancelled': return 'bg-gray-100 border-gray-200 line-through'
        default: return null
    }
}

function completionFor(date: Date): ReportCompletionLevel | null {
    return reportCompletionLevel(props.reportCompletion[DateUtils.formatLocalDate(date)])
}

function joinCountFor(date: Date): number {
    const entry = props.joinFlags[DateUtils.formatLocalDate(date)]
    return entry ? entry.makeupIn + entry.transferIn : 0
}

function joinLabelFor(date: Date): string {
    const entry = props.joinFlags[DateUtils.formatLocalDate(date)]
    if (!entry) return ''
    return [
        entry.makeupIn ? t('classroom.calendar.joined_makeup', { count: entry.makeupIn }) : '',
        entry.transferIn ? t('classroom.calendar.joined_transfer', { count: entry.transferIn }) : '',
    ].filter(Boolean).join(' / ')
}

function completionDotClass(level: ReportCompletionLevel) {
    return level === 'complete' ? 'bg-emerald-500' : level === 'partial' ? 'bg-amber-500' : 'bg-red-500'
}

function handleSelectDate(date: Date) {
    emit('select-date', date)
    if (props.compact) {
        const occs = getOccurrencesForDate(date)
        if (occs.length > 0) {
            emit('select-occurrence', occs[0])
        }
    }
}

function getOccurrenceIndicatorClass(occurrence: ClassOccurrence) {
    const status = props.occurrenceStatuses[occurrence.id!] || occurrence.status
    switch (status) {
        case 'present':
        case 'late':
            return 'bg-emerald-500'
        case 'absent':
        case 'excused':
            return 'bg-red-500'
        case 'cancelled':
        case 'rescheduled':
        case 'scheduled':
        case 'bookable':
        case 'holiday':
        case 'completed':
        default:
            return 'bg-gray-400'
        case 'pending':
            return 'bg-amber-500'
    }
}

function getOccurrenceStatusBadgeClass(status: string) {
    const currentStatus = props.occurrenceStatuses[status] || status
    switch (currentStatus) {
        case 'present':
        case 'late':
            return 'bg-emerald-50 text-emerald-600 border-emerald-100'
        case 'absent':
        case 'excused':
            return 'bg-red-50 text-red-600 border-red-100'
        case 'cancelled':
        case 'rescheduled':
        case 'scheduled':
        case 'bookable':
        case 'holiday':
        case 'completed':
        default:
            return 'bg-gray-50 text-gray-500 border-gray-100'
        case 'pending':
            return 'bg-amber-50 text-amber-700 border-amber-100'
    }
}

function formatSelectedDate(date: Date): string {
    return date.toLocaleDateString(locale.value, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })
}
</script>

<style scoped>
.occurrence-calendar {
    max-width: 100%;
}

.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}
</style>
