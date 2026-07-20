<template>
    <div class="text-editor-shell" :data-disabled="disabled" :data-preset="preset" :style="appearanceStyle">
        <EditorContent :editor="editor" class="text-editor-content" />
        <div v-if="showPlaceholder" class="text-editor-placeholder">
            {{ placeholder }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import { observeXmlFragmentDeep } from '@/utils/yjsDeepObserver'
import { useTextEditorAppearance } from './useTextEditorAppearance'
import {
    normalizeTextContent,
    textToEditorHtml,
    type TextEditorActivity,
    type TextEditorChange,
    type TextEditorChangeSource,
    type TextEditorPreset,
    type TextEditorReplaceOptions,
    type TextEditorResize
} from './types'
import './textEditor.css'

interface Props {
    modelValue?: string | null
    ydoc: Y.Doc
    fieldName: string
    provider?: any
    user?: { name: string; color: string }
    placeholder?: string
    disabled?: boolean
    preset?: TextEditorPreset
    fontScale?: number
    minHeight?: number
    mono?: boolean | null
    resize?: TextEditorResize
}

const props = withDefaults(defineProps<Props>(), {
    provider: undefined,
    user: () => ({ name: 'Anonymous', color: '#fca5a5' }),
    placeholder: '',
    disabled: false,
    preset: 'notes',
    mono: null
})

const emit = defineEmits<{
    'update:modelValue': [value: string]
    change: [payload: TextEditorChange]
    activity: [payload: TextEditorActivity]
}>()

const focused = ref(false)
const contentRevision = ref(0)
let lastPublishedValue = normalizeTextContent(props.modelValue)

const { appearanceStyle } = useTextEditorAppearance({
    preset: toRef(props, 'preset'),
    minHeight: toRef(props, 'minHeight'),
    fontScale: toRef(props, 'fontScale'),
    mono: toRef(props, 'mono'),
    resize: toRef(props, 'resize')
})

const editor = new Editor({
    extensions: [
        StarterKit.configure({
            history: false,
            undoRedo: false
        } as Record<string, unknown>),
        Collaboration.configure({
            document: props.ydoc,
            field: props.fieldName
        }),
        CollaborationCaret.configure({
            provider: props.provider,
            user: props.user
        })
    ],
    editable: !props.disabled,
    editorProps: {
        attributes: {
            class: 'text-editor-tiptap'
        },
        handleKeyDown: (_, event) => {
            if (event.key !== 'Tab') return false
            event.preventDefault()
            editor.commands.insertContent('  ')
            return true
        }
    },
    onFocus: ({ editor }) => {
        focused.value = true
        emit('activity', getSelection(editor))
    },
    onBlur: () => {
        focused.value = false
    },
    onSelectionUpdate: ({ editor }) => {
        emit('activity', getSelection(editor))
    }
})

function getSelection(value: { state: { selection: { from: number; to: number } } }): TextEditorActivity {
    return {
        caret: value.state.selection.from,
        selectionEnd: value.state.selection.to
    }
}

function getText(): string {
    return normalizeTextContent(editor.getText({ blockSeparator: '\n' }))
}

function publishContent(source: TextEditorChangeSource): void {
    const value = getText()
    contentRevision.value += 1
    if (value === lastPublishedValue) return

    lastPublishedValue = value
    emit('update:modelValue', value)
    emit('change', { value, source })
    emit('activity', getSelection(editor))
}

const fragment = props.ydoc.getXmlFragment(props.fieldName)
const stopObserving = observeXmlFragmentDeep(fragment, (_events, transaction) => {
    void nextTick(() => publishContent(transaction.local ? 'local' : 'remote'))
})

function focus(): void {
    editor.commands.focus()
}

function replaceText(value: string, options: TextEditorReplaceOptions = {}): void {
    const normalized = normalizeTextContent(value)
    lastPublishedValue = normalized
    editor.commands.setContent(textToEditorHtml(normalized), { emitUpdate: false })
    contentRevision.value += 1
    emit('update:modelValue', normalized)
    if (options.emitChange === true) {
        emit('change', { value: normalized, source: 'local' })
    }
}

function insertText(value: string): void {
    if (props.disabled) return
    editor.chain().focus().insertContent(normalizeTextContent(value)).run()
}

watch(
    () => props.disabled,
    (disabled) => editor.setEditable(!disabled)
)

watch(
    () => props.user,
    (user) => editor.commands.updateUser(user),
    { deep: true }
)

watch(
    () => props.modelValue,
    (value) => {
        const normalized = normalizeTextContent(value)
        if (normalized !== getText()) replaceText(normalized)
    }
)

const showPlaceholder = computed(() => {
    void contentRevision.value
    return !focused.value && editor.isEmpty && !!props.placeholder
})

onBeforeUnmount(() => {
    stopObserving()
    editor.destroy()
})

defineExpose({ editor, focus, getText, insertText, replaceText })
</script>
