<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export interface ProgressGapHintLesson {
    id: string
    sequence: number
    title: string
}

const props = defineProps<{ lessons: ProgressGapHintLesson[] }>()
const { t } = useI18n()
const firstLesson = computed(() => props.lessons[0])
const extraCount = computed(() => Math.max(0, props.lessons.length - 1))
</script>

<template>
    <details v-if="lessons.length" class="progress-gap-hint mt-2 max-w-full">
        <summary class="inline-flex min-h-11 max-w-full cursor-pointer list-none items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18.5A2 2 0 0 0 3.55 21h16.9a2 2 0 0 0 1.73-2.5L13.7 3.86a2 2 0 0 0-3.4 0Z" />
            </svg>
            <span class="min-w-0 whitespace-nowrap">{{ t('classroom.progress_gap_short', { sequence: firstLesson?.sequence }) }}</span>
            <span v-if="extraCount" class="shrink-0 rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px]" :aria-label="t('classroom.progress_gap_more', { count: extraCount })">+{{ extraCount }}</span>
            <span class="sr-only">{{ t('classroom.progress_gap_details_label') }}</span>
            <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.09 1.032l-4.25 4.51a.75.75 0 0 1-1.1 0l-4.25-4.51a.75.75 0 0 1 .03-1.06Z" clip-rule="evenodd" />
            </svg>
        </summary>
        <ul class="mt-2 flex flex-wrap gap-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-2" :aria-label="t('classroom.progress_gap_details_label')">
            <li v-for="lesson in lessons" :key="lesson.id" class="max-w-full rounded-full border border-amber-200 bg-white px-2.5 py-1 text-xs font-bold text-amber-900">
                {{ t('classroom.progress_gap_details', { sequence: lesson.sequence, title: lesson.title }) }}
            </li>
        </ul>
    </details>
</template>
