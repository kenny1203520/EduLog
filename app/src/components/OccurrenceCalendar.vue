<template>
    <div class="occurrence-calendar bg-white rounded-lg shadow-sm p-6">
        <!-- Header with Month Navigation -->
        <div class="flex items-center justify-between mb-6">
            <button @click="previousMonth" class="p-2 hover:bg-gray-100 rounded-lg transition" title="Previous Month">
                <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <h2 class="text-xl font-semibold text-gray-800">
                {{ currentMonthYear }}
            </h2>

            <button @click="nextMonth" class="p-2 hover:bg-gray-100 rounded-lg transition" title="Next Month">
                <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <!-- Day Headers -->
        <div class="grid grid-cols-7 gap-2 mb-2">
            <div v-for="day in dayHeaders" :key="day" class="text-center text-sm font-medium text-gray-500 py-2">
                {{ day }}
            </div>
        </div>

        <!-- Calendar Grid -->
        <div class="grid grid-cols-7 gap-2">
            <div v-for="(day, index) in calendarDays" :key="index" @click="selectDay(day)" :class="getDayClasses(day)"
                class="relative aspect-square p-2 rounded-lg cursor-pointer transition">
                <!-- Day Number -->
                <div class="text-sm font-medium" :class="day.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'">
                    {{ day.date.getDate() }}
                </div>

                <!-- Occurrence Indicators -->
                <div v-if="day.occurrences.length > 0" class="mt-1 space-y-1">
                    <div v-for="occurrence in day.occurrences.slice(0, 3)" :key="occurrence.id"
                        :class="getOccurrenceIndicatorClass(occurrence)" class="text-xs px-1 py-0.5 rounded truncate">
                        {{ getOccurrenceSymbol(occurrence) }}
                    </div>
                    <div v-if="day.occurrences.length > 3" class="text-xs text-gray-500">
                        +{{ day.occurrences.length - 3 }}
                    </div>
                </div>
            </div>
        </div>

        <!-- Selected Day Details -->
        <div v-if="selectedDay && selectedDay.occurrences.length > 0" class="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 class="font-semibold text-gray-800 mb-3">
                {{ formatSelectedDate(selectedDay.date) }}
            </h3>
            <div class="space-y-2">
                <div v-for="occurrence in selectedDay.occurrences" :key="occurrence.id"
                    @click="$emit('select-occurrence', occurrence)"
                    class="p-3 bg-white rounded-lg hover:bg-blue-50 cursor-pointer transition flex items-center justify-between">
                    <div>
                        <div class="font-medium text-gray-900">{{ occurrence.sessionName }}</div>
                        <div class="text-sm text-gray-600">
                            {{ occurrence.effectiveStartTime }} - {{ occurrence.effectiveEndTime }}
                        </div>
                    </div>
                    <span :class="getOccurrenceStatusBadgeClass(occurrence.status)"
                        class="px-2 py-1 rounded-full text-xs font-medium">
                        {{ occurrence.status }}
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
import { DateUtils } from '@/utils/DateUtils'

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
    const classes = ['border']

    if (!day.isCurrentMonth) {
        classes.push('bg-gray-50')
    } else {
        classes.push('bg-white hover:bg-blue-50')
    }

    if (day.isToday) {
        classes.push('border-blue-500 border-2')
    } else {
        classes.push('border-gray-200')
    }

    if (selectedDay.value && selectedDay.value.date.getTime() === day.date.getTime()) {
        classes.push('ring-2 ring-blue-400')
    }

    return classes
}

function getOccurrenceIndicatorClass(occurrence: ClassOccurrence) {
    const status = props.occurrenceStatuses[occurrence.id!] || occurrence.status
    switch (status) {
        case 'present':
        case 'completed': // Legacy support
            return 'bg-emerald-500 text-white shadow-sm'
        case 'absent':
            return 'bg-rose-500 text-white shadow-sm'
        case 'late':
            return 'bg-amber-100 text-amber-700 border border-amber-200'
        case 'excused':
            return 'bg-blue-50 text-blue-600 border border-blue-100'
        case 'cancelled':
            return 'bg-gray-100 text-gray-400 line-through'
        case 'scheduled':
            return 'bg-blue-100 text-blue-700 border border-blue-200'
        case 'bookable':
            return 'bg-gray-50 text-gray-400 border border-dashed border-gray-300'
        default:
            return 'bg-gray-100 text-gray-700'
    }
}

function getOccurrenceSymbol(occurrence: ClassOccurrence) {
    const status = props.occurrenceStatuses[occurrence.id!] || occurrence.status

    if (status === 'present' || status === 'completed') return '✓'
    if (status === 'absent' || status === 'cancelled') return '✗'
    if (status === 'late') return '○'
    if (status === 'excused') return '◌'
    if (status === 'scheduled') return '○'
    if (status === 'bookable') return '◌'
    return '○'
}

function getOccurrenceStatusBadgeClass(status: string) {
    switch (status) {
        case 'completed':
            return 'bg-green-100 text-green-700'
        case 'cancelled':
            return 'bg-red-100 text-red-700'
        case 'scheduled':
            return 'bg-blue-100 text-blue-700'
        default:
            return 'bg-gray-100 text-gray-700'
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
</style>
