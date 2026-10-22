<script setup lang="ts">
import { computed } from 'vue'
import type { ReportPlacement } from '@/models/ClassTimeline'

const props = withDefaults(defineProps<{
    placement: ReportPlacement
    /** Class the report was written in; shown after the label. */
    className?: string | null
    /** Hide the badge for reports in the student's own class. */
    hideRegular?: boolean
}>(), {
    className: null,
    hideRegular: false,
})

const tone = computed(() => ({
    regular: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    makeup_in: 'border-purple-200 bg-purple-50 text-purple-800',
    retained_after_transfer: 'border-amber-200 bg-amber-50 text-amber-900',
    outside: 'border-gray-200 bg-gray-100 text-gray-700',
}[props.placement]))
</script>

<template>
    <span v-if="!(hideRegular && placement === 'regular')"
        class="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black leading-5"
        :class="tone">
        <svg v-if="placement === 'regular'" viewBox="0 0 12 12" class="h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
        <svg v-else-if="placement === 'makeup_in'" viewBox="0 0 12 12" class="h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <path d="M6 1 11 11H1Z" fill="currentColor" />
        </svg>
        <svg v-else-if="placement === 'retained_after_transfer'" viewBox="0 0 12 12" class="h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 12 12" class="h-2.5 w-2.5 shrink-0" aria-hidden="true">
            <path d="M2 2 10 10M10 2 2 10" stroke="currentColor" stroke-width="2" />
        </svg>
        <span>{{ $t(`student.class_timeline.placement_${placement}`) }}</span>
        <span v-if="className" class="truncate font-bold opacity-80">· {{ className }}</span>
    </span>
</template>
