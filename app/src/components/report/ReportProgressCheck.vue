<script setup lang="ts">
import { usePanelUiState } from '@/composables/usePanelUiState'

// The course-progress notes under the lesson picker. In compact mode (side
// panel) they collapse into a one-line summary.
const props = defineProps<{
    compact: boolean
    loading: boolean
    error: boolean
    gaps: Array<{ id: string; sequence: number; title: string }>
    previous: { report: { progress_letter?: string | null; is_completed?: boolean | null; shared_content?: string; can_open_report?: boolean }; lesson: { sequence: number; title: string } } | null
    summary: string
}>()

const emit = defineEmits<{
    retry: []
    'view-previous': []
}>()

const panelUi = usePanelUiState()
</script>

<template>
    <section v-if="loading || error || gaps.length || previous"
        class="mt-3 rounded-xl border px-3 py-3 sm:px-4"
        :class="error ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'"
        :aria-busy="loading" aria-live="polite" aria-atomic="true" data-testid="progress-context">
        <button v-if="props.compact" type="button" data-testid="progress-summary"
            class="flex min-h-[36px] w-full cursor-pointer items-center gap-2 text-left text-sm"
            :aria-expanded="panelUi.progressOpen" @click="panelUi.progressOpen = !panelUi.progressOpen">
            <svg class="h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none" :class="{ 'rotate-90': panelUi.progressOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            <span class="font-bold text-amber-950">{{ $t('report.editor.progress_check.summary_title') }}</span>
            <span class="min-w-0 truncate text-slate-700">{{ summary }}</span>
        </button>
        <div v-show="!props.compact || panelUi.progressOpen" :class="{ 'mt-2': props.compact }">
        <p v-if="loading" class="text-sm text-slate-600" role="status">{{ $t('report.editor.progress_check.loading') }}</p>
        <div v-else-if="error" class="flex flex-wrap items-center justify-between gap-2 text-sm text-rose-800" role="status">
            <span>{{ $t('report.editor.progress_check.load_error') }}</span>
            <button type="button" class="min-h-9 rounded-lg border border-rose-300 bg-white px-3 font-semibold" @click="emit('retry')">{{ $t('report.editor.progress_check.retry') }}</button>
        </div>
        <div v-else class="space-y-3 text-sm">
            <div v-if="gaps.length">
                <p class="font-bold text-amber-950">{{ $t('report.editor.progress_check.gaps_title') }}</p>
                <ul class="mt-1 flex flex-wrap gap-2">
                    <li v-for="lesson in gaps" :key="lesson.id" class="rounded-full bg-white px-3 py-1 text-amber-900 ring-1 ring-amber-200">
                        {{ $t('report.editor.progress_check.lesson', { sequence: lesson.sequence, title: lesson.title }) }}
                    </li>
                </ul>
            </div>
            <div v-if="previous" class="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-2">
                <div class="min-w-0">
                    <p class="font-bold text-slate-900">{{ $t('report.editor.progress_check.previous_title') }}</p>
                    <p class="break-words text-slate-700">
                        {{ $t('report.editor.progress_check.lesson', { sequence: previous.lesson.sequence, title: previous.lesson.title }) }}
                        <span v-if="previous.report.progress_letter"> · {{ previous.report.progress_letter }}</span>
                        <span> · {{ previous.report.is_completed ? $t('report.editor.progress_check.completed') : $t('report.editor.progress_check.incomplete') }}</span>
                    </p>
                    <p v-if="previous.report.shared_content" class="mt-2 whitespace-pre-wrap rounded-lg bg-white/80 px-3 py-2 text-slate-700">
                        <span class="font-semibold">{{ $t('report.editor.progress_check.shared_comment') }}：</span>{{ previous.report.shared_content }}
                    </p>
                </div>
                <button v-if="previous.report.can_open_report !== false" type="button" class="min-h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 font-semibold text-amber-950 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700"
                    @click="emit('view-previous')">{{ $t('report.editor.progress_check.view_report') }}</button>
            </div>
        </div>
        </div>
    </section>
</template>
