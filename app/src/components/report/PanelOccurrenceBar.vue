<template>
    <section class="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm" data-testid="panel-occurrence-bar">
        <div class="flex items-center gap-1 p-1">
            <button type="button" :disabled="!previous" :aria-label="$t('report.panel.previous')" :title="$t('report.panel.previous')"
                class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors duration-200 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                data-testid="panel-previous" @click="previous && emit('select-occurrence', previous)">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <p class="min-w-0 flex-1 truncate text-center text-sm font-semibold text-gray-900" data-testid="panel-occurrence-label" aria-live="polite">{{ label }}</p>
            <button type="button" :disabled="!next" :aria-label="$t('report.panel.next')" :title="$t('report.panel.next')"
                class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-gray-600 transition-colors duration-200 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                data-testid="panel-next" @click="next && emit('select-occurrence', next)">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </button>
            <button type="button" :aria-label="$t('report.panel.calendar')" :title="$t('report.panel.calendar')" :aria-expanded="calendarOpen"
                class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-200"
                :class="calendarOpen ? 'bg-emerald-50 text-emerald-700' : 'text-gray-600 hover:bg-gray-100'"
                data-testid="panel-calendar-toggle" @click="emit('update:calendarOpen', !calendarOpen)">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </button>
            <button v-if="selected" type="button" :aria-label="$t('report.panel.koding_check')" :title="$t('report.panel.koding_check')"
                class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-orange-600 transition-colors duration-200 hover:bg-orange-50"
                data-testid="panel-koding-check" @click="emit('koding-check')">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L8.25 12l1.5-5M14.25 7l1.5 5-1.5 5M4.5 12h15" /></svg>
            </button>
        </div>
        <div v-if="calendarOpen" class="border-t border-gray-100 p-2" data-testid="panel-calendar">
            <OccurrenceCalendar compact :occurrences="occurrences" :existing-report-ids="existingReportIds"
                :occurrence-statuses="occurrenceStatuses" :model-value="selected?.occurrenceDate || null"
                @select-occurrence="pick" />
        </div>
    </section>
</template>

<script setup lang="ts">
// The extension side panel's one-line lesson switcher: step between lessons, see date · time ·
// status, open the compact calendar for another date, or run the homework check.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OccurrenceCalendar from '@/components/occurrence/OccurrenceCalendar.vue'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/dateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

const props = withDefaults(defineProps<{
    occurrences: ClassOccurrence[]
    selected: ClassOccurrence | null
    calendarOpen?: boolean
    existingReportIds?: Set<string>
    occurrenceStatuses?: Record<string, string>
}>(), { calendarOpen: false, existingReportIds: () => new Set(), occurrenceStatuses: () => ({}) })

const emit = defineEmits<{
    'select-occurrence': [occurrence: ClassOccurrence]
    'update:calendarOpen': [open: boolean]
    'koding-check': []
}>()

const { t, locale } = useI18n()
const preferences = usePreferencesStore()

const index = computed(() => props.selected ? props.occurrences.findIndex(occurrence => occurrence.id === props.selected?.id) : -1)
const previous = computed(() => index.value > 0 ? props.occurrences[index.value - 1] : null)
const next = computed(() => index.value >= 0 && index.value < props.occurrences.length - 1 ? props.occurrences[index.value + 1] : null)
const label = computed(() => {
    const occurrence = props.selected
    if (!occurrence) return t('report.no_occurrence_selected')
    const date = DateUtils.displayDate(occurrence.occurrenceDate, locale.value, preferences.timeZone)
    const start = occurrence.effectiveStartTime?.slice(0, 5) || ''
    const end = occurrence.effectiveEndTime?.slice(0, 5) || ''
    const time = start && end ? `${start}–${end}` : start
    const status = props.occurrenceStatuses[occurrence.id!] || occurrence.status
    return [date, time, status ? t(`attendance.${status}`) : ''].filter(Boolean).join(' · ')
})

function pick(occurrence: ClassOccurrence) {
    emit('select-occurrence', occurrence)
    emit('update:calendarOpen', false)
}
</script>
