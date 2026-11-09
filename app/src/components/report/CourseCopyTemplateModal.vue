<script setup lang="ts">
import { ref } from 'vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import CopyTemplateEditorModal from '@/components/copy-template/CopyTemplateEditorModal.vue'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'

defineProps<{
    templateText: string
    templateDocument: RichTextDocumentV1
    previewText: string
    variables: Array<{
        key: string
        token: string
        label: string
        description: string
        previewValue: string
        modeOptions?: Array<{ label: string; value: string }>
    }>
    loadOptions: Array<{ label: string; value: string }>
    isLoading: boolean
    isSaving: boolean
}>()

const emit = defineEmits<{
    'update:templateText': [value: string]
    'update:templateDocument': [value: RichTextDocumentV1]
    'load-selected': []
    save: []
}>()

const open = defineModel<boolean>({ required: true })
const loadKey = defineModel<string>('loadKey', { required: true })
const modes = defineModel<Record<string, string>>('modes', { required: true })

const courseTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
</script>

<template>
    <CopyTemplateEditorModal ref="courseTemplateModal" v-model="open"
        :title="$t('report.editor.copy_course_template_title')"
        :hint="$t('report.editor.copy_course_template_hint')"
        :variable-title="$t('report.editor.copy_course_template_variables')"
        :content-title="$t('report.editor.copy_course_template_content')"
        :preview-title="$t('report.editor.copy_course_template_preview_title')"
        :preview-hint="$t('report.editor.copy_course_template_preview_hint')"
        :preview-empty="$t('report.editor.copy_course_template_preview_empty')"
        :template-text="templateText" :template-document="templateDocument" :preview-text="previewText"
        :variable-count="variables.length" :is-loading="isLoading"
        :loading-text="$t('report.editor.copy_course_template_loading')"
        :loading-hint="$t('report.editor.copy_course_template_loading_hint')"
        :save-loading="isSaving" :cancel-text="$t('common.cancel')" :save-text="$t('common.save')"
        :saving-text="$t('report.saving')" @update:template-text="emit('update:templateText', $event)"
        @update:template-document="emit('update:templateDocument', $event)"
        @save="emit('save')">
        <template #controls>
            <div class="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                <div class="flex flex-col gap-2 md:flex-row md:items-end">
                    <div class="flex-1">
                        <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1" for="edulog-reporteditor-593-41796">
                            {{ $t('report.editor.copy_course_template_load_from') }}
                        </label>
                        <BaseDropdown v-model="loadKey"
                            :options="loadOptions" theme="amber"  id="edulog-reporteditor-593-41796"/>
                    </div>
                    <button @click="emit('load-selected')"
                        class="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600"
                        :disabled="!loadKey">
                        {{ $t('report.editor.copy_course_template_load_action') }}
                    </button>
                </div>
            </div>
        </template>
        <template #variables>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div v-for="variable in variables" :key="variable.key"
                    class="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <p class="text-sm font-bold leading-tight text-gray-900">{{ variable.label }}</p>
                            <p class="mt-1 text-xs leading-5 text-gray-500">{{ variable.description }}</p>
                        </div>
                        <button @click="courseTemplateModal?.insertVariableAtFocus?.(variable.token)"
                            class="shrink-0 whitespace-nowrap rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                            :title="variable.token">
                            {{ variable.token }}
                        </button>
                    </div>

                    <div v-if="variable.modeOptions?.length" class="space-y-1">
                        <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500" for="edulog-reporteditor-624-43897">
                            {{ $t('report.editor.copy_course_template_variable_mode_label') }}
                        </label>
                        <BaseDropdown :model-value="modes[variable.key]"
                            @update:model-value="modes = { ...modes, [variable.key]: $event }"
                            :options="variable.modeOptions || []" theme="emerald"  id="edulog-reporteditor-624-43897"/>
                    </div>

                    <div>
                        <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            {{ $t('report.editor.copy_course_template_preview_title') }}
                        </p>
                        <p
                            class="min-h-[3.25rem] whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                            {{ variable.previewValue || '—' }}
                        </p>
                    </div>
                </div>
            </div>
        </template>
    </CopyTemplateEditorModal>
</template>
