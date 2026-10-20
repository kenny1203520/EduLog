<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ReportAssistSource } from '@/services/ai/ReportAssistService'

/**
 * Whose quota (which model) a generation uses, as a list of choice cards
 * grouped by site and personal sources. A site source the remaining quota
 * cannot cover is shown but disabled, with the reason.
 */
const props = defineProps<{
    sources: ReportAssistSource[]
    modelValue: string
    quotaRemaining: number
}>()

const emit = defineEmits<{ (e: 'update:modelValue', id: string): void }>()

const listRef = ref<HTMLElement | null>(null)

const groups = computed(() => [
    { key: 'site', sources: props.sources.filter((source) => source.credential_scope === 'site') },
    { key: 'user', sources: props.sources.filter((source) => source.credential_scope === 'user') },
].filter((group) => group.sources.length))

function unaffordable(source: ReportAssistSource) {
    return source.credential_scope === 'site' && props.quotaRemaining < source.quota_weight
}

/** Roving focus: the selected card (or the first one) is the only tab stop. */
function tabIndex(source: ReportAssistSource) {
    const selected = props.sources.some((item) => item.model_row_id === props.modelValue)
    if (selected) return source.model_row_id === props.modelValue ? 0 : -1
    return source === props.sources[0] ? 0 : -1
}

function choose(source: ReportAssistSource) {
    if (!unaffordable(source)) emit('update:modelValue', source.model_row_id)
}

function onKeydown(event: KeyboardEvent) {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const enabled = props.sources.filter((source) => !unaffordable(source))
    if (!enabled.length) return
    const index = enabled.findIndex((source) => source.model_row_id === props.modelValue)
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(index + step + enabled.length) % enabled.length]
    emit('update:modelValue', next.model_row_id)
    requestAnimationFrame(() => listRef.value?.querySelector<HTMLElement>(`[data-source="${next.model_row_id}"]`)?.focus())
}
</script>

<template>
    <div ref="listRef" role="radiogroup" :aria-label="$t('ai.panel.source_title')" class="space-y-3" @keydown="onKeydown">
        <div v-for="group in groups" :key="group.key" class="space-y-2">
            <p class="text-sm font-semibold text-gray-700">{{ group.key === 'site' ? $t('ai.panel.source_site') : $t('ai.panel.source_personal') }}</p>
            <div class="max-h-72 space-y-2 overflow-y-auto">
                <div v-for="source in group.sources" :key="source.model_row_id" role="radio" :data-source="source.model_row_id"
                    :aria-checked="source.model_row_id === modelValue" :aria-disabled="unaffordable(source)" :tabindex="tabIndex(source)"
                    class="flex min-h-[56px] items-start gap-3 rounded-xl border p-3 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    :class="unaffordable(source)
                        ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-600'
                        : source.model_row_id === modelValue
                            ? 'cursor-pointer border-emerald-600 bg-emerald-50 text-gray-900'
                            : 'cursor-pointer border-gray-200 bg-white text-gray-900 hover:border-emerald-300'"
                    @click="choose(source)" @keydown.enter.prevent="choose(source)" @keydown.space.prevent="choose(source)">
                    <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
                        :class="source.model_row_id === modelValue ? 'border-emerald-600' : 'border-gray-400'" aria-hidden="true">
                        <span v-if="source.model_row_id === modelValue" class="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block break-words text-sm font-semibold">{{ source.display_name }}</span>
                        <span class="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
                            <span class="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{{ source.credential_label }}</span>
                            <span v-if="source.credential_scope === 'site'" class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">{{ $t('ai.panel.costs', { n: source.quota_weight }) }}</span>
                            <span v-else class="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">{{ $t('ai.panel.personal_no_quota_short') }}</span>
                            <span v-if="source.compat_mode" class="rounded-full bg-gray-200 px-2 py-0.5 text-gray-800">{{ $t('ai.settings.compat_mode') }}</span>
                            <span v-if="unaffordable(source)" class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{{ $t('ai.panel.not_enough_quota') }}</span>
                        </span>
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>
