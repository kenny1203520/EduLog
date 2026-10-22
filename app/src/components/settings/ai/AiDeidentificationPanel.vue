<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFeedback } from '@/composables/useFeedback'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import {
    AiDeidService,
    DEID_PLACEHOLDER_KINDS,
    type DeidLanguage,
    type DeidOverview,
    type DeidPlaceholderKind,
    type DeidRuleDTO,
    type DeidRuleInput,
    type DeidRuleKind,
    type DeidSpanKind,
    type DeidTestResult,
} from '@/services/ai/AiDeidService'

/**
 * Settings → AI → De-identification: Presidio status and languages, custom
 * rules, exception words and a test bench that never logs anything.
 */
const { t } = useI18n()
const { reportError, success } = useFeedback()

const overview = ref<DeidOverview | null>(null)
const loading = ref(true)
const saving = ref(false)

/** Same colour per kind everywhere; each mark also carries a text label. */
const KIND_CLASSES: Record<DeidSpanKind, string> = {
    student: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
    teacher: 'bg-sky-100 text-sky-900 ring-sky-300',
    school: 'bg-indigo-100 text-indigo-900 ring-indigo-300',
    person: 'bg-amber-100 text-amber-900 ring-amber-300',
    location: 'bg-lime-100 text-lime-900 ring-lime-300',
    organization: 'bg-violet-100 text-violet-900 ring-violet-300',
    phone: 'bg-rose-100 text-rose-900 ring-rose-300',
    email: 'bg-pink-100 text-pink-900 ring-pink-300',
    nationalId: 'bg-red-100 text-red-900 ring-red-300',
    sensitive: 'bg-orange-100 text-orange-900 ring-orange-300',
}

/** Python-compatible examples (kept out of the locale files: `{n}` is message syntax there). */
const PATTERN_EXAMPLES = [
    { key: 'student_number', pattern: 'S\\d{6}' },
    { key: 'line_id', pattern: '(?<=LINE\\s?ID[:：\\s])[\\w.\\-]{4,20}' },
    { key: 'address', pattern: '[\\u4e00-\\u9fff]{2,3}[市縣][\\u4e00-\\u9fff]{1,4}[區鄉鎮市][\\u4e00-\\u9fff\\d]{1,12}[路街道](?:[\\d一二三四五六七八九十]+段)?(?:\\d+巷)?(?:\\d+弄)?\\d+號' },
] as const

async function load() {
    loading.value = true
    try { overview.value = await AiDeidService.overview() } catch (error) { reportError(error) } finally { loading.value = false }
}

async function save(work: () => Promise<void>) {
    saving.value = true
    try { await work(); success('aiDeid.saved') } catch (error) { reportError(error) } finally { saving.value = false }
}

// Status and languages -------------------------------------------------------

const missingLanguages = computed(() => (overview.value?.available_languages ?? []).filter((code) => !overview.value?.installed_languages.includes(code)))
const languagesToAdd = ref<DeidLanguage[]>([])
const rebuildCommand = computed(() => {
    const installed = overview.value?.installed_languages ?? []
    const wanted = [...installed, ...languagesToAdd.value.filter((code) => !installed.includes(code))]
    return `EDULOG_PRESIDIO_LANGUAGES=${wanted.join(',')} docker compose build presidio-analyzer && docker compose up -d presidio-analyzer`
})

function toggleLanguage(code: DeidLanguage, enabled: boolean) {
    if (!overview.value) return
    const current = overview.value.enabled_languages
    const next = enabled ? [...current, code] : current.filter((item) => item !== code)
    if (next.length === 0) return
    save(async () => {
        const saved = await AiDeidService.saveLanguages(next)
        overview.value = { ...overview.value!, enabled_languages: saved.enabled_languages }
    })
}

async function copyCommand() {
    try {
        await navigator.clipboard.writeText(rebuildCommand.value)
        success('aiDeid.status.copied')
    } catch (error) { reportError(error) }
}

// Rules ------------------------------------------------------------------------

