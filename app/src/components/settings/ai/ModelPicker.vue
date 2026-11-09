<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { AiSettingsService, type CatalogModel } from '@/services/ai/AiSettingsService'

/**
 * Pick a model id from the provider's own list, or type one when the
 * provider has no list (ChatGPT plan, unreachable endpoint) or the model is
 * not listed. Emits the chosen model with any price the provider published.
 */
const props = defineProps<{ scope: 'personal' | 'site', credentialId: string }>()
const emit = defineEmits<{ (e: 'pick', model: { id: string, name: string, priceInputPerMtok?: number, priceOutputPerMtok?: number } | null): void }>()
const { t } = useI18n()

const OTHER = '__other__'
const loading = ref(false)
const models = ref<CatalogModel[]>([])
const unsupportedReason = ref<string | null>(null)
const unsupportedDetail = ref('')
const showAll = ref(false)
const selected = ref('')
const manualId = ref('')
let loadRevision = 0

const visible = computed(() => models.value.filter((model) => showAll.value || model.textCapable))
const hiddenCount = computed(() => models.value.length - models.value.filter((model) => model.textCapable).length)
const options = computed(() => [
    ...visible.value.map((model) => ({
        value: model.id,
        label: model.name === model.id ? model.id : `${model.name}（${model.id}）`,
        searchText: `${model.name} ${model.id}`,
        description: priceText(model),
    })),
    { value: OTHER, label: t('ai.settings.picker_other'), searchText: 'other 其他 manual' },
])
const manual = computed(() => unsupportedReason.value !== null || selected.value === OTHER)
const KNOWN_REASONS = ['chatgpt_plan', 'no_key', 'auth_failed', 'not_found', 'bad_request', 'rate_limited', 'provider_error', 'redirected', 'timeout', 'network', 'too_large', 'invalid_response', 'request_failed']
/** Translated cause; unknown codes (older servers sent raw messages) fall back to the generic text. */
const reasonText = computed(() => {
    const reason = unsupportedReason.value
    if (!reason) return ''
    return KNOWN_REASONS.includes(reason) ? t(`ai.settings.picker_reason.${reason}`) : t('ai.settings.picker_manual_unavailable')
})
const reasonDetail = computed(() => unsupportedDetail.value || (unsupportedReason.value && !KNOWN_REASONS.includes(unsupportedReason.value) ? unsupportedReason.value : ''))

function priceText(model: CatalogModel): string {
    if (model.priceInputPerMtok == null || model.priceOutputPerMtok == null) return ''
    if (model.priceInputPerMtok === 0 && model.priceOutputPerMtok === 0) return t('ai.settings.free')
    return t('ai.settings.picker_price', { input: model.priceInputPerMtok, output: model.priceOutputPerMtok })
}

async function load(refresh = false) {
    const revision = ++loadRevision
    loading.value = true
    try {
        const catalog = await AiSettingsService.catalog(props.scope, props.credentialId, refresh)
        if (revision !== loadRevision) return
        if (catalog.supported) {
            models.value = catalog.models
            unsupportedReason.value = null
            unsupportedDetail.value = ''
        } else {
            models.value = []
            unsupportedReason.value = catalog.reason
            unsupportedDetail.value = catalog.detail ?? ''
        }
    } catch {
        if (revision !== loadRevision) return
        models.value = []
        unsupportedReason.value = 'request_failed'
        unsupportedDetail.value = ''
    } finally {
        if (revision === loadRevision) loading.value = false
    }
}

function choose(value: string) {
    selected.value = value
    if (value === OTHER) {
        emit('pick', manualId.value.trim() ? { id: manualId.value.trim(), name: manualId.value.trim() } : null)
        return
    }
    const model = models.value.find((item) => item.id === value)
    emit('pick', model ? { id: model.id, name: model.name, priceInputPerMtok: model.priceInputPerMtok, priceOutputPerMtok: model.priceOutputPerMtok } : null)
}

function typeManual(value: string) {
    manualId.value = value
    emit('pick', value.trim() ? { id: value.trim(), name: value.trim() } : null)
}

/** Clear the choice after the parent added the model. */
function reset() {
    selected.value = ''
    manualId.value = ''
    emit('pick', null)
}
defineExpose({ reset, reload: () => load(true) })

onMounted(() => load())
</script>

<template>
    <div class="space-y-2">
        <div v-if="unsupportedReason === null" class="flex flex-wrap items-center gap-2">
            <SearchableSelect class="min-w-0 flex-1" :model-value="selected" :options="options" :loading="loading"
                :placeholder="loading ? t('common.loading') : t('ai.settings.picker_placeholder')" :aria-label="t('ai.settings.model_id')"
                :no-results-text="t('ai.settings.picker_no_results')" description-placement="inline"
                @update:model-value="choose" />
            <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                :disabled="loading" :aria-label="t('ai.settings.picker_refresh')" :title="t('ai.settings.picker_refresh')" @click="load(true)">
                <svg class="h-4 w-4" :class="loading ? 'animate-spin motion-reduce:animate-none' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>
        </div>
        <div v-else class="flex flex-wrap items-start gap-2 rounded-xl px-3 py-2"
            :class="unsupportedReason === 'chatgpt_plan' ? 'bg-gray-50' : 'bg-amber-50'" role="status" aria-live="polite">
            <div class="min-w-0 flex-1 text-xs leading-5" :class="unsupportedReason === 'chatgpt_plan' ? 'text-gray-600' : 'text-amber-900'">
                <p class="font-bold">{{ reasonText }}</p>
                <p v-if="unsupportedReason !== 'chatgpt_plan'">{{ t('ai.settings.picker_reason.manual_hint') }}</p>
                <p v-if="reasonDetail" class="mt-1 break-words font-mono text-[11px] opacity-80">
                    <span class="sr-only">{{ t('ai.settings.picker_reason.detail_label') }}: </span>{{ reasonDetail }}
                </p>
            </div>
            <button v-if="unsupportedReason !== 'chatgpt_plan'" type="button" class="min-h-11 shrink-0 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                :disabled="loading" @click="load(true)">{{ loading ? t('common.loading') : t('ai.settings.picker_retry') }}</button>
        </div>
        <label v-if="unsupportedReason === null && hiddenCount > 0" class="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold text-gray-600" for="model-picker-show-all">
            <input id="model-picker-show-all" v-model="showAll" type="checkbox" class="h-4 w-4 accent-emerald-600" />
            {{ t('ai.settings.picker_show_all', { n: hiddenCount }) }}
        </label>
        <div v-if="manual">
            <input :value="manualId" maxlength="200" class="min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm"
                :placeholder="t('ai.settings.model_id_placeholder')" :aria-label="t('ai.settings.model_id')"
                @input="typeManual(($event.target as HTMLInputElement).value)"  id="edulog-modelpicker-22-1868"/>
        </div>
    </div>
</template>
