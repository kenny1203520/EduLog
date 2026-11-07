<script setup lang="ts">
import { computed, ref } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'

/**
 * One notice style for the AI panel: an icon, a short title, the message and
 * optional actions. A technical detail (the AI service's own reply) stays
 * folded under 「詳細原因」 so teachers see the plain explanation first.
 */
const props = withDefaults(defineProps<{
    tone?: 'info' | 'warning' | 'error' | 'success'
    title?: string
    message?: string
    detail?: string | null
    /** Live-region role: alerts for errors, status for progress. */
    live?: 'alert' | 'status' | 'none'
}>(), { tone: 'info', live: 'none' })

const copied = ref(false)

const TONE_CLASS = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
} as const

const ICON_PATH = {
    info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    warning: 'M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    error: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    success: 'M5 13l4 4L19 7',
} as const

const role = computed(() => (props.live === 'none' ? undefined : props.live))

async function copyDetail() {
    if (props.detail && await copyToClipboard(props.detail)) {
        copied.value = true
        setTimeout(() => { copied.value = false }, 1500)
    }
}
</script>

<template>
    <div :role="role" class="rounded-xl border p-3 text-sm" :class="TONE_CLASS[tone]" data-testid="ai-notice">
        <div class="flex items-start gap-2">
            <svg class="mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="ICON_PATH[tone]" />
            </svg>
            <div class="min-w-0 flex-1 space-y-1">
                <p v-if="title" class="font-bold">{{ title }}</p>
                <p v-if="message" class="break-words leading-relaxed">{{ message }}</p>
                <slot />
                <details v-if="detail" class="pt-1">
                    <summary class="inline-flex min-h-[44px] cursor-pointer items-center font-semibold underline-offset-2 hover:underline">{{ $t('ai.notice_detail.title') }}</summary>
                    <p class="mt-1 break-words rounded-lg bg-white/70 p-2 font-mono text-sm">{{ detail }}</p>
                    <button type="button"
                        class="mt-1 min-h-[44px] cursor-pointer rounded-lg px-2 font-semibold transition-colors duration-200 hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        @click="copyDetail">{{ copied ? $t('ai.panel.copied') : $t('ai.notice_detail.copy') }}</button>
                </details>
                <div v-if="$slots.actions" class="flex flex-wrap gap-2 pt-1">
                    <slot name="actions" />
                </div>
            </div>
        </div>
    </div>
</template>
