<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AiNotice from '@/components/report-ai/AiNotice.vue'
import AiSourcePicker from '@/components/report-ai/AiSourcePicker.vue'
import type { ContextWarningCode, ReportAssistPreview, ReportAssistSource, ReportLength, ReportTone } from '@/services/ai/ReportAssistService'

/**
 * What the next generation uses: the teacher's focus for today, style, the
 * source (whose quota) and the de-identified preview. Before any result only
 * the data reminders and the focus field are open; once there is a result
 * the whole block folds into a one-line summary.
 */
const props = defineProps<{
    /** Show the full settings (otherwise only the summary row). */
    expanded: boolean
    warnings: ContextWarningCode[]
    hasDraft?: boolean
    templates?: Array<{ id: string, name: string }>
    sources: ReportAssistSource[]
    selectedSource: ReportAssistSource | null
    quotaRemaining: number
    sourceProblem: boolean
    sourceProblemMessage?: string
    preview: ReportAssistPreview | null
    previewLoading: boolean
    keptSuggestions?: Array<{ generationId: string, date: string | null, suggestions: string[] }>
}>()

const emit = defineEmits<{
    (e: 'toggle'): void
    (e: 'load-preview'): void
}>()

const focus = defineModel<string>('focus', { required: true })
const tone = defineModel<ReportTone>('tone', { required: true })
const length = defineModel<ReportLength>('length', { required: true })
const templateId = defineModel<string>('templateId', { required: true })
const extraInstructions = defineModel<string>('extraInstructions', { required: true })
const modelRowId = defineModel<string>('modelRowId', { required: true })

const { t } = useI18n()
const TONES: ReportTone[] = ['warm', 'formal', 'concise']
const LENGTHS: ReportLength[] = ['short', 'medium', 'long']

const styleOpen = ref(false)
const sourceOpen = ref(false)
// A quota or credential problem needs the teacher's choice: open the source list.
watch(() => props.sourceProblem, (problem) => { if (problem) sourceOpen.value = true }, { immediate: true })

const thinContext = computed(() => props.warnings.includes('thin_class_notes') || props.warnings.includes('missing_lesson_title'))
const templateName = computed(() => props.templates?.find((template) => template.id === templateId.value)?.name ?? null)
const styleSummary = computed(() => [
    t(`ai.tone.${tone.value}`),
    t(`ai.length.${length.value}`),
    templateName.value,
    extraInstructions.value.trim() ? t('ai.panel.has_extra') : null,
].filter(Boolean).join('・'))
const sourceSummary = computed(() => {
    const source = props.selectedSource
    if (!source) return t('ai.panel.no_sources')
    return source.credential_scope === 'site'
        ? `${source.display_name}・${t('ai.panel.costs', { n: source.quota_weight })}`
        : `${source.display_name}・${t('ai.panel.personal_no_quota_short')}`
})
const summary = computed(() => `${styleSummary.value}・${props.selectedSource?.display_name ?? t('ai.panel.no_sources')}`)

function onPreviewToggle(event: Event) {
    if ((event.target as HTMLDetailsElement).open) emit('load-preview')
}
</script>

