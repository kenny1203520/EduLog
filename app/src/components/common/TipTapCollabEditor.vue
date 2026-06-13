<template>
    <div
        class="editor-shell rounded-lg border transition-colors relative"
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
            class="pointer-events-none absolute left-3 top-2 text-sm text-gray-400"
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
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'

interface Props {
    ydoc: Y.Doc | null
    fieldName: string
    provider?: any // The awareness provider created by createAwarenessProvider
    user?: { name: string; color: string }
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
    focusRingClass: 'ring-2 ring-emerald-500 border-emerald-500',
    user: () => ({ name: 'Anonymous', color: '#fca5a5' })
})

const focused = ref(false)

const editor = new Editor({
    extensions: [
        StarterKit.configure({
            history: false,
            undoRedo: false
        } as any),
        Collaboration.configure({
            document: props.ydoc as any,
            field: props.fieldName
        }),
        CollaborationCaret.configure({
            provider: props.provider as any,
            user: props.user
        })
    ],
    editable: !props.disabled,
    editorProps: {
        attributes: {
            class: 'tiptap-content focus:outline-none'
        },
        handleKeyDown: (_, event) => {
            if (event.key === 'Tab') {
                event.preventDefault()
                editor.commands.insertContent('  ')
                return true
            }
            return false
        }
    },
    onFocus: () => {
        focused.value = true
    },
    onBlur: () => {
        focused.value = false
    }
})

watch(
    () => props.disabled,
    (disabled) => {
        editor.setEditable(!disabled)
    }
)

watch(
    () => props.user,
    (user) => {
        editor.commands.updateUser(user)
    },
    { deep: true }
)

const showPlaceholder = computed(() => {
    // If editor has content, Tiptap automatically removes the empty paragraph when text is typed, 
    // but by default an empty Tiptap editor has a <p></p>. 
    // We check if it's practically empty.
    const isEmpty = editor.isEmpty
    return !focused.value && isEmpty && !!props.placeholder
})

onBeforeUnmount(() => {
    editor.destroy()
})

defineExpose({
    editor
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

.editor-content :deep(.tiptap-content p + p) {
    margin-top: 0.125rem;
}

/* Collaboration Caret Styles */
.editor-content :deep(.collaboration-carets__caret) {
    border-left: 2px solid;
    border-right: 2px solid;
    margin-left: -2px;
    margin-right: -2px;
    pointer-events: none;
    position: relative;
    word-break: normal;
}

.editor-content :deep(.collaboration-carets__label) {
    border-radius: 4px;
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    left: -2px;
    line-height: normal;
    padding: 0.1rem 0.3rem;
    position: absolute;
    top: -1.2rem;
    user-select: none;
    white-space: nowrap;
}
</style>
