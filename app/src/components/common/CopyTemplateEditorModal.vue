<template>
    <Teleport to="body">
    <div v-if="modelValue" class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-3 py-4 sm:px-6 backdrop-blur-sm">
        <div class="relative flex h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5">
            <div class="shrink-0 border-b border-gray-100 bg-gray-50/70 px-6 py-4 backdrop-blur-sm">
                <div class="flex items-center justify-between gap-3">
                    <h3 class="text-xl font-bold text-gray-900">{{ title }}</h3>
                    <button type="button" class="text-gray-400 transition-colors hover:text-gray-600" @click="closeModal">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="relative min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
                <div class="h-full">
                    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1 sm:pr-2">
                        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                            <p class="text-sm font-semibold text-slate-700">{{ hint }}</p>
                            <p class="mt-1 text-xs text-slate-500">{{ previewHint }}</p>
                        </div>

                        <slot name="controls" />

                        <div class="space-y-3">
                            <div class="flex items-center justify-between gap-3">
                                <p class="text-sm font-bold text-gray-700">{{ variableTitle }}</p>
                                <span class="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{{ variableCount }} vars</span>
                            </div>
                            <slot name="variables" />
                        </div>

                        <div v-if="editableFields.length > 0" class="space-y-4">
                            <div
                                v-for="(field, index) in editableFields"
                                :key="field.id"
                                class="grid grid-cols-1 gap-3 lg:grid-cols-2"
                            >
                                <div class="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
                                    <div class="mb-2 flex items-center justify-between gap-3">
                                        <label class="block text-sm font-bold text-blue-900">{{ field.label }}</label>
                                        <span class="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">Editor</span>
                                    </div>
                                    <textarea
                                        :ref="el => setTextareaRef(field.id, el)"
                                        :value="field.content"
                                        rows="6"
                                        :class="[
                                            'w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-emerald-500',
                                            focusedFieldId === field.id ? 'ring-2 ring-emerald-500' : ''
                                        ]"
                                        @input="onFieldInput(field.id, $event)"
                                        @focus="focusedFieldId = field.id"
                                    ></textarea>
                                </div>

                                <div class="flex flex-col rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
                                    <div class="mb-3 shrink-0">
                                        <div class="mb-1 flex items-center justify-between gap-3">
                                            <p class="text-sm font-bold text-emerald-900">{{ field.label }}</p>
                                            <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Preview</span>
                                        </div>
                                        <p class="text-xs text-emerald-700/80">{{ previewHint }}</p>
                                    </div>
                                    <div class="flex-1 overflow-auto rounded-2xl border border-emerald-200 bg-white p-4">
                                        <pre class="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-800">{{ getPairPreview(index) || previewEmpty }}</pre>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div class="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
                                <div class="mb-2 flex items-center justify-between gap-3">
                                    <label class="block text-sm font-bold text-blue-900">{{ contentTitle }}</label>
                                    <span class="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">Editor</span>
                                </div>
                                <textarea
                                    :value="templateText"
                                    rows="14"
                                    class="min-h-[18rem] w-full rounded-2xl border border-blue-200 bg-white px-4 py-3 font-mono text-sm leading-6 outline-none focus:ring-2 focus:ring-emerald-500"
                                    @input="onTemplateInput"
                                ></textarea>
                            </div>

                            <div class="flex min-h-[18rem] flex-col rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
                                <div class="mb-3 shrink-0">
                                    <div class="mb-1 flex items-center justify-between gap-3">
                                        <p class="text-sm font-bold text-emerald-900">{{ previewTitle }}</p>
                                        <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">Preview</span>
                                    </div>
                                    <p class="text-xs text-emerald-700/80">{{ previewHint }}</p>
                                </div>

                                <div v-if="previewSections.length > 0" class="flex-1 overflow-auto rounded-2xl border border-emerald-200 bg-white p-3 space-y-3">
                                    <div
                                        v-for="section in previewSections"
                                        :key="section.title"
                                        class="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"
                                    >
                                        <p class="mb-1 text-xs font-bold uppercase tracking-wide text-emerald-800">{{ section.title }}</p>
                                        <pre class="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-800">{{ section.content || previewEmpty }}</pre>
                                    </div>
                                </div>
                                <div v-else-if="previewText" class="flex-1 overflow-auto rounded-2xl border border-emerald-200 bg-white p-4">
                                    <pre class="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-800">{{ previewText }}</pre>
                                </div>
                                <div v-else class="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-emerald-300 bg-white px-4 py-6 text-center text-sm text-emerald-700">
                                    {{ previewEmpty }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tooltip Preview -->
                <div v-if="showVariableTooltip" class="fixed z-[71] rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-xl" :style="tooltipStyle">
                    <div class="font-mono text-xs">{{ tooltipContent }}</div>
                    <div class="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-gray-900"></div>
                </div>

                <div v-if="isLoading" class="absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-white/70 backdrop-blur-[1px]">
                    <div class="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-lg">
                        <svg class="h-8 w-8 animate-spin text-emerald-600" viewBox="0 0 24 24" fill="none">
                            <circle class="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                            <path class="opacity-100" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <div class="text-center">
                            <p class="text-sm font-bold text-slate-800">{{ loadingText }}</p>
                            <p class="mt-1 text-xs text-slate-500">{{ loadingHint }}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="shrink-0 border-t border-gray-100 bg-gray-50/70 px-6 py-5">
                <div class="flex justify-end gap-3">
                    <button type="button" @click="closeModal" class="rounded-xl px-5 py-2.5 font-bold text-gray-600 transition-all hover:bg-gray-200/60">
                        {{ cancelText }}
                    </button>
                    <button
                        type="button"
                        @click="emit('save')"
                        :disabled="saveLoading || saveDisabled"
                        class="rounded-xl bg-emerald-600 px-6 py-2.5 font-bold text-white transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {{ saveLoading ? savingText : saveText }}
                    </button>
                </div>
            </div>
        </div>
    </div>
    </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface EditableField {
    id: string
    label: string
    content: string
}

interface Props {
    modelValue: boolean
    title: string
    hint: string
    variableTitle: string
    contentTitle?: string
    previewTitle: string
    previewHint: string
    previewEmpty: string
    templateText?: string
    previewText?: string
    previewSections?: Array<{ title: string; content: string }>
    variableCount: number
    isLoading?: boolean
    loadingText?: string
    loadingHint?: string
    saveLoading?: boolean
    saveDisabled?: boolean
    cancelText: string
    saveText: string
    savingText: string
    editableFields?: EditableField[]
    variablePreview?: Record<string, string>
}

const props = withDefaults(defineProps<Props>(), {
    isLoading: false,
    loadingText: 'Loading...',
    loadingHint: '',
    saveLoading: false,
    saveDisabled: false,
    previewSections: () => [],
    editableFields: () => [],
    variablePreview: () => ({})
})

const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    'update:templateText': [value: string]
    'update:editableFieldsContent': [fields: EditableField[]]
    'insertVariable': [fieldId: string, variable: string]
    save: []
}>()

