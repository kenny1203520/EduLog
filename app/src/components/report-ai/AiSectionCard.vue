<script setup lang="ts">
/** One parent-facing section of an AI draft, with insert / copy actions. */
defineProps<{
    title?: string
    body?: string
    streaming?: boolean
    disabled?: boolean
    /** Placeholder card while the section has not arrived yet. */
    skeleton?: boolean
}>()

defineEmits<{
    (e: 'insert'): void
    (e: 'copy'): void
}>()
</script>

<template>
    <article class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" :aria-busy="skeleton || streaming">
        <h4 class="mb-2 text-sm font-bold text-gray-900">{{ title || '…' }}</h4>
        <div v-if="skeleton" class="space-y-2" data-testid="ai-section-skeleton" aria-hidden="true">
            <div class="h-4 w-full animate-pulse rounded bg-gray-200 motion-reduce:animate-none"></div>
            <div class="h-4 w-11/12 animate-pulse rounded bg-gray-200 motion-reduce:animate-none"></div>
            <div class="h-4 w-2/3 animate-pulse rounded bg-gray-200 motion-reduce:animate-none"></div>
        </div>
        <p v-else class="whitespace-pre-wrap text-[15px] leading-relaxed text-gray-800">{{ body }}<span v-if="streaming"
                class="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-emerald-500 align-middle motion-reduce:animate-none"
                aria-hidden="true"></span></p>
        <div v-if="!streaming && !skeleton" class="mt-3 flex flex-wrap gap-2">
            <button type="button" :disabled="disabled || !body"
                class="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                @click="$emit('insert')">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                {{ $t('ai.panel.insert') }}
            </button>
            <button type="button" :disabled="!body"
                class="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition-colors duration-200 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                @click="$emit('copy')">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {{ $t('ai.panel.copy') }}
            </button>
        </div>
    </article>
</template>
