<template>
    <div class="occurrence-calendar">
        <BaseCalendar :compact="props.compact" @select-date="handleSelectDate">
            <template #day="{ day }">
                <!-- Occurrence Indicators -->
                <div v-if="getOccurrencesForDate(day.date).length > 0"
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
                            class="p-4 bg-white border border-gray-100 rounded-2xl hover:shadow-md hover:border-emerald-100 cursor-pointer transition-all flex items-center justify-between group active:scale-[0.98]">
                            <div class="flex items-center gap-3">
                                <div
                                    class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center shrink-0 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                        stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div>
                                    <div
                                        class="font-black text-gray-900 leading-tight group-hover:text-emerald-700 transition-colors">
                                        {{ occurrence.sessionName }}</div>
                                    <div class="text-[10px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                                        {{ occurrence.effectiveStartTime }} - {{ occurrence.effectiveEndTime }}
                                    </div>
                                </div>
                            </div>
                            <span :class="getOccurrenceStatusBadgeClass(occurrence.status)"
                                class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border">
                                {{ $t(`attendance.${props.occurrenceStatuses[occurrence.id!] || occurrence.status}`) }}
                            </span>
                        </div>
                    </div>
                </div>
            </template>
        </BaseCalendar>
    </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/DateUtils'
import BaseCalendar from './common/BaseCalendar.vue'

interface Props {
    occurrences?: ClassOccurrence[]
    existingReportIds?: Set<string>
    occurrenceStatuses?: Record<string, string>
    compact?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    occurrences: () => [],
    existingReportIds: () => new Set(),
    occurrenceStatuses: () => ({}),
    compact: false
})

const emit = defineEmits<{
    'select-occurrence': [occurrence: ClassOccurrence]
}>()

const { locale } = useI18n()

// Methods
function getOccurrencesForDate(date: Date): ClassOccurrence[] {
    const dateStr = DateUtils.formatLocalDate(date)
    return props.occurrences.filter(occ => {
        return DateUtils.formatLocalDate(occ.occurrenceDate) === dateStr
    })
}

function handleSelectDate(date: Date) {
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
        case 'completed':
            return 'bg-emerald-500'
        case 'absent':
            return 'bg-rose-500'
        case 'late':
            return 'bg-amber-500'
        case 'excused':
            return 'bg-blue-500'
        case 'cancelled':
        case 'rescheduled':
            return 'bg-gray-300'
        case 'scheduled':
            return 'bg-emerald-400 opacity-50'
        case 'bookable':
            return 'bg-gray-200'
        case 'holiday':
            return 'bg-pink-400'
        default:
            return 'bg-gray-400'
    }
}

function getOccurrenceStatusBadgeClass(status: string) {
    const currentStatus = props.occurrenceStatuses[status] || status
    switch (currentStatus) {
        case 'present':
        case 'completed':
            return 'bg-emerald-50 text-emerald-600 border-emerald-100'
        case 'absent':
            return 'bg-rose-50 text-rose-600 border-rose-100'
        case 'late':
            return 'bg-amber-50 text-amber-600 border-amber-100'
        case 'excused':
            return 'bg-blue-50 text-blue-600 border-blue-100'
        case 'cancelled':
        case 'rescheduled':
            return 'bg-gray-50 text-gray-400 border-gray-100'
        case 'scheduled':
            return 'bg-emerald-50/50 text-emerald-400 border-emerald-100/50 ring-1 ring-emerald-50'
        case 'bookable':
            return 'bg-slate-50 text-slate-400 border-slate-100'
        case 'holiday':
            return 'bg-pink-50 text-pink-600 border-pink-100'
        default:
            return 'bg-gray-50 text-gray-700 border-gray-100'
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
