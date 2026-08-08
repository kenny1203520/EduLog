<template>
    <div class="occurrence-calendar">
        <BaseCalendar :compact="props.compact" :model-value="props.modelValue" @select-date="handleSelectDate">
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
    modelValue?: string | Date | null
}

const props = withDefaults(defineProps<Props>(), {
    occurrences: () => [],
    existingReportIds: () => new Set(),
    occurrenceStatuses: () => ({}),
    compact: false,
    modelValue: null
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
