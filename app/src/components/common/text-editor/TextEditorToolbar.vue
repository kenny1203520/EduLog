<template>
    <div class="text-editor-toolbar" role="toolbar" aria-label="Text formatting">
        <button v-for="item in items" :key="item.command" type="button"
            :class="{ active: item.active() }" :disabled="disabled || !item.enabled()"
            :title="item.title" @mousedown.prevent @click="item.run()">
            {{ item.label }}
        </button>
        <button type="button" :disabled="disabled || !can('set-link')" title="Link"
            :class="{ active: state.link }" @mousedown.prevent @click="setLink">Link</button>
        <button type="button" :disabled="disabled || !can('unset-link')" title="Remove link"
            @mousedown.prevent @click="run('unset-link')">Unlink</button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextEditorCommand, TextEditorCommandOptions, TextEditorFormattingState } from './types'

const props = withDefaults(defineProps<{
    disabled?: boolean
    state: TextEditorFormattingState
    execute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
    canExecute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
}>(), { disabled: false })

function run(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    return props.execute(command, options)
}

function can(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    return props.canExecute(command, options)
}

function setLink(): void {
    const href = window.prompt('Link URL', 'https://')
    if (href) run('set-link', { href })
}

const items = computed(() => [
    { command: 'bold' as const, label: 'B', title: 'Bold', active: () => props.state.bold },
    { command: 'italic' as const, label: 'I', title: 'Italic', active: () => props.state.italic },
    { command: 'underline' as const, label: 'U', title: 'Underline', active: () => props.state.underline },
    { command: 'strike' as const, label: 'S', title: 'Strikethrough', active: () => props.state.strike },
    { command: 'paragraph' as const, label: 'P', title: 'Paragraph', active: () => props.state.paragraph },
    { command: 'heading-1' as const, label: 'H1', title: 'Heading 1', active: () => props.state.headingLevel === 1 },
    { command: 'heading-2' as const, label: 'H2', title: 'Heading 2', active: () => props.state.headingLevel === 2 },
    { command: 'heading-3' as const, label: 'H3', title: 'Heading 3', active: () => props.state.headingLevel === 3 },
    { command: 'bullet-list' as const, label: '• List', title: 'Bullet list', active: () => props.state.bulletList },
    { command: 'ordered-list' as const, label: '1. List', title: 'Ordered list', active: () => props.state.orderedList },
    { command: 'blockquote' as const, label: 'Quote', title: 'Blockquote', active: () => props.state.blockquote },
    { command: 'highlight' as const, label: 'Mark', title: 'Highlight', active: () => props.state.highlight },
    { command: 'clear-formatting' as const, label: 'Clear', title: 'Clear formatting', active: () => false },
    { command: 'undo' as const, label: 'Undo', title: 'Undo', active: () => false },
    { command: 'redo' as const, label: 'Redo', title: 'Redo', active: () => false }
].map(item => ({ ...item, run: () => run(item.command), enabled: () => can(item.command) })))
</script>