<template>
    <section class="rounded-xl border border-gray-200 bg-white" aria-labelledby="ai-settings-title">
        <h3 id="ai-settings-title" class="sr-only">{{ $t('ai.panel.settings_title') }}</h3>
        <button type="button" :aria-expanded="expanded" aria-controls="ai-settings-body" data-testid="ai-settings-toggle"
            class="flex min-h-[52px] w-full cursor-pointer items-center gap-3 rounded-xl px-4 text-left transition-colors duration-200 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            @click="emit('toggle')">
            <svg class="h-5 w-5 shrink-0 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span class="min-w-0 flex-1">
                <span class="block text-sm font-bold text-gray-900">{{ $t('ai.panel.settings_title') }}</span>
                <span v-if="!expanded" class="block truncate text-sm text-gray-600" data-testid="ai-settings-summary">{{ summary }}</span>
            </span>
            <svg class="h-5 w-5 shrink-0 text-gray-600 transition-transform duration-200" :class="expanded ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <div v-if="expanded" id="ai-settings-body" class="space-y-4 border-t border-gray-100 px-4 pb-4 pt-3">
            <!-- Data check and today's focus: what teachers most often need to add -->
            <AiNotice v-if="warnings.length" tone="warning" :title="$t('ai.panel.context_title')">
                <ul class="list-disc space-y-1 pl-5">
                    <li v-for="code in warnings" :key="code">{{ $t(`ai.warnings.${code}`) }}</li>
                </ul>
            </AiNotice>
            <p v-else class="flex items-center gap-2 text-sm text-emerald-800">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                {{ $t('ai.panel.context_ok') }}
            </p>
            <label class="block">
                <span class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.focus_label') }}</span>
                <textarea v-model="focus" rows="3" maxlength="4000"
                    class="mt-1 w-full rounded-lg border px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    :class="thinContext ? 'border-amber-400 bg-amber-50' : 'border-gray-300'"
                    :placeholder="$t('ai.panel.focus_placeholder')" :aria-label="$t('ai.panel.focus_placeholder')"></textarea>
            </label>
            <details v-if="keptSuggestions?.length" class="rounded-lg border border-slate-300 bg-slate-100 p-3" data-testid="ai-kept-suggestions">
                <summary class="min-h-[44px] cursor-pointer content-center text-sm font-semibold text-slate-800">
                    {{ $t('ai.panel.kept_suggestions_count', { n: keptSuggestions.length }) }}
                    <span class="ml-1 font-normal text-slate-700">{{ $t('ai.panel.internal_only') }}</span>
                </summary>
                <div v-for="item in keptSuggestions" :key="item.generationId" class="mt-2">
                    <p class="text-sm font-semibold text-slate-700">{{ item.date }}</p>
                    <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
                        <li v-for="(text, i) in item.suggestions" :key="i">{{ text }}</li>
                    </ul>
                </div>
            </details>

            <!-- Style, folded to one line -->
            <div class="rounded-lg border border-gray-200">
                <button type="button" :aria-expanded="styleOpen" aria-controls="ai-style-body" data-testid="ai-style-toggle"
                    class="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="styleOpen = !styleOpen">
                    <span class="min-w-0">
                        <span class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.style_title') }}</span>
                        <span class="ml-2 text-sm text-gray-600">{{ styleSummary }}</span>
                    </span>
                    <svg class="h-4 w-4 shrink-0 text-gray-600 transition-transform duration-200" :class="styleOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                <div v-if="styleOpen" id="ai-style-body" class="space-y-3 border-t border-gray-100 p-3">
                    <fieldset>
                        <legend class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.tone') }}</legend>
                        <p v-if="hasDraft" class="mt-1 text-sm text-gray-600">{{ $t('ai.panel.tone_draft_hint') }}</p>
                        <div class="mt-1 flex flex-wrap gap-2">
                            <label v-for="option in TONES" :key="option"
                                class="relative inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500"
                                :class="tone === option ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-gray-300 text-gray-700 hover:bg-gray-50'">
                                <input v-model="tone" type="radio" name="ai-tone" :value="option" class="sr-only" />
                                {{ $t(`ai.tone.${option}`) }}
                            </label>
                        </div>
                    </fieldset>
                    <fieldset>
                        <legend class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.length') }}</legend>
                        <div class="mt-1 flex flex-wrap gap-2">
                            <label v-for="option in LENGTHS" :key="option"
                                class="relative inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-4 text-sm font-medium transition-colors duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500"
                                :class="length === option ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-gray-300 text-gray-700 hover:bg-gray-50'">
                                <input v-model="length" type="radio" name="ai-length" :value="option" class="sr-only" />
                                {{ $t(`ai.length.${option}`) }}
                            </label>
                        </div>
                    </fieldset>
                    <label v-if="templates?.length" class="block">
                        <span class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.template') }}</span>
                        <select v-model="templateId"
                            class="mt-1 min-h-[44px] w-full cursor-pointer rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="">{{ $t('ai.panel.template_none') }}</option>
                            <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option>
                        </select>
                    </label>
                    <label class="block">
                        <span class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.extra_label') }}</span>
                        <textarea v-model="extraInstructions" rows="2" maxlength="2000"
                            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            :placeholder="$t('ai.panel.extra_placeholder')" :aria-label="$t('ai.panel.extra_placeholder')"></textarea>
                    </label>
                </div>
            </div>

            <!-- Source, folded to one line unless there is a problem -->
            <div class="rounded-lg border" :class="sourceProblem ? 'border-amber-300' : 'border-gray-200'">
                <button type="button" :aria-expanded="sourceOpen" aria-controls="ai-source-body" data-testid="ai-source-toggle"
                    class="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="sourceOpen = !sourceOpen">
                    <span class="min-w-0">
                        <span class="text-sm font-semibold text-gray-800">{{ $t('ai.panel.source_title') }}</span>
                        <span class="ml-2 break-words text-sm text-gray-600">{{ sourceSummary }}</span>
                    </span>
                    <svg class="h-4 w-4 shrink-0 text-gray-600 transition-transform duration-200" :class="sourceOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                <div v-if="sourceOpen" id="ai-source-body" class="space-y-3 border-t border-gray-100 p-3">
                    <AiNotice v-if="sourceProblem" tone="warning" live="alert" :message="sourceProblemMessage" />
                    <p v-if="!sources.length" class="text-sm text-gray-700">{{ $t('ai.panel.no_sources') }}</p>
                    <AiSourcePicker v-else v-model="modelRowId" :sources="sources" :quota-remaining="quotaRemaining" />
                </div>
            </div>

            <details class="rounded-lg border border-gray-200 px-3 py-1" @toggle="onPreviewToggle">
                <summary class="min-h-[44px] cursor-pointer content-center text-sm font-semibold text-gray-800">{{ $t('ai.panel.preview_title') }}</summary>
                <p class="mt-1 text-sm text-gray-600">{{ $t('ai.panel.preview_hint') }}</p>
                <p v-if="previewLoading" class="mt-2 text-sm text-gray-600" role="status">{{ $t('ai.panel.preview_loading') }}</p>
                <pre v-else-if="preview" class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-100 p-3 text-sm text-gray-800">{{ preview.prompt }}</pre>
            </details>
        </div>
    </section>
</template>
