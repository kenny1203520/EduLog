<script setup lang="ts">
import { ref } from 'vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import CopyTemplateEditorModal from '@/components/copy-template/CopyTemplateEditorModal.vue'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import type { ReportTemplateVariableItem } from '@/composables/report/useReportTemplateManager'

type EditableField = { id: string; label: string; content: string; document?: RichTextDocumentV1 }

defineProps<{
    previewText: string
    previewSections: Array<{ title: string; content: string }>
    variables: ReportTemplateVariableItem[]
    variablePreview: Record<string, string>
    editableFields: EditableField[]
    templateOptions: Array<{ label: string; value: string }>
    isLoading: boolean
    isSaving: boolean
}>()

const emit = defineEmits<{
    'update:editable-fields-content': [fields: EditableField[]]
    'insert-variable': [fieldId: string, variable: string, caret?: number, selectionEnd?: number]
    'selection-change': []
    'new-draft': []
    delete: []
    apply: []
    save: []
}>()

const open = defineModel<boolean>({ required: true })
const selectedTemplateId = defineModel<string>('selectedTemplateId', { required: true })
const draftName = defineModel<string>('draftName', { required: true })
const modes = defineModel<Record<string, string>>('modes', { required: true })

const reportTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
</script>

<template>
    <CopyTemplateEditorModal ref="reportTemplateModal" v-model="open"
        :title="$t('report.editor.template_manager_title')" :hint="$t('report.editor.template_manager_hint')"
        :variable-title="$t('report.editor.template_manager_fields')"
        :preview-title="$t('report.editor.template_preview_title')"
        :preview-hint="$t('report.editor.template_preview_hint')"
        :preview-empty="$t('report.editor.template_preview_empty')" :preview-text="previewText"
        :preview-sections="previewSections" :variable-count="variables.length"
        :is-loading="isLoading" :loading-text="$t('report.editor.template_manager_loading')"
        :loading-hint="$t('report.editor.template_manager_loading_hint')" :save-loading="isSaving"
        :save-disabled="!draftName.trim()" :cancel-text="$t('common.cancel')"
        :save-text="$t('report.editor.template_save_action')" :saving-text="$t('report.saving')"
        :editable-fields="editableFields" :variable-preview="variablePreview"
        @update:editable-fields-content="emit('update:editable-fields-content', $event)"
        @insert-variable="(...args) => emit('insert-variable', ...args)"
        @save="emit('save')">
        <template #controls>
            <div class="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-3">
                <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                    <div>
                        <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1" for="edulog-reporteditor-663-46675">
                            {{ $t('report.editor.template_select_label') }}
                        </label>
                        <BaseDropdown v-model="selectedTemplateId" :options="templateOptions" theme="amber"
                            @change="emit('selection-change')"  id="edulog-reporteditor-663-46675"/>
                    </div>
                    <button @click="emit('new-draft')"
                        class="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100">
                        {{ $t('report.editor.template_new_action') }}
                    </button>
                    <button @click="emit('delete')" :disabled="!selectedTemplateId"
                        class="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                        {{ $t('common.delete') }}
                    </button>
                </div>

                <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
                    <div>
                        <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1" for="edulog-reporteditor-681-47986">
                            {{ $t('report.editor.template_name_label') }}
                        </label>
                        <input v-model="draftName" type="text"
                            :placeholder="$t('report.editor.template_name_placeholder')"
                            class="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"  id="edulog-reporteditor-681-47986"/>
                    </div>
                    <button @click="emit('apply')"
                        class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700">
                        {{ $t('report.editor.template_apply_to_report') }}
                    </button>
                </div>

                <div class="rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-2">
                    <div class="flex flex-wrap gap-2">
                        <button v-for="variable in variables" :key="variable.key"
                            @click="reportTemplateModal?.insertVariableAtFocus?.(variable.key)"
                            @mouseenter="reportTemplateModal?.showVariablePreview?.(variable.key, $event)"
                            @mouseleave="reportTemplateModal?.hideVariablePreview?.()"
                            class="relative rounded-lg bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-800 transition hover:bg-purple-200"
                            :title="variable.description">
                            {{ variable.token }}
                        </button>
                    </div>
                    <p class="text-xs text-purple-700">{{ $t('report.editor.template_variable_auto_insert_hint') }}
                    </p>

                    <!-- Variable Mode Selectors -->
                    <div v-if="variables.some(v => v.modes?.length)"
                        class="mt-2 pt-2 border-t border-purple-200/50">
                        <div class="flex flex-wrap gap-4">
                            <div v-for="variable in variables.filter(v => v.modes?.length)"
                                :key="variable.key" class="space-y-1">
                                <label
                                    class="block text-[10px] font-bold uppercase tracking-wider text-purple-900/60" for="edulog-reporteditor-714-50404">
                                    {{ variable.label }} {{
                                        $t('report.editor.copy_course_template_variable_mode_label') }}
                                </label>
                                <BaseDropdown :model-value="modes[variable.key]"
                                    @update:model-value="modes = { ...modes, [variable.key]: $event }"
                                    :options="(variable.modes || []).map(m => ({ label: $t(`report.editor.copy_course_template_variable_modes.${m.value}`), value: m.value }))"
                                    theme="emerald"  id="edulog-reporteditor-714-50404"/>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <template #variables>
            <!-- Variables section can be empty as we're using inline variable buttons in controls -->
        </template>
    </CopyTemplateEditorModal>
</template>