interface RuleDraft {
    id: string | null
    name: string
    kind: DeidRuleKind
    entriesText: string
    pattern: string
    placeholder_kind: DeidPlaceholderKind
    languages: DeidLanguage[]
    enabled: boolean
}
const emptyDraft = (): RuleDraft => ({ id: null, name: '', kind: 'deny_list', entriesText: '', pattern: '', placeholder_kind: 'sensitive', languages: [], enabled: true })
const drawerOpen = ref(false)
/** Kept after the drawer closes so the test bench can use it until saved or discarded. */
const draft = ref<RuleDraft | null>(null)
const formErrors = ref<Record<string, string[]>>({})
const nameInput = ref<HTMLInputElement | null>(null)

function openRule(rule?: DeidRuleDTO) {
    formErrors.value = {}
    draft.value = rule
        ? { id: rule.id, name: rule.name, kind: rule.kind, entriesText: rule.entries.join('\n'), pattern: rule.pattern ?? '', placeholder_kind: rule.placeholder_kind, languages: [...rule.languages], enabled: rule.enabled }
        : emptyDraft()
    drawerOpen.value = true
    void nextTick(() => nameInput.value?.focus())
}

function discardDraft() {
    drawerOpen.value = false
    draft.value = null
    useDraft.value = false
}

function draftInput(value: RuleDraft): DeidRuleInput {
    return {
        name: value.name.trim(),
        kind: value.kind,
        entries: value.kind === 'deny_list' ? [...new Set(value.entriesText.split('\n').map((line) => line.trim()).filter(Boolean))] : [],
        pattern: value.kind === 'regex' ? value.pattern : null,
        placeholder_kind: value.placeholder_kind,
        languages: value.languages,
        enabled: value.enabled,
    }
}

/**
 * Advisory check in the browser; Presidio (Python) has the final say when
 * saving, so Python-only syntax (`(?P<name>`, leading `(?i)`) is translated
 * first and the warning never blocks saving.
 */
