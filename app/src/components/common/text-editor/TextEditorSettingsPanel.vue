<template>
    <fieldset class="text-editor-settings" :disabled="disabled">
        <label><input type="checkbox" :checked="enabled" @change="toggleEnabled"> {{ t('editor.settings.style_controls') }}</label>
        <template v-if="enabled">
            <label>{{ t('editor.settings.preset') }}
                <select :value="preset" @change="emitPreset">
                    <option v-for="value in presets" :key="value" :value="value">{{ t(`editor.settings.presets.${value}`) }}</option>
                </select>
            </label>
            <label>{{ t('editor.settings.font_scale') }}
                <input type="number" min="70" max="200" step="10" :value="style.fontScale"
                    @change="emitNumber('fontScale', $event)">
            </label>
            <label>{{ t('editor.settings.minimum_height') }}
                <input type="number" min="0" max="1200" step="10" :value="style.minHeight"
                    @change="emitNumber('minHeight', $event)">
            </label>
            <label><input type="checkbox" :checked="style.mono" @change="emitBoolean('mono', $event)"> {{ t('editor.settings.monospace') }}</label>
            <label><input type="checkbox" :checked="style.resize === 'vertical'" @change="emitResize"> {{ t('editor.settings.resizable') }}</label>
            <button type="button" :aria-label="t('editor.settings.reset')" @click="$emit('reset')">{{ t('editor.settings.reset') }}</button>
        </template>
    </fieldset>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { TextEditorAppearance, TextEditorPreset } from './types'

const props = withDefaults(defineProps<{
    enabled?: boolean
    disabled?: boolean
    preset: TextEditorPreset
    style: TextEditorAppearance
}>(), { enabled: true, disabled: false })

const { t } = useI18n()

const emit = defineEmits<{
    'update:enabled': [enabled: boolean]
    'update:preset': [preset: TextEditorPreset]
    change: [style: Partial<TextEditorAppearance>]
    reset: []
}>()

const presets: TextEditorPreset[] = ['form', 'notes', 'report', 'template', 'merge']
function toggleEnabled(event: Event) { emit('update:enabled', (event.target as HTMLInputElement).checked) }
function emitPreset(event: Event) { emit('update:preset', (event.target as HTMLSelectElement).value as TextEditorPreset) }
function emitNumber(key: 'fontScale' | 'minHeight', event: Event) { emit('change', { [key]: Number((event.target as HTMLInputElement).value) }) }
function emitBoolean(key: 'mono', event: Event) { emit('change', { [key]: (event.target as HTMLInputElement).checked }) }
function emitResize(event: Event) { emit('change', { resize: (event.target as HTMLInputElement).checked ? 'vertical' : 'none' }) }
</script>

<style scoped>
.text-editor-settings { display: grid; gap: .65rem; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.text-editor-settings label { color: #4b5563; display: grid; font-size: .75rem; gap: .25rem; }
.text-editor-settings input, .text-editor-settings select, .text-editor-settings button { border: 1px solid #d1d5db; border-radius: .4rem; padding: .35rem .5rem; }
</style>
