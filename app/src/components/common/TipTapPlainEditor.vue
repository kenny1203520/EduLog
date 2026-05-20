<template>
    <div
        class="editor-shell rounded-lg border transition-colors"
        :class="[
            disabled ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300',
            focused && !disabled ? focusRingClass : ''
        ]"
        :style="{
            '--editor-min-height': `${minHeight}px`,
            '--editor-font-size': `${fontScale}%`,
            '--editor-font-family': mono
                ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace'
                : 'inherit'
        }"
    >
        <EditorContent :editor="editor" class="editor-content" />
        <div
            v-if="showPlaceholder"
            class="pointer-events-none absolute px-3 py-2 text-sm text-gray-400"
            :style="{ fontSize: `${fontScale}%` }"
        >
            {{ placeholder }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'

interface EditorActivityPayload {
    caret: number
    selectionEnd: number
}

interface Props {
    modelValue: string
    placeholder?: string
    disabled?: boolean
    fontScale?: number
    minHeight?: number
    mono?: boolean
    focusRingClass?: string
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    disabled: false,
    fontScale: 100,
    minHeight: 120,
    mono: false,
    focusRingClass: 'ring-2 ring-emerald-500 border-emerald-500'
})

const emit = defineEmits<{
    'update:modelValue': [value: string]
    input: [payload: EditorActivityPayload]
    activity: [payload: EditorActivityPayload]
}>()

const focused = ref(false)

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

function textToHtml(text: string): string {
    if (!text) {
        return '<p></p>'
    }

    return text
        .split('\n')
        .map((line) => `<p>${escapeHtml(line) || '<br/>'}</p>`)
        .join('')
}

function getSelectionPayload(editor: { state: { selection: { from: number; to: number } } }): EditorActivityPayload {
    return {
        caret: editor.state.selection.from,
        selectionEnd: editor.state.selection.to
    }
}

const editor = new Editor({
    extensions: [
        StarterKit
    ],
    content: textToHtml(props.modelValue || ''),
    editable: !props.disabled,
    editorProps: {
        attributes: {
            class: 'tiptap-content'
        }
    },
    onFocus: ({ editor }) => {
        focused.value = true
        emit('activity', getSelectionPayload(editor))
    },
    onBlur: () => {
        focused.value = false
    },
    onSelectionUpdate: ({ editor }) => {
        emit('activity', getSelectionPayload(editor))
    },
    onUpdate: ({ editor }) => {
        const value = editor.getText({ blockSeparator: '\n' })
        emit('update:modelValue', value)
        const payload = getSelectionPayload(editor)
        emit('input', payload)
        emit('activity', payload)
    }
})

watch(
    () => props.disabled,
    (disabled) => {
        editor.setEditable(!disabled)
    }
)

watch(
    () => props.modelValue,
    (nextValue) => {
        const current = editor.getText({ blockSeparator: '\n' })
        if (nextValue === current) {
            return
        }
        editor.commands.setContent(textToHtml(nextValue || ''), { emitUpdate: false })
    }
)

const showPlaceholder = computed(() => {
    return !focused.value && !props.modelValue?.trim() && !!props.placeholder
})

onBeforeUnmount(() => {
    editor.destroy()
})
</script>

<style scoped>
.editor-shell {
    position: relative;
}

.editor-content {
    padding: 0.5rem 0.75rem;
}

.editor-content :deep(.tiptap-content) {
    min-height: var(--editor-min-height);
    white-space: pre-wrap;
    word-break: break-word;
    outline: none;
    font-size: var(--editor-font-size);
    font-family: var(--editor-font-family);
}

.editor-content :deep(.tiptap-content p) {
    margin: 0;
}
</style>
