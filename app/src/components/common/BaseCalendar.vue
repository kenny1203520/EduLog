<template>
    <div class="base-calendar bg-white shadow-sm border border-gray-100"
        :class="compact ? 'rounded-2xl p-4' : 'rounded-[2rem] p-8'">
        
        <!-- Header with Month Navigation -->
        <div class="flex items-center justify-between" :class="compact ? 'mb-4' : 'mb-8'">
            <button @click="previousMonth"
                class="text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-95"
                :class="compact ? 'p-2' : 'p-3'"
                :title="$t('common.prev_month')">
                <svg :class="compact ? 'w-4 h-4' : 'w-6 h-6'" fill="none" stroke="currentColor"
                    viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <h2 class="font-black text-gray-900 tracking-tight" :class="compact ? 'text-lg' : 'text-2xl'">
                {{ currentMonthYear }}
            </h2>

            <button @click="nextMonth"
                class="text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all active:scale-95"
                :class="compact ? 'p-2' : 'p-3'"
                :title="$t('common.next_month')">
                <svg :class="compact ? 'w-4 h-4' : 'w-6 h-6'" fill="none" stroke="currentColor"
                    viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <!-- Day Headers -->
        <div class="grid grid-cols-7" :class="compact ? 'gap-1 mb-2' : 'gap-3 mb-4'">
            <div v-for="day in dayHeaders" :key="day"
                class="text-center text-[10px] font-black text-gray-400 uppercase tracking-widest"
                :class="compact ? 'py-1' : 'py-2'">
                {{ day }}
            </div>
        </div>

        <!-- Calendar Grid -->
        <div class="grid grid-cols-7" :class="compact ? 'gap-1' : 'gap-3'">
            <div v-for="(day, index) in calendarDays" :key="index" @click="selectDay(day.date)"
                role="button"
                :tabindex="isDisabled(day) ? -1 : 0"
                :aria-disabled="isDisabled(day) || undefined"
                :aria-pressed="isSelected(day)"
                :aria-label="dayLabel(day)"
                @keydown.enter.prevent="selectDay(day.date)"
                @keydown.space.prevent="selectDay(day.date)"
                class="relative transition-colors duration-200 border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                :class="[
                    getDayClasses(day),
                    isDisabled(day) ? 'cursor-not-allowed' : 'cursor-pointer',
                    compact ? 'h-12 p-1 rounded-xl overflow-hidden' : 'aspect-square p-2 rounded-2xl'
                ]">
                <!-- Day Number -->
                <div class="font-black"
                    :class="[
                        compact ? 'text-xs' : 'text-sm',
                        dayNumberClass(day)
                    ]">
                    {{ day.date.getDate() }}
                </div>

                <!-- Custom Content injected per day -->
                <slot name="day" :day="day"></slot>
            </div>
        </div>

        <!-- Selected Day Details -->
        <slot name="details" :selected-date="selectedDate"></slot>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DateUtils } from '@/utils/DateUtils'

export interface BaseCalendarDay {
    date: Date
    isCurrentMonth: boolean
    isToday: boolean
}

interface Props {
    compact?: boolean
    modelValue?: string | Date | null
    initialMonth?: string | Date | null
    /** Days that cannot be selected (rendered muted, not clickable). */
    isDateDisabled?: ((date: Date) => boolean) | null
    /** Extra background/border classes for a day, e.g. to mark class days. */
    getDayTone?: ((date: Date) => string | null) | null
}

const props = withDefaults(defineProps<Props>(), {
    compact: false,
    modelValue: null,
    initialMonth: null,
    isDateDisabled: null,
    getDayTone: null
})

const emit = defineEmits<{
    'select-date': [date: Date]
    'update:modelValue': [date: string]
    /** The first and last date (YYYY-MM-DD) of the visible six-week grid; emitted on mount and on every month change. */
    'range-change': [range: { start: string; end: string }]
}>()

const { locale } = useI18n()

// State
const currentDate = ref(normalizeDate(props.initialMonth) || normalizeDate(props.modelValue) || new Date())
const selectedDate = ref<Date | null>(normalizeDate(props.modelValue))

function normalizeDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null
    const date = typeof value === 'string'
        ? DateUtils.parseLocalDate(value) || new Date(value)
        : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    date.setHours(0, 0, 0, 0)
    return date
}

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

const calendarDays = computed<BaseCalendarDay[]>(() => {
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

    const days: BaseCalendarDay[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // Previous month days
    for (let i = daysFromPrevMonth - 1; i >= 0; i--) {
        const date = new Date(year, month - 1, prevMonthLastDay - i)
        days.push({
            date,
            isCurrentMonth: false,
            isToday: date.getTime() === today.getTime(),
        })
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i)
        days.push({
            date,
            isCurrentMonth: true,
            isToday: date.getTime() === today.getTime(),
        })
    }

    // Next month days to fill grid
    const remainingDays = 42 - days.length // 6 rows * 7 days
    for (let i = 1; i <= remainingDays; i++) {
        const date = new Date(year, month + 1, i)
        days.push({
            date,
            isCurrentMonth: false,
            isToday: date.getTime() === today.getTime(),
        })
    }

    return days
})

// Methods
function previousMonth() {
    currentDate.value = new Date(
        currentDate.value.getFullYear(),
        currentDate.value.getMonth() - 1,
        1
    )
}

function nextMonth() {
    currentDate.value = new Date(
        currentDate.value.getFullYear(),
        currentDate.value.getMonth() + 1,
        1
    )
}

function isSelected(day: BaseCalendarDay) {
    return selectedDate.value?.getTime() === day.date.getTime()
}

function isDisabled(day: BaseCalendarDay) {
    return Boolean(props.isDateDisabled?.(day.date)) && !isSelected(day)
}

function dayLabel(day: BaseCalendarDay) {
    return day.date.toLocaleDateString(locale.value, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
}

function dayNumberClass(day: BaseCalendarDay) {
    if (!day.isCurrentMonth) return 'text-gray-300'
    if (isDisabled(day)) return 'text-gray-300'
    return day.isToday ? 'text-emerald-600' : 'text-gray-900'
}

function selectDay(date: Date) {
    if (props.isDateDisabled?.(date) && selectedDate.value?.getTime() !== date.getTime()) return
    const selected = new Date(date)
    selected.setHours(0, 0, 0, 0)
    selectedDate.value = selected
    emit('update:modelValue', DateUtils.formatLocalDate(selected))
    emit('select-date', selected)
}

function getDayClasses(day: BaseCalendarDay) {
    const tone = props.getDayTone?.(day.date) || null
    if (isSelected(day)) {
        return `${tone || 'bg-emerald-50 border-emerald-200'} ring-2 ring-emerald-500 ring-offset-1`
    }
    if (!day.isCurrentMonth) {
        return `${tone || 'bg-gray-50/50'} opacity-50`
    }
    if (isDisabled(day)) {
        return 'bg-white border-transparent'
    }
    if (tone) {
        return `${tone} hover:brightness-95`
    }
    if (day.isToday) {
        return 'bg-emerald-50/30 border-emerald-100 hover:bg-emerald-50'
    }
    return 'bg-white border-gray-100 hover:border-emerald-200 hover:bg-gray-50'
}

const visibleRange = computed(() => ({
    start: DateUtils.formatLocalDate(calendarDays.value[0]!.date),
    end: DateUtils.formatLocalDate(calendarDays.value[calendarDays.value.length - 1]!.date)
}))

watch(visibleRange, (range, previous) => {
    if (range.start === previous?.start && range.end === previous?.end) return
    emit('range-change', range)
}, { immediate: true })

watch(() => props.modelValue, value => {
    const nextDate = normalizeDate(value)
    selectedDate.value = nextDate
    if (nextDate) {
        currentDate.value = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1)
    }
})

watch(() => props.initialMonth, value => {
    const nextDate = normalizeDate(value)
    if (nextDate && !selectedDate.value) {
        currentDate.value = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1)
    }
})

// Expose methods that parents might need (e.g. moving by week or selecting specific date)
defineExpose({
    previousMonth,
    nextMonth,
    selectDay,
    currentDate
})
</script>