// State
const focusedFieldId = ref<string | null>(null)
const textareaRefs = ref<Record<string, HTMLTextAreaElement>>({})
const showVariableTooltip = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })

// Methods
function closeModal() {
    emit('update:modelValue', false)
}

function setTextareaRef(fieldId: string, el: any) {
    if (el) {
        textareaRefs.value[fieldId] = el
    }
}

function onFieldInput(fieldId: string, event: Event) {
    const target = event.target as HTMLTextAreaElement
    const updatedFields = props.editableFields?.map(f => 
        f.id === fieldId ? { ...f, content: target.value } : f
    ) || []
    emit('update:editableFieldsContent', updatedFields)
}

function onTemplateInput(event: Event) {
    const target = event.target as HTMLTextAreaElement
    emit('update:templateText', target.value)
}

function insertVariableAtFocus(variable: string) {
    if (focusedFieldId.value) {
        emit('insertVariable', focusedFieldId.value, variable)
    }
}

function showVariablePreview(variable: string, event: MouseEvent) {
    const value = props.variablePreview?.[variable] ?? ''
    const displayValue = value.trim() ? value : '-'
    const target = event.currentTarget as HTMLElement | null
    if (!target) {
        return
    }

    const rect = target.getBoundingClientRect()
    tooltipContent.value = `{{${variable}}} = ${displayValue}`
    tooltipStyle.value = {
        top: `${rect.bottom + 8}px`,
        left: `${rect.left + rect.width / 2}px`,
        transform: 'translateX(-50%)'
    }
    showVariableTooltip.value = true
}

function hideVariablePreview() {
    showVariableTooltip.value = false
}

function getPairPreview(index: number): string {
    return props.previewSections?.[index]?.content ?? ''
}



// Expose methods for use in parent
defineExpose({
    insertVariableAtFocus,
    showVariablePreview,
    hideVariablePreview
})
</script>
