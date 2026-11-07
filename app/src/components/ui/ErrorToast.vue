<script setup lang="ts">
import { ref } from 'vue'

/**
 * Body of an error toast. Rendered inside vue-toastification's own container,
 * so every string arrives already translated (see useFeedback).
 */
const props = defineProps<{
    /** What failed, e.g. "Could not save the report". */
    title?: string | null
    /** Why, in plain words. */
    message: string
    /** What the user can do next. */
    hint?: string | null
    /** Error code and request id for support. */
    code?: string | null
    labels: { details: string; copy: string; copied: string }
}>()

const copied = ref(false)

async function copyCode() {
    if (!props.code) return
    try {
        await navigator.clipboard.writeText(props.code)
        copied.value = true
        setTimeout(() => { copied.value = false }, 2000)
    } catch {
        copied.value = false
    }
}
</script>

<template>
    <div class="min-w-0 space-y-1 text-left" @click.stop>
        <p v-if="title" class="text-sm font-black leading-snug">{{ title }}</p>
        <p class="text-sm font-medium leading-snug" :class="title ? 'opacity-95' : 'font-bold'">{{ message }}</p>
        <p v-if="hint" class="text-xs font-medium leading-snug opacity-90">{{ hint }}</p>
        <details v-if="code" class="pt-1 text-xs">
            <summary class="inline-flex min-h-6 cursor-pointer items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                {{ labels.details }}
            </summary>
            <div class="mt-1 flex items-center gap-2">
                <code class="min-w-0 flex-1 break-all rounded bg-black/20 px-1.5 py-1 font-mono text-[11px]">{{ code }}</code>
                <button type="button" @click="copyCode"
                    class="min-h-8 shrink-0 rounded-lg bg-white/20 px-2 font-bold transition-colors hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer">
                    {{ copied ? labels.copied : labels.copy }}
                </button>
            </div>
        </details>
    </div>
</template>
