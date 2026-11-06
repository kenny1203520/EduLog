<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { useFeedback } from '@/composables/useFeedback'
import { DateUtils } from '@/utils/dateUtils'
import PlacementBadge from '@/components/enrollment/PlacementBadge.vue'
import {
    classColorIndex,
    layoutTimeline,
    type ClassTimelineData,
    type ClassTimelineReport,
    type ClassTimelineTransfer,
} from '@/models/ClassTimeline'

const props = defineProps<{
    enrollmentId: string
    /** Time zone that defines "today" for the axis end (the class or enrollment zone). */
    timeZone?: string | null
}>()

const { t } = useI18n()
const preferences = usePreferencesStore()
const { reportError } = useFeedback()

const isOpen = ref(false)
const isLoading = ref(false)
const timeline = ref<ClassTimelineData | null>(null)
const selectedReportId = ref<string | null>(null)

// Background, border and text per class slot; text keeps 4.5:1 on its background.
const CLASS_TONES = [
    { bar: 'bg-sky-200 text-sky-950', dot: 'bg-sky-600', border: 'border-sky-400' },
    { bar: 'bg-emerald-200 text-emerald-950', dot: 'bg-emerald-600', border: 'border-emerald-400' },
    { bar: 'bg-violet-200 text-violet-950', dot: 'bg-violet-600', border: 'border-violet-400' },
    { bar: 'bg-orange-200 text-orange-950', dot: 'bg-orange-600', border: 'border-orange-400' },
    { bar: 'bg-teal-200 text-teal-950', dot: 'bg-teal-700', border: 'border-teal-400' },
    { bar: 'bg-pink-200 text-pink-950', dot: 'bg-pink-600', border: 'border-pink-400' },
]

const today = computed(() => DateUtils.todayString(props.timeZone || preferences.timeZone))
const layout = computed(() => timeline.value ? layoutTimeline(timeline.value, today.value) : null)
const classOrder = computed(() => [...new Set((timeline.value?.segments ?? []).map(segment => segment.class_session_id))])
const selectedReport = computed(() => timeline.value?.reports.find(report => report.id === selectedReportId.value) ?? null)

function toneFor(classSessionId: string) {
    return CLASS_TONES[classColorIndex(classSessionId, classOrder.value)]!
}

function formatDate(date: string | null | undefined) {
    return date ? DateUtils.displayDateWithWeekday(date, preferences.locale) : '—'
}

function reportLabel(report: ClassTimelineReport) {
    return [
        formatDate(report.occurrence_date),
        report.class_session_name || t('student.class_timeline.unknown_class'),
        t(`student.class_timeline.placement_${report.placement}`),
    ].join(' · ')
}

function changeCount(transfer: ClassTimelineTransfer, action: string) {
    return transfer.report_changes.filter(change => change.action === action).length
}

/** Segments for the narrow list, each with the reports dated inside it. */
const segmentGroups = computed(() => (timeline.value?.segments ?? []).map(segment => ({
    segment,
    reports: (timeline.value?.reports ?? []).filter(report =>
        report.occurrence_date >= segment.effective_from && (!segment.effective_to || report.occurrence_date <= segment.effective_to)),
})))

async function load() {
    isLoading.value = true
    try {
        timeline.value = await EnrollmentService.getClassTimeline(props.enrollmentId)
    } catch (error) {
        reportError(error, 'student.class_timeline.load_failed')
    } finally {
        isLoading.value = false
    }
}

function toggle() {
    isOpen.value = !isOpen.value
    if (isOpen.value && !timeline.value && !isLoading.value) void load()
}

defineExpose({ reload: load })
</script>

