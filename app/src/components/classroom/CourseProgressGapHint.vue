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
    <details v-if="lessons.length" class="progress-gap-hint mt-1 min-w-0 max-w-full">
        <summary class="flex min-h-11 w-fit max-w-full cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1.5 py-1 text-left text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            <span class="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-bold text-amber-700">
                <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18.5A2 2 0 0 0 3.55 21h16.9a2 2 0 0 0 1.73-2.5L13.7 3.86a2 2 0 0 0-3.4 0Z" />
                </svg>
                {{ t('classroom.progress_gap_short') }}
                <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.09 1.032l-4.25 4.51a.75.75 0 0 1-1.1 0l-4.25-4.51a.75.75 0 0 1 .03-1.06Z" clip-rule="evenodd" />
                </svg>
            </span>
            <span class="shrink-0 whitespace-nowrap text-amber-900/80">{{ t('classroom.progress_gap_sequence', { sequence: firstLesson?.sequence }) }}</span>
            <span v-if="extraCount" class="shrink-0 whitespace-nowrap text-slate-500">{{ t('classroom.progress_gap_more', { count: extraCount }) }}</span>
            <span class="sr-only">{{ t('classroom.progress_gap_details_label') }}</span>
        </summary>
        <ul class="progress-gap-lessons mt-1 border-l-2 border-amber-200 pl-3 text-xs text-slate-700" :aria-label="t('classroom.progress_gap_details_label')">
            <li v-for="lesson in lessons" :key="lesson.id" class="min-w-0 break-words py-1 font-medium">
                {{ t('classroom.progress_gap_details', { sequence: lesson.sequence, title: lesson.title }) }}
            </li>
        </ul>
    </details>
</template>

<style scoped>
.progress-gap-hint {
    container-type: inline-size;
}

.progress-gap-lessons {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.375rem;
}

@container (min-width: 24rem) {
    .progress-gap-lessons {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
