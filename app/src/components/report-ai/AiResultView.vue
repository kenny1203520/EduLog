<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import AiNotice from '@/components/report-ai/AiNotice.vue'
import AiSectionCard from '@/components/report-ai/AiSectionCard.vue'
import type { ReportAssistVersion } from '@/composables/useReportAssist'
import type { ReportDraftSection, ReportSectionKey } from '@/services/ai/ReportAssistService'

/**
 * The generated draft: parent-facing sections with insert / copy, the
 * version switcher, whole-draft actions and the internal teaching
 * suggestions. While generating it shows a placeholder for every section
 * that has not arrived yet.
 */
const props = defineProps<{
    generating: boolean
    following: boolean
    sections: Array<Partial<ReportDraftSection>>
    suggestions: string[]
    current: ReportAssistVersion | null
    versionIndex: number
    versionCount: number
    keptSuggestions?: Array<{ generationId: string, date: string | null, suggestions: string[] }>
    copiedKey?: string | null
}>()

const emit = defineEmits<{
    (e: 'insert-section', section: Partial<ReportDraftSection>): void
    (e: 'copy-section', section: Partial<ReportDraftSection>): void
    (e: 'insert-all'): void
    (e: 'replace-all'): void
    (e: 'copy-all'): void
    (e: 'show-version', index: number): void
    (e: 'open-history'): void
    (e: 'set-suggestion', index: number, state: 'kept' | 'dismissed'): void
}>()

const SECTION_KEYS: ReportSectionKey[] = ['today', 'performance', 'home']

/** Streamed sections first, then placeholders for the ones still to come. */
const cards = computed(() => {
    if (!props.generating) return props.sections.map((section) => ({ section, skeleton: false }))
    const arrived = props.sections.filter((section) => section.body)
    const keys = new Set(arrived.map((section) => section.key))
    const waiting = SECTION_KEYS.filter((key) => !keys.has(key)).slice(0, Math.max(0, 3 - arrived.length))
    return [
        ...arrived.map((section) => ({ section, skeleton: false })),
        ...waiting.map((key) => ({ section: { key } as Partial<ReportDraftSection>, skeleton: true })),
    ]
})

const menuOpen = ref(false)
const menuButton = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

async function toggleMenu() {
    menuOpen.value = !menuOpen.value
    if (menuOpen.value) {
        await nextTick()
        menuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    }
}

function closeMenu(returnFocus = true) {
    if (!menuOpen.value) return
    menuOpen.value = false
    if (returnFocus) menuButton.value?.focus()
}

function choose(action: 'replace-all' | 'copy-all') {
    closeMenu()
    if (action === 'replace-all') emit('replace-all')
    else emit('copy-all')
}

