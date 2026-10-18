<template>
    <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer" data-testid="source-report-link"
        :title="$t('report.editor.open_source_report_hint')" @click.stop
        class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
            stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        {{ $t('report.editor.open_source_report') }}
    </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sourceReportEditUrl, type SourceReportIdentity } from '@/utils/sourceReportLink'

const props = defineProps<{ identity?: SourceReportIdentity | null }>()

const href = computed(() => sourceReportEditUrl(props.identity))
</script>