const patternError = computed(() => {
    if (!draft.value || draft.value.kind !== 'regex' || !draft.value.pattern) return null
    try {
        new RegExp(draft.value.pattern.replace(/\(\?P</g, '(?<').replace(/^\(\?[aiLmsux]+\)/, ''))
        return null
    } catch (error) {
        return (error as Error).message
    }
})

async function saveRule() {
    if (!draft.value) return
    formErrors.value = {}
    saving.value = true
    try {
        const input = draftInput(draft.value)
        const saved = draft.value.id ? await AiDeidService.updateRule(draft.value.id, input) : await AiDeidService.createRule(input)
        const rules = overview.value!.rules
        overview.value = { ...overview.value!, rules: draft.value.id ? rules.map((rule) => rule.id === saved.id ? saved : rule) : [...rules, saved] }
        discardDraft()
        success('aiDeid.saved')
    } catch (error) {
        if (error instanceof ApiV1Error && error.fields) formErrors.value = error.fields
        reportError(error)
    } finally {
        saving.value = false
    }
}

function toggleRule(rule: DeidRuleDTO, enabled: boolean) {
    save(async () => {
        const saved = await AiDeidService.updateRule(rule.id, { enabled })
        overview.value = { ...overview.value!, rules: overview.value!.rules.map((item) => item.id === saved.id ? saved : item) }
    })
}

function deleteRule(rule: DeidRuleDTO) {
    if (!window.confirm(t('aiDeid.rules.delete_confirm', { name: rule.name }))) return
    save(async () => {
        await AiDeidService.deleteRule(rule.id)
        overview.value = { ...overview.value!, rules: overview.value!.rules.filter((item) => item.id !== rule.id) }
    })
}

function toggleDraftLanguage(code: DeidLanguage, checked: boolean) {
    if (!draft.value) return
    draft.value.languages = checked ? [...draft.value.languages, code] : draft.value.languages.filter((item) => item !== code)
}

// Exceptions --------------------------------------------------------------------

const allowInput = ref('')

function saveAllowList(entries: string[]) {
    save(async () => {
        const saved = await AiDeidService.saveAllowList(entries)
        overview.value = { ...overview.value!, allow_list: saved.allow_list }
    })
}

function addAllowWords() {
    const words = allowInput.value.split(/[,，\n]/).map((word) => word.trim()).filter(Boolean)
    allowInput.value = ''
    const current = overview.value?.allow_list ?? []
    const next = [...new Set([...current, ...words])]
    if (next.length !== current.length) saveAllowList(next)
}

// Test bench -----------------------------------------------------------------------

const testForm = reactive({ text: t('aiDeid.test.sample'), students: '王小明, 陳大文', teachers: '林雅婷', schools: '' })
const useDraft = ref(false)
const testing = ref(false)
const testResult = ref<DeidTestResult | null>(null)
const testedText = ref('')
const testError = ref<string | null>(null)

watch(draft, (value) => { if (!value) useDraft.value = false })

const splitNames = (value: string) => value.split(/[,，、\n]/).map((name) => name.trim()).filter(Boolean)

async function runTest() {
    if (!overview.value || !testForm.text.trim()) return
    testing.value = true
    testError.value = null
    try {
        const names = [
            ...splitNames(testForm.students).map((name) => ({ kind: 'student' as const, name })),
            ...splitNames(testForm.teachers).map((name) => ({ kind: 'teacher' as const, name })),
            ...splitNames(testForm.schools).map((name) => ({ kind: 'school' as const, name })),
        ]
        let rules: DeidRuleInput[] | undefined
        if (useDraft.value && draft.value) {
            const pending = draftInput(draft.value)
            const saved = overview.value.rules
                .filter((rule) => rule.id !== draft.value!.id)
                .map((rule): DeidRuleInput => ({ name: rule.name, kind: rule.kind, entries: rule.entries, pattern: rule.pattern, placeholder_kind: rule.placeholder_kind, languages: rule.languages, enabled: rule.enabled }))
            rules = [...saved, { ...pending, name: pending.name || t('aiDeid.form.new_title'), enabled: true }]
        }
        testedText.value = testForm.text
        testResult.value = await AiDeidService.test({ text: testForm.text, names, rules, allow_list: rules ? overview.value.allow_list : undefined })
    } catch (error) {
        testResult.value = null
        if (error instanceof ApiV1Error && error.code === 'AI_DEIDENTIFICATION_INCOMPLETE') testError.value = t('aiDeid.test.incomplete')
        else if (error instanceof ApiV1Error && error.fields) testError.value = Object.values(error.fields).flat().join(' ')
        else reportError(error)
    } finally {
        testing.value = false
    }
}

function testDraft() {
    useDraft.value = true
    drawerOpen.value = false
    void runTest()
}

/** The original text cut into plain and marked pieces, in order. */
const segments = computed(() => {
    const result = testResult.value
    if (!result) return []
    const pieces: Array<{ text: string, span: DeidTestResult['spans'][number] | null }> = []
    let cursor = 0
    for (const span of result.spans) {
        if (span.start > cursor) pieces.push({ text: testedText.value.slice(cursor, span.start), span: null })
        pieces.push({ text: testedText.value.slice(span.start, span.end), span })
        cursor = span.end
    }
    if (cursor < testedText.value.length) pieces.push({ text: testedText.value.slice(cursor), span: null })
    return pieces
})

function sourceLabel(span: DeidTestResult['spans'][number]) {
    if (span.source === 'known') return t('aiDeid.test.source_known')
    if (span.source === 'rule') return t('aiDeid.test.source_rule', { name: span.rule_name ?? '' })
    return t('aiDeid.test.source_ner', { type: span.entity_type, language: t(`aiDeid.languages.${span.language}`) })
}

const languageLabel = (code: string) => `${t(`aiDeid.languages.${code}`)}（${code}）`

onMounted(load)
</script>

<template>
    <div class="space-y-6">
        <div v-if="loading" class="h-40 animate-pulse rounded-3xl bg-gray-100 motion-reduce:animate-none" aria-busy="true"></div>

        <template v-else-if="overview">
            <!-- Status and languages -->
            <section class="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="deid-status-title">
                <h3 id="deid-status-title" class="text-lg font-black text-gray-900">{{ t('aiDeid.status.title') }}</h3>
                <p class="text-sm text-gray-600">{{ t('aiDeid.intro') }}</p>
                <p class="rounded-xl px-4 py-3 text-sm font-bold" data-test="deid-connection"
                    :class="overview.connection === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'">
                    {{ t(`aiDeid.status.${overview.connection}`) }}
                </p>
                <fieldset class="space-y-2">
                    <legend class="text-sm font-black text-gray-800">{{ t('aiDeid.status.languages') }}</legend>
                    <p class="text-xs text-gray-600">{{ t('aiDeid.status.languages_hint') }}</p>
                    <div class="flex flex-wrap gap-2">
                        <label v-for="code in overview.installed_languages" :key="code"
                            class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800">
                            <input type="checkbox" class="h-5 w-5 accent-emerald-600" :checked="overview.enabled_languages.includes(code)"
                                :disabled="saving || (overview.enabled_languages.length === 1 && overview.enabled_languages.includes(code))"
                                @change="toggleLanguage(code, ($event.target as HTMLInputElement).checked)" />
                            {{ languageLabel(code) }}
                        </label>
                        <span v-for="code in missingLanguages" :key="code" class="flex min-h-11 items-center rounded-xl bg-gray-50 px-3 text-sm text-gray-500">
                            {{ languageLabel(code) }} · {{ t('aiDeid.status.not_installed') }}
                        </span>
                    </div>
                </fieldset>
                <div class="rounded-2xl border border-gray-200 p-4">
                    <h4 class="text-sm font-black text-gray-800">{{ t('aiDeid.status.add_languages') }}</h4>
                    <p v-if="!missingLanguages.length" class="mt-1 text-xs text-gray-600">{{ t('aiDeid.status.all_installed') }}</p>
                    <template v-else>
                        <p class="mt-1 text-xs text-gray-600">{{ t('aiDeid.status.add_languages_hint') }}</p>
                        <div class="mt-2 flex flex-wrap gap-2">
                            <label v-for="code in missingLanguages" :key="code" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800">
                                <input v-model="languagesToAdd" type="checkbox" class="h-5 w-5 accent-emerald-600" :value="code" />
                                {{ languageLabel(code) }}
                            </label>
                        </div>
                        <label class="mt-3 block text-xs font-bold text-gray-700" for="deid-rebuild">{{ t('aiDeid.status.rebuild_command') }}</label>
                        <div class="mt-1 flex flex-wrap items-stretch gap-2">
                            <code id="deid-rebuild" class="min-w-0 flex-1 break-all rounded-xl bg-gray-900 px-3 py-2 font-mono text-xs leading-relaxed text-gray-100">{{ rebuildCommand }}</code>
                            <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50" @click="copyCommand">{{ t('aiDeid.status.copy') }}</button>
                        </div>
                    </template>
                </div>
            </section>

            <!-- Custom rules -->
            <section class="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="deid-rules-title">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 id="deid-rules-title" class="text-lg font-black text-gray-900">{{ t('aiDeid.rules.title') }}</h3>
                        <p class="mt-1 text-sm text-gray-600">{{ t('aiDeid.rules.hint') }}</p>
                    </div>
                    <button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving" @click="openRule()">{{ t('aiDeid.rules.add') }}</button>
                </div>
                <p v-if="!overview.rules.length" class="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">{{ t('aiDeid.rules.empty') }}</p>
                <ul v-else class="space-y-2">
                    <li v-for="rule in overview.rules" :key="rule.id" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 px-4 py-3" data-test="deid-rule">
                        <div class="min-w-0 space-y-1">
                            <p class="font-bold text-gray-900">{{ rule.name }}</p>
                            <p class="flex flex-wrap gap-1.5 text-xs">
                                <span class="rounded-full bg-gray-100 px-2 py-0.5 font-bold text-gray-700">{{ t(`aiDeid.rules.kind_${rule.kind}`) }}</span>
                                <span class="rounded-full px-2 py-0.5 font-bold ring-1" :class="KIND_CLASSES[rule.placeholder_kind]">→ {{ t(`aiDeid.kinds.${rule.placeholder_kind}`) }}</span>
                                <span class="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{{ rule.languages.length ? rule.languages.map(languageLabel).join('、') : t('aiDeid.rules.all_languages') }}</span>
                            </p>
                            <p class="truncate font-mono text-xs text-gray-600">{{ rule.kind === 'regex' ? rule.pattern : `${t('aiDeid.rules.words', { n: rule.entries.length })}：${rule.entries.join('、')}` }}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-gray-700">
                                <input type="checkbox" role="switch" class="h-5 w-5 accent-emerald-600" :checked="rule.enabled" :disabled="saving" :aria-label="`${t('aiDeid.rules.enabled')}：${rule.name}`"
                                    @change="toggleRule(rule, ($event.target as HTMLInputElement).checked)" />
                                {{ t('aiDeid.rules.enabled') }}
                            </label>
                            <button type="button" class="min-h-11 rounded-xl px-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50" @click="openRule(rule)">{{ t('aiDeid.rules.edit') }}</button>
                            <button type="button" class="min-h-11 rounded-xl px-3 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50" :disabled="saving" @click="deleteRule(rule)">{{ t('aiDeid.rules.delete') }}</button>
                        </div>
                    </li>
                </ul>
            </section>

            <!-- Exceptions -->
            <section class="space-y-3 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="deid-allow-title">
                <h3 id="deid-allow-title" class="text-lg font-black text-gray-900">{{ t('aiDeid.allow_list.title') }}</h3>
                <p class="text-sm text-gray-600">{{ t('aiDeid.allow_list.hint') }}</p>
                <ul v-if="overview.allow_list.length" class="flex flex-wrap gap-2">
                    <li v-for="word in overview.allow_list" :key="word" class="flex items-center gap-1 rounded-full bg-emerald-50 pl-3 text-sm font-bold text-emerald-900">
                        {{ word }}
                        <button type="button" class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" :disabled="saving"
                            :aria-label="t('aiDeid.allow_list.remove', { word })" @click="saveAllowList(overview.allow_list.filter((item) => item !== word))">×</button>
                    </li>
                </ul>
                <p v-else class="text-sm text-gray-500">{{ t('aiDeid.allow_list.empty') }}</p>
                <form class="flex flex-wrap gap-2" @submit.prevent="addAllowWords">
                    <input v-model="allowInput" maxlength="1000" class="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('aiDeid.allow_list.placeholder')" :aria-label="t('aiDeid.allow_list.title')" />
                    <button type="submit" class="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="saving || !allowInput.trim()">{{ t('aiDeid.allow_list.add') }}</button>
                </form>
            </section>

            <!-- Test bench -->
            <section class="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="deid-test-title">
                <h3 id="deid-test-title" class="text-lg font-black text-gray-900">{{ t('aiDeid.test.title') }}</h3>
                <p class="text-sm text-gray-600">{{ t('aiDeid.test.hint') }}</p>
                <form class="space-y-3" @submit.prevent="runTest">
                    <label class="block text-sm font-bold text-gray-700">{{ t('aiDeid.test.text') }}
                        <textarea v-model="testForm.text" rows="4" maxlength="5000" class="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm leading-relaxed"></textarea>
                    </label>
                    <fieldset>
                        <legend class="text-sm font-bold text-gray-700">{{ t('aiDeid.test.names') }}</legend>
                        <p class="text-xs text-gray-600">{{ t('aiDeid.test.names_hint') }}</p>
                        <div class="mt-1 grid gap-2 sm:grid-cols-3">
                            <label v-for="field in (['students', 'teachers', 'schools'] as const)" :key="field" class="block text-xs font-bold text-gray-700">{{ t(`aiDeid.test.${field}`) }}
                                <input v-model="testForm[field]" maxlength="500" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" />
                            </label>
                        </div>
                    </fieldset>
                    <div class="flex flex-wrap items-center gap-3">
                        <label v-if="draft" class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-gray-800">
                            <input v-model="useDraft" type="checkbox" class="h-5 w-5 accent-emerald-600" />
                            {{ t('aiDeid.test.use_draft') }}
                        </label>
                        <button v-if="draft && !drawerOpen" type="button" class="min-h-11 rounded-xl px-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50" @click="drawerOpen = true">{{ t('aiDeid.test.continue_draft') }}</button>
                        <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="testing || !testForm.text.trim() || overview.connection !== 'ok'">
                            {{ testing ? t('aiDeid.test.running') : t('aiDeid.test.run') }}
                        </button>
                    </div>
                </form>

                <div aria-live="polite" class="space-y-3" data-test="deid-test-result">
                    <p v-if="testError" class="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-800" role="alert">{{ testError }}</p>
                    <template v-if="testResult">
                        <p v-if="testResult.ignored_exceptions.length" class="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            {{ t('aiDeid.test.ignored', { words: testResult.ignored_exceptions.join('、') }) }}
                        </p>
                        <div class="grid gap-3 lg:grid-cols-2">
                            <div class="rounded-2xl border border-gray-200 p-4">
                                <h4 class="text-sm font-black text-gray-800">{{ t('aiDeid.test.original') }}</h4>
                                <p class="mt-2 whitespace-pre-wrap text-sm leading-loose text-gray-900" data-test="deid-original"><template v-for="(piece, index) in segments" :key="index"><mark v-if="piece.span"
                                    class="rounded px-1 ring-1" :class="KIND_CLASSES[piece.span.kind]" :data-kind="piece.span.kind">{{ piece.text }}<span
                                        class="ml-1 rounded bg-white/70 px-1 text-[10px] font-black">{{ t(`aiDeid.kinds.${piece.span.kind}`) }}</span></mark><template v-else>{{ piece.text }}</template></template></p>
                            </div>
                            <div class="rounded-2xl border border-gray-200 p-4">
                                <h4 class="text-sm font-black text-gray-800">{{ t('aiDeid.test.result') }}</h4>
                                <p class="mt-2 whitespace-pre-wrap text-sm leading-loose text-gray-900" data-test="deid-sanitized">{{ testResult.sanitized }}</p>
                            </div>
                        </div>
                        <div>
                            <h4 class="text-sm font-black text-gray-800">{{ testResult.spans.length ? t('aiDeid.test.hits', { n: testResult.spans.length }) : t('aiDeid.test.no_hits') }}</h4>
                            <ul class="mt-2 space-y-1 text-sm" data-test="deid-hits">
                                <li v-for="span in testResult.spans" :key="`${span.start}-${span.end}`" class="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
                                    <span class="rounded px-1.5 font-bold ring-1" :class="KIND_CLASSES[span.kind]">{{ span.text }}</span>
                                    <span aria-hidden="true">→</span>
                                    <span class="font-mono font-bold">{{ span.token }}</span>
                                    <span class="text-gray-600">{{ sourceLabel(span) }}</span>
                                </li>
                            </ul>
                        </div>
                    </template>
                </div>
            </section>
        </template>

        <!-- Rule drawer -->
        <Teleport to="body">
            <div v-if="drawerOpen && draft" class="fixed inset-0 z-[120] flex justify-end bg-gray-900/30" @click.self="drawerOpen = false" @keydown.esc="drawerOpen = false">
                <form class="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="deid-rule-title" @submit.prevent="saveRule">
                    <div class="flex items-start justify-between gap-3">
                        <h3 id="deid-rule-title" class="text-lg font-black text-gray-900">{{ draft.id ? t('aiDeid.form.edit_title') : t('aiDeid.form.new_title') }}</h3>
                        <button type="button" class="min-h-11 min-w-11 rounded-xl text-gray-600 hover:bg-gray-100" :aria-label="t('aiDeid.form.close')" @click="drawerOpen = false">×</button>
                    </div>
                    <div class="mt-4 space-y-4">
                        <label class="block text-sm font-bold text-gray-700">{{ t('aiDeid.form.name') }}
                            <input ref="nameInput" v-model="draft.name" required maxlength="100" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" />
                        </label>
                        <fieldset>
                            <legend class="text-sm font-bold text-gray-700">{{ t('aiDeid.form.kind') }}</legend>
                            <div class="mt-1 flex flex-wrap gap-2">
                                <label v-for="kind in (['deny_list', 'regex'] as const)" :key="kind" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800">
                                    <input v-model="draft.kind" type="radio" name="deid-rule-kind" class="h-5 w-5 accent-emerald-600" :value="kind" />
                                    {{ t(`aiDeid.rules.kind_${kind}`) }}
                                </label>
                            </div>
                        </fieldset>
                        <label v-if="draft.kind === 'deny_list'" class="block text-sm font-bold text-gray-700">{{ t('aiDeid.form.entries') }}
                            <textarea v-model="draft.entriesText" rows="6" required class="mt-1 w-full rounded-xl border border-gray-200 p-3 text-sm" aria-describedby="deid-entries-hint"></textarea>
                            <span id="deid-entries-hint" class="mt-1 block text-xs font-normal text-gray-600">{{ t('aiDeid.form.entries_hint') }}</span>
                            <span v-for="message in formErrors.entries ?? []" :key="message" class="mt-1 block text-xs text-red-700" role="alert">{{ message }}</span>
                        </label>
                        <div v-else>
                            <label class="block text-sm font-bold text-gray-700" for="deid-pattern">{{ t('aiDeid.form.pattern') }}</label>
                            <input id="deid-pattern" v-model="draft.pattern" required maxlength="1000" spellcheck="false" class="mt-1 min-h-11 w-full rounded-xl border px-3 font-mono text-sm"
                                :class="patternError || formErrors.pattern ? 'border-red-400' : 'border-gray-200'" aria-describedby="deid-pattern-hint deid-pattern-error" :aria-invalid="Boolean(patternError || formErrors.pattern)" />
                            <p id="deid-pattern-error" aria-live="polite" class="text-xs text-red-700">
                                <span v-if="patternError" class="mt-1 block">{{ t('aiDeid.form.pattern_invalid', { message: patternError }) }}</span>
                                <span v-for="message in formErrors.pattern ?? []" :key="message" class="mt-1 block">{{ t('aiDeid.form.pattern_invalid', { message }) }}</span>
                            </p>
                            <p id="deid-pattern-hint" class="mt-1 text-xs text-gray-600">{{ t('aiDeid.form.pattern_hint') }}</p>
                            <div class="mt-1 flex flex-wrap gap-2">
                                <button v-for="example in PATTERN_EXAMPLES" :key="example.key" type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                                    :title="example.pattern" @click="draft.pattern = example.pattern; formErrors = {}">{{ t(`aiDeid.examples.${example.key}`) }}</button>
                            </div>
                        </div>
                        <label class="block text-sm font-bold text-gray-700">{{ t('aiDeid.form.placeholder_kind') }}
                            <select v-model="draft.placeholder_kind" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm">
                                <option v-for="kind in DEID_PLACEHOLDER_KINDS" :key="kind" :value="kind">{{ t(`aiDeid.kinds.${kind}`) }}</option>
                            </select>
                        </label>
                        <fieldset>
                            <legend class="text-sm font-bold text-gray-700">{{ t('aiDeid.form.languages') }}</legend>
                            <p class="text-xs text-gray-600">{{ t('aiDeid.form.languages_hint') }}</p>
                            <div class="mt-1 flex flex-wrap gap-2">
                                <label v-for="code in overview?.available_languages ?? []" :key="code" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800">
                                    <input type="checkbox" class="h-5 w-5 accent-emerald-600" :checked="draft.languages.includes(code)" @change="toggleDraftLanguage(code, ($event.target as HTMLInputElement).checked)" />
                                    {{ languageLabel(code) }}
                                </label>
                            </div>
                        </fieldset>
                        <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-bold text-gray-800">
                            <input v-model="draft.enabled" type="checkbox" class="h-5 w-5 accent-emerald-600" />
                            {{ t('aiDeid.form.enabled') }}
                        </label>
                    </div>
                    <div class="mt-auto flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                        <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving">{{ t('aiDeid.form.save') }}</button>
                        <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            :disabled="overview?.connection !== 'ok'" @click="testDraft">{{ t('aiDeid.form.test_draft') }}</button>
                        <button type="button" class="min-h-11 rounded-xl px-4 text-sm font-bold text-gray-700 hover:bg-gray-50" @click="discardDraft">{{ t('aiDeid.form.cancel') }}</button>
                    </div>
                </form>
            </div>
        </Teleport>
    </div>
</template>
