<script setup lang="ts">
import OccurrenceCalendar from '@/components/occurrence/OccurrenceCalendar.vue'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import type { CalendarDateRange } from '@/models/ClassCalendarDay'
import type { RosterFlagCount } from '@/models/ClassTimeline'

defineProps<{
    displayedDate: string
    navigationLabel: string
    hasPrevious: boolean
    hasNext: boolean
    isLoading: boolean
    calendarExpanded: boolean
    occurrences: ClassOccurrence[]
    isPlannedDate: (date: string) => boolean
    reportCompletion: Record<string, { total: number; completed: number }>
    joinFlags: Record<string, RosterFlagCount>
    today: string
    selectedDate: string | null
}>()

const emit = defineEmits<{
    previous: []
    next: []
    today: []
    'toggle-calendar': []
    'select-date': [date: Date]
    'range-change': [range: CalendarDateRange]
}>()
</script>

<template>
    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-4">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
                <h3 class="font-black text-gray-900">{{ $t('classroom.teaching_day_navigation') }}</h3>
                <p class="text-xs font-bold text-gray-400">{{ displayedDate }}</p>
            </div>

            <div class="flex items-center gap-2 flex-wrap md:justify-end">
                <button @click="emit('previous')"
                    :disabled="!hasPrevious || isLoading"
                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                    {{ $t('classroom.previous_occurrence') }}
                </button>
                <button @click="emit('today')"
                    :disabled="isLoading"
                    class="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 hover:bg-emerald-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                    {{ $t('classroom.back_to_today') }}
                </button>
                <button @click="emit('next')"
                    :disabled="!hasNext || isLoading"
                    class="px-4 py-2 rounded-xl bg-gray-50 border border-gray-100 text-gray-500 hover:bg-gray-100 transition-all text-xs font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40">
                    {{ $t('classroom.next_occurrence') }}
                </button>

                <button @click="emit('toggle-calendar')"
                    class="px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all text-xs font-black uppercase tracking-widest flex items-center gap-2">
                    <span>{{ calendarExpanded ? $t('classroom.hide_calendar') :
                        $t('classroom.show_calendar') }}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                        :class="calendarExpanded ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
            </div>
        </div>

        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ navigationLabel }}
        </p>

        <Transition name="fade-slide">
            <div v-show="calendarExpanded" class="max-w-4xl mx-auto w-full">
                <OccurrenceCalendar :occurrences="occurrences" :compact="true"
                    mark-class-days
                    :is-planned-date="isPlannedDate"
                    :report-completion="reportCompletion"
                    :join-flags="joinFlags"
                    :today="today"
                    :model-value="selectedDate || null"
                    @select-date="emit('select-date', $event)"
                    @range-change="emit('range-change', $event)" />
            </div>
        </Transition>
    </div>
</template>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.3s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(-10px);
}
</style>