<template>
    <div class="rounded-2xl border border-gray-100 bg-white">
        <button type="button" @click="toggle" :aria-expanded="isOpen" :aria-controls="`class-timeline-${enrollmentId}`"
            class="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-2 text-left text-sm font-black text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer">
            <span class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-4 w-4 text-sky-600" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h10.5m-10.5 5.25h6.75" />
                </svg>
                {{ $t('student.class_timeline.title') }}
            </span>
            <svg class="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200" :class="{ 'rotate-180': isOpen }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <div v-if="isOpen" :id="`class-timeline-${enrollmentId}`" class="space-y-4 border-t border-gray-100 px-4 pb-4 pt-3">
            <div v-if="isLoading" class="space-y-2" aria-busy="true">
                <div class="h-7 animate-pulse rounded-lg bg-gray-100"></div>
                <div class="h-3 w-2/3 animate-pulse rounded bg-gray-100"></div>
            </div>

            <template v-else-if="timeline && layout">
                <p v-if="!timeline.segments.length" class="text-sm font-bold text-gray-500">{{ $t('student.class_timeline.empty') }}</p>

                <!-- Wide screens: one axis, a colour band per class, report markers below -->
                <div v-else class="hidden sm:block">
                    <div class="relative h-8 overflow-hidden rounded-lg bg-gray-100">
                        <div v-for="segment in layout.segments" :key="`${segment.class_session_id}-${segment.effective_from}`"
                            class="absolute inset-y-0 flex items-center overflow-hidden border-r-2 border-white px-2 text-xs font-black"
                            :class="CLASS_TONES[segment.colorIndex]!.bar"
                            :style="{ left: `${segment.left}%`, width: `${segment.width}%` }"
                            :title="`${segment.class_session_name || ''} · ${formatDate(segment.effective_from)} – ${segment.effective_to ? formatDate(segment.effective_to) : $t('student.class_timeline.ongoing')}`">
                            <span class="truncate">{{ segment.class_session_name || $t('student.class_timeline.unknown_class') }}</span>
                        </div>
                    </div>
                    <div class="relative mt-1 h-5" aria-hidden="true">
                        <span v-for="point in layout.transfers" :key="point.item.id"
                            class="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-gray-800"
                            :style="{ left: `${point.left}%` }"
                            :title="`${$t('student.class_timeline.transfer_marker')} ${formatDate(point.item.effective_date)}`"></span>
                    </div>
                    <div class="relative h-6" role="group" :aria-label="$t('student.class_timeline.reports')">
                        <button v-for="point in layout.reports" :key="point.item.id" type="button"
                            class="absolute top-1 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer"
                            :class="selectedReportId === point.item.id ? 'ring-2 ring-gray-900' : ''"
                            :style="{ left: `${point.left}%` }"
                            :aria-label="reportLabel(point.item)" :title="reportLabel(point.item)"
                            @click="selectedReportId = selectedReportId === point.item.id ? null : point.item.id">
                            <span v-if="point.item.placement === 'regular'" class="h-2.5 w-2.5 rounded-full"
                                :class="[toneFor(point.item.class_session_id).dot, point.item.is_blank ? 'opacity-40' : '']"></span>
                            <svg v-else-if="point.item.placement === 'makeup_in'" viewBox="0 0 12 12" class="h-3 w-3 text-purple-700"><path d="M6 1 11 11H1Z" fill="currentColor" /></svg>
                            <span v-else-if="point.item.placement === 'retained_after_transfer'" class="h-2.5 w-2.5 bg-amber-600"></span>
                            <svg v-else viewBox="0 0 12 12" class="h-3 w-3 text-gray-500"><path d="M2 2 10 10M10 2 2 10" stroke="currentColor" stroke-width="2" /></svg>
                        </button>
                    </div>
                    <div class="mt-1 flex justify-between text-[11px] font-bold text-gray-500 tabular-nums">
                        <span>{{ formatDate(layout.start) }}</span>
                        <span>{{ formatDate(layout.end) }}</span>
                    </div>

                    <div class="mt-3 min-h-[2.75rem] rounded-xl bg-gray-50 px-3 py-2 text-sm" aria-live="polite">
                        <div v-if="selectedReport" class="flex flex-wrap items-center gap-2">
                            <span class="font-black text-gray-900">{{ formatDate(selectedReport.occurrence_date) }}</span>
                            <PlacementBadge :placement="selectedReport.placement" :class-name="selectedReport.class_session_name" />
                            <span v-if="selectedReport.is_blank" class="text-xs font-bold text-gray-500">{{ $t('student.class_timeline.blank_report') }}</span>
                            <router-link :to="{ name: 'lesson-reports', params: { enrollmentId } }"
                                class="ml-auto inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-black text-sky-700 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
                                {{ $t('student.class_timeline.open_reports') }}
                            </router-link>
                        </div>
                        <p v-else class="py-1.5 text-xs font-bold text-gray-500">{{ $t('student.class_timeline.select_hint') }}</p>
                    </div>

                    <ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-gray-600" :aria-label="$t('student.class_timeline.legend')">
                        <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-gray-600" aria-hidden="true"></span>{{ $t('student.class_timeline.placement_regular') }}</li>
                        <li class="flex items-center gap-1.5"><svg viewBox="0 0 12 12" class="h-3 w-3 text-purple-700" aria-hidden="true"><path d="M6 1 11 11H1Z" fill="currentColor" /></svg>{{ $t('student.class_timeline.placement_makeup_in') }}</li>
                        <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 bg-amber-600" aria-hidden="true"></span>{{ $t('student.class_timeline.placement_retained_after_transfer') }}</li>
                        <li class="flex items-center gap-1.5"><svg viewBox="0 0 12 12" class="h-3 w-3 text-gray-500" aria-hidden="true"><path d="M2 2 10 10M10 2 2 10" stroke="currentColor" stroke-width="2" /></svg>{{ $t('student.class_timeline.placement_outside') }}</li>
                        <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rotate-45 bg-gray-800" aria-hidden="true"></span>{{ $t('student.class_timeline.transfer_marker') }}</li>
                        <li class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-full bg-gray-600 opacity-40" aria-hidden="true"></span>{{ $t('student.class_timeline.blank_report') }}</li>
                    </ul>
                </div>

                <!-- Narrow screens: one group per class period -->
                <ol v-if="timeline.segments.length" class="space-y-3 sm:hidden">
                    <li v-for="group in segmentGroups" :key="`${group.segment.class_session_id}-${group.segment.effective_from}`"
                        class="rounded-xl border-l-4 bg-gray-50 px-3 py-2"
                        :class="toneFor(group.segment.class_session_id).border">
                        <p class="text-sm font-black text-gray-900">{{ group.segment.class_session_name || $t('student.class_timeline.unknown_class') }}</p>
                        <p class="text-xs font-bold text-gray-500 tabular-nums">
                            {{ formatDate(group.segment.effective_from) }} – {{ group.segment.effective_to ? formatDate(group.segment.effective_to) : $t('student.class_timeline.ongoing') }}
                        </p>
                        <ul v-if="group.reports.length" class="mt-2 space-y-1.5">
                            <li v-for="report in group.reports" :key="report.id" class="flex flex-wrap items-center gap-2 text-xs">
                                <span class="font-bold text-gray-800 tabular-nums">{{ formatDate(report.occurrence_date) }}</span>
                                <PlacementBadge :placement="report.placement"
                                    :class-name="report.placement === 'regular' ? null : report.class_session_name" />
                                <span v-if="report.is_blank" class="text-gray-500">{{ $t('student.class_timeline.blank_report') }}</span>
                            </li>
                        </ul>
                    </li>
                </ol>

                <!-- Transfer log -->
                <section v-if="timeline.transfers.length" class="space-y-2">
                    <h4 class="text-xs font-black uppercase tracking-widest text-gray-500">{{ $t('student.class_timeline.transfer_log') }}</h4>
                    <ol class="space-y-2">
                        <li v-for="transfer in timeline.transfers" :key="transfer.id" class="rounded-xl border border-gray-100 px-3 py-2 text-sm">
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span class="font-black text-gray-900 tabular-nums">{{ formatDate(transfer.effective_date) }}</span>
                                <span class="font-bold text-gray-700">
                                    {{ transfer.from_class_session_name || $t('student.class_timeline.unknown_class') }}
                                    <span aria-hidden="true">→</span>
                                    <span class="sr-only">{{ $t('student.class_timeline.to') }}</span>
                                    {{ transfer.to_class_session_name || $t('student.class_timeline.unknown_class') }}
                                </span>
                                <span v-if="transfer.source === 'migrated'" class="rounded-full border border-gray-200 bg-gray-100 px-2 text-[11px] font-black text-gray-600">
                                    {{ $t('student.class_timeline.migrated') }}
                                </span>
                            </div>
                            <p v-if="transfer.note" class="mt-1 break-words text-xs font-medium text-gray-700">{{ transfer.note }}</p>
                            <p v-if="transfer.source === 'transfer'" class="mt-1 text-xs font-bold text-gray-500">
                                {{ $t('student.class_timeline.change_summary', {
                                    moved: changeCount(transfer, 'moved'),
                                    retained: changeCount(transfer, 'retained'),
                                    created: changeCount(transfer, 'created'),
                                    deleted: changeCount(transfer, 'deleted'),
                                }) }}
                            </p>
                            <p class="mt-1 text-[11px] font-medium text-gray-500">
                                {{ $t('student.class_timeline.recorded_at', { time: DateUtils.displayDateTime(transfer.created_at, preferences.locale, preferences.timeZone) }) }}
                            </p>
                        </li>
                    </ol>
                </section>
            </template>
        </div>
    </div>
</template>
