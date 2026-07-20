<template>
    <div class="text-editor-shell" :data-disabled="disabled" :data-preset="preset" :style="appearanceStyle">
        <textarea
            ref="inputRef"
            class="text-editor-input"
            :value="normalizedValue"
            :disabled="disabled"
            :placeholder="placeholder"
            @input="handleInput"
            @focus="emitActivity"
            @click="emitActivity"
            @keyup="emitActivity"
            @select="emitActivity"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useTextEditorAppearance } from './useTextEditorAppearance'
import {
    normalizeTextContent,
    type TextEditorActivity,
    type TextEditorChange,
    type TextEditorPreset,
    type TextEditorReplaceOptions,
    type TextEditorResize
} from './types'
import './textEditor.css'

interface Props {
    modelValue?: string | null
    placeholder?: string
    disabled?: boolean
    preset?: TextEditorPreset
    fontScale?: number
    minHeight?: number
    mono?: boolean | null
    resize?: TextEditorResize
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    disabled: false,
    preset: 'form',
    mono: null
})

const emit = defineEmits<{
    'update:modelValue': [value: string]
    change: [payload: TextEditorChange]
    activity: [payload: TextEditorActivity]
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const normalizedValue = computed(() => normalizeTextContent(props.modelValue))
const { appearanceStyle } = useTextEditorAppearance({
    preset: toRef(props, 'preset'),
    minHeight: toRef(props, 'minHeight'),
    fontScale: toRef(props, 'fontScale'),
    mono: toRef(props, 'mono'),
    resize: toRef(props, 'resize')
})

function selection(): TextEditorActivity {
    return {
        caret: inputRef.value?.selectionStart ?? 0,
        selectionEnd: inputRef.value?.selectionEnd ?? 0
    }
}

function emitActivity(): void {
    emit('activity', selection())
}

function publish(value: string, emitChange = true): void {
    const normalized = normalizeTextContent(value)
    emit('update:modelValue', normalized)
    if (emitChange) emit('change', { value: normalized, source: 'local' })
    emitActivity()
}

function handleInput(event: Event): void {
    publish((event.target as HTMLTextAreaElement).value)
}

function focus(): void {
    inputRef.value?.focus()
}

function getText(): string {
    return normalizeTextContent(inputRef.value?.value ?? props.modelValue)
}

function replaceText(value: string, options: TextEditorReplaceOptions = {}): void {
    const normalized = normalizeTextContent(value)
    if (inputRef.value) inputRef.value.value = normalized
    publish(normalized, options.emitChange === true)
}

function insertText(value: string): void {
    const input = inputRef.value
    if (!input || props.disabled) return

    const start = input.selectionStart
    const end = input.selectionEnd
    input.setRangeText(normalizeTextContent(value), start, end, 'end')
    publish(input.value)
    input.focus()
}

defineExpose({ focus, getText, insertText, replaceText })
</script>
