<template>
    <div class="occurrence-calendar bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8">
        <!-- Header with Month Navigation -->
        <div class="flex items-center justify-between mb-8">
            <button @click="previousMonth"
                class="p-3 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-95"
                title="Previous Month">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <h2 class="text-2xl font-black text-gray-900 tracking-tight">
                {{ currentMonthYear }}
            </h2>

            <button @click="nextMonth"
                class="p-3 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-95"
                title="Next Month">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <!-- Day Headers -->
        <div class="grid grid-cols-7 gap-3 mb-4">
            <div v-for="day in dayHeaders" :key="day"
                class="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest py-2">
                {{ day }}
            </div>
        </div>

        <!-- Calendar Grid -->
        <div class="grid grid-cols-7 gap-3">
            <div v-for="(day, index) in calendarDays" :key="index" @click="selectDay(day)" :class="getDayClasses(day)"
                class="relative aspect-square p-2 rounded-2xl cursor-pointer transition-all duration-300 border border-transparent">
                <!-- Day Number -->
                <div class="text-sm font-black"
                    :class="day.isCurrentMonth ? (day.isToday ? 'text-emerald-600' : 'text-gray-900') : 'text-gray-200'">
                    {{ day.date.getDate() }}
                </div>

                <!-- Occurrence Indicators -->
                <div v-if="day.occurrences.length > 0" class="mt-1 flex flex-wrap gap-1">
                    <div v-for="occurrence in day.occurrences.slice(0, 4)" :key="occurrence.id"
                        :class="getOccurrenceIndicatorClass(occurrence)"
                        class="w-2 h-2 rounded-full transition-transform hover:scale-125 shadow-sm">
                    </div>
                    <div v-if="day.occurrences.length > 4" class="text-[8px] font-black text-gray-400 self-center">
                        +{{ day.occurrences.length - 4 }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Selected Day Details -->
        <div v-if="selectedDay && selectedDay.occurrences.length > 0"
            class="mt-8 p-6 bg-gray-50 rounded-[1.5rem] border border-gray-100 animate-in slide-in-from-top-4 duration-300">
            <h3 class="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                {{ formatSelectedDate(selectedDay.date) }}
            </h3>
            <div class="space-y-3">
                <div v-for="occurrence in selectedDay.occurrences" :key="occurrence.id"
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
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/DateUtils'

interface CalendarDay {
    date: Date
    isCurrentMonth: boolean
    occurrences: ClassOccurrence[]
    isToday: boolean
    isSelected: boolean
}

interface Props {
    occurrences?: ClassOccurrence[]
    existingReportIds?: Set<string>
    occurrenceStatuses?: Record<string, string>
}

const props = withDefaults(defineProps<Props>(), {
    occurrences: () => [],
    existingReportIds: () => new Set(),
    occurrenceStatuses: () => ({})
})

const emit = defineEmits<{
    'select-occurrence': [occurrence: ClassOccurrence]
}>()

const { locale } = useI18n()

// State
const currentDate = ref(new Date())
const selectedDay = ref<CalendarDay | null>(null)

// Computed
const currentMonthYear = computed(() => {
    return currentDate.value.toLocaleDateString(locale.value, {
        month: 'long',
        year: 'numeric'
    })
})

const dayHeaders = computed(() => {
    const headers = []
    const formatter = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
    // Jan 1, 2023 was a Sunday
    const startDay = new Date(2023, 0, 1)
    for (let i = 0; i < 7; i++) {
        const date = new Date(startDay)
        date.setDate(startDay.getDate() + i)
        headers.push(formatter.format(date))
    }
    return headers
})

const calendarDays = computed<CalendarDay[]>(() => {
    const year = currentDate.value.getFullYear()
    const month = currentDate.value.getMonth()

    // First day of month
    const firstDay = new Date(year, month, 1)
    const startingDayOfWeek = firstDay.getDay()

    // Last day of month  
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()

    // Days from previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate()
    const daysFromPrevMonth = startingDayOfWeek

    const days: CalendarDay[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Previous month days
    for (let i = daysFromPrevMonth - 1; i >= 0; i--) {
        const date = new Date(year, month - 1, prevMonthLastDay - i)
        days.push({
            date,
            isCurrentMonth: false,
            occurrences: getOccurrencesForDate(date),
            isToday: date.getTime() === today.getTime(),
            isSelected: false
        })
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i)
        days.push({
            date,
            isCurrentMonth: true,
            occurrences: getOccurrencesForDate(date),
            isToday: date.getTime() === today.getTime(),
            isSelected: false
        })
    }

    // Next month days to fill grid
    const remainingDays = 42 - days.length // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
        const date = new Date(year, month + 1, i)
        days.push({
            date,
            isCurrentMonth: false,
            occurrences: getOccurrencesForDate(date),
            isToday: date.getTime() === today.getTime(),
            isSelected: false
        })
    }

    return days
})

// Methods
function getOccurrencesForDate(date: Date): ClassOccurrence[] {
    const dateStr = DateUtils.formatLocalDate(date)
    return props.occurrences.filter(occ => {
        return DateUtils.formatLocalDate(occ.occurrenceDate) === dateStr
    })
}

function previousMonth() {
    currentDate.value = new Date(
        currentDate.value.getFullYear(),
        currentDate.value.getMonth() - 1,
        1
    )
    selectedDay.value = null
}

function nextMonth() {
    currentDate.value = new Date(
        currentDate.value.getFullYear(),
        currentDate.value.getMonth() + 1,
        1
    )
    selectedDay.value = null
}

function selectDay(day: CalendarDay) {
    selectedDay.value = day
}

function getDayClasses(day: CalendarDay) {
    const classes = []

    if (!day.isCurrentMonth) {
        classes.push('bg-gray-50/50')
    } else {
        classes.push('bg-white hover:bg-emerald-50/50 hover:border-emerald-100')
    }

    if (day.isToday) {
        classes.push('border-emerald-500 bg-emerald-50/30')
    }

    if (selectedDay.value && selectedDay.value.date.getTime() === day.date.getTime()) {
        classes.push('ring-4 ring-emerald-500/10 border-emerald-500 scale-105 z-10 shadow-lg shadow-emerald-100')
    }

    return classes
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
            return 'bg-gray-300'
        case 'scheduled':
            return 'bg-emerald-400 opacity-50'
        case 'bookable':
            return 'bg-gray-200'
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
            return 'bg-gray-50 text-gray-400 border-gray-100'
        case 'scheduled':
            return 'bg-emerald-50/50 text-emerald-400 border-emerald-100/50 ring-1 ring-emerald-50'
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
