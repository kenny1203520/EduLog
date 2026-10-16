<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * Fixed-size realtime connection indicator. It is always rendered, so status
 * changes only recolor it and never shift the surrounding layout; details and
 * the retry action live in a popover that floats above the page.
 */
export type RealtimeBadgeTone = 'live' | 'connecting' | 'warning' | 'paused'

const props = withDefaults(defineProps<{
    tone: RealtimeBadgeTone
    /** Short label shown in the badge, e.g. 即時協作. */
    label: string
    /** Full status sentence shown in the popover. */
    message: string
    /** Optional technical detail line. */
    detail?: string | null
    /** Extra line such as the last update time. */
    note?: string | null
    canRetry?: boolean
    retryLabel?: string
    busy?: boolean
    /** Accessible name of the badge button and its popover. */
    statusLabel: string
}>(), {
    detail: null,
    note: null,
    canRetry: false,
    retryLabel: '',
    busy: false
})

const emit = defineEmits<{ retry: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const popoverId = `realtime-status-${useId()}`

const dotClass = computed(() => ({
    live: 'bg-emerald-500',
    connecting: 'bg-sky-500 motion-safe:animate-pulse',
    warning: 'bg-amber-500 motion-safe:animate-pulse',
    paused: 'bg-gray-400'
}[props.tone]))

const badgeClass = computed(() => ({
    live: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    connecting: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    paused: 'border-gray-200 bg-gray-50 text-gray-700'
}[props.tone]))

function onDocumentPointer(event: PointerEvent) {
    if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') open.value = false
}

watch(open, value => {
    if (typeof document === 'undefined') return
    if (value) {
        document.addEventListener('pointerdown', onDocumentPointer)
        document.addEventListener('keydown', onKeydown)
    } else {
        document.removeEventListener('pointerdown', onDocumentPointer)
        document.removeEventListener('keydown', onKeydown)
    }
})

onBeforeUnmount(() => { open.value = false })
</script>

<template>
    <div ref="root" class="relative inline-flex">
        <button type="button"
            class="inline-flex h-9 min-w-[8.5rem] cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            :class="badgeClass"
            :aria-label="statusLabel"
            :aria-expanded="open"
            :aria-controls="popoverId"
            @click="open = !open">
            <span class="h-2 w-2 shrink-0 rounded-full transition-colors duration-300" :class="dotClass" aria-hidden="true" />
            <span class="truncate" role="status" aria-live="polite">{{ label }}</span>
            <svg class="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m6 9 6 6 6-6" />
            </svg>
        </button>
        <div v-if="open" :id="popoverId" role="dialog" :aria-label="statusLabel"
            class="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white p-4 text-left text-sm shadow-xl">
            <p class="font-bold text-gray-900">{{ message }}</p>
            <p v-if="note" class="mt-1 text-xs text-gray-600">{{ note }}</p>
            <p v-if="detail" class="mt-2 break-words text-xs text-gray-600">{{ detail }}</p>
            <button v-if="canRetry" type="button" :disabled="busy"
                class="mt-3 min-h-[44px] w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                @click="emit('retry')">
                {{ retryLabel }}
            </button>
        </div>
    </div>
</template>