function onMenuKeydown(event: KeyboardEvent) {
    const items = [...(menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
    else if (event.key === 'Tab') closeMenu(false)
}

function onDocumentClick(event: MouseEvent) {
    const target = event.target as Node
    if (menuOpen.value && !menuRef.value?.contains(target) && !menuButton.value?.contains(target)) closeMenu(false)
}
document.addEventListener('click', onDocumentClick)
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
    <section class="space-y-3" aria-labelledby="ai-result-title" aria-live="polite" :aria-busy="generating">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1">
                <h3 id="ai-result-title" class="text-base font-bold text-gray-900">
                    {{ generating ? $t('ai.panel.generating') : $t('ai.panel.result_title') }}
                </h3>
                <template v-if="!generating && versionCount > 0">
                    <button type="button" :disabled="versionIndex === 0" :aria-label="$t('ai.panel.previous_version')"
                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-700 transition-colors duration-200 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        @click="emit('show-version', versionIndex - 1)">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <span class="text-sm tabular-nums text-gray-700" data-testid="ai-version-label">{{ $t('ai.panel.version_label', { n: versionIndex + 1, total: versionCount }) }}</span>
                    <button type="button" :disabled="versionIndex >= versionCount - 1" :aria-label="$t('ai.panel.next_version')"
                        class="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-gray-700 transition-colors duration-200 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        @click="emit('show-version', versionIndex + 1)">
                        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                    </button>
                    <button type="button"
                        class="min-h-[44px] cursor-pointer rounded-lg px-2 text-sm font-semibold text-emerald-800 transition-colors duration-200 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                        @click="emit('open-history')">{{ $t('ai.panel.all_records') }}</button>
                </template>
            </div>
            <div v-if="!generating && current" class="relative flex items-center gap-2">
                <button type="button" data-testid="ai-insert-all"
                    class="min-h-[44px] cursor-pointer rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    @click="emit('insert-all')">{{ $t('ai.panel.insert_all') }}</button>
                <button ref="menuButton" type="button" aria-haspopup="menu" :aria-expanded="menuOpen" aria-controls="ai-result-menu" data-testid="ai-more"
                    class="flex min-h-[44px] cursor-pointer items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click.stop="toggleMenu">
                    {{ $t('ai.panel.more') }}
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
                <div v-if="menuOpen" id="ai-result-menu" ref="menuRef" role="menu" :aria-label="$t('ai.panel.more')"
                    class="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg" @keydown="onMenuKeydown">
                    <button type="button" role="menuitem" tabindex="-1" data-testid="ai-replace-all"
                        class="flex min-h-[44px] w-full cursor-pointer items-center px-4 text-left text-sm font-semibold text-red-700 hover:bg-red-50 focus:bg-red-50 focus:outline-none"
                        @click="choose('replace-all')">{{ $t('ai.panel.replace_all') }}</button>
                    <button type="button" role="menuitem" tabindex="-1" data-testid="ai-copy-all"
                        class="flex min-h-[44px] w-full cursor-pointer items-center px-4 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                        @click="choose('copy-all')">{{ $t('ai.panel.copy_all') }}</button>
                </div>
            </div>
        </div>

        <AiNotice v-if="generating" tone="info" live="status" :message="following ? $t('ai.panel.following') : $t('ai.panel.generating_status')" />

        <AiNotice v-if="current?.unresolved_placeholders.length && !generating" tone="warning"
            :message="$t('ai.panel.unresolved', { tokens: current.unresolved_placeholders.join('、') })" />

        <AiSectionCard v-for="(card, i) in cards" :key="card.section.key ?? i"
            :title="card.section.title || (card.section.key ? $t(`ai.panel.section_titles.${card.section.key}`) : undefined)"
            :body="card.section.body" :streaming="generating && !card.skeleton" :skeleton="card.skeleton"
            @insert="emit('insert-section', card.section)" @copy="emit('copy-section', card.section)" />
        <p v-if="copiedKey" class="text-sm text-emerald-800" role="status">{{ $t('ai.panel.copied') }}</p>

        <!-- Internal teaching suggestions, with the ones kept from earlier lessons -->
        <article v-if="suggestions.length || (current && !generating)" class="rounded-xl border border-slate-300 bg-slate-100 p-4">
            <h4 class="flex items-center gap-2 text-sm font-bold text-slate-900">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {{ $t('ai.panel.suggestions_title') }}
                <span class="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-semibold text-white">{{ $t('ai.panel.internal_only') }}</span>
            </h4>
            <p v-if="!suggestions.length" class="mt-2 text-sm text-slate-700">{{ $t('ai.panel.no_suggestions') }}</p>
            <ul class="mt-2 space-y-3">
                <li v-for="(text, index) in suggestions" :key="index" class="text-sm text-slate-800">
                    <p class="whitespace-pre-wrap">{{ text }}</p>
                    <div v-if="current && !generating" class="mt-2 flex gap-2">
                        <button type="button" :aria-pressed="current.suggestionStates[index] === 'kept'"
                            class="min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                            :class="current.suggestionStates[index] === 'kept' ? 'bg-slate-800 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50'"
                            @click="emit('set-suggestion', index, 'kept')">{{ $t('ai.panel.keep') }}</button>
                        <button type="button" :aria-pressed="current.suggestionStates[index] === 'dismissed'"
                            class="min-h-[44px] cursor-pointer rounded-lg px-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                            :class="current.suggestionStates[index] === 'dismissed' ? 'bg-slate-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50'"
                            @click="emit('set-suggestion', index, 'dismissed')">{{ $t('ai.panel.dismiss') }}</button>
                    </div>
                </li>
            </ul>
            <details v-if="keptSuggestions?.length" class="mt-3 border-t border-slate-300 pt-2" data-testid="ai-kept-suggestions">
                <summary class="min-h-[44px] cursor-pointer content-center text-sm font-semibold text-slate-800">{{ $t('ai.panel.kept_suggestions_count', { n: keptSuggestions.length }) }}</summary>
                <div v-for="item in keptSuggestions" :key="item.generationId" class="mt-2">
                    <p class="text-sm font-semibold text-slate-700">{{ item.date }}</p>
                    <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
                        <li v-for="(text, i) in item.suggestions" :key="i">{{ text }}</li>
                    </ul>
                </div>
            </details>
        </article>
    </section>
</template>
