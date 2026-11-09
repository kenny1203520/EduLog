<template>
    <div class="text-editor-toolbar" role="toolbar" :aria-label="t('editor.toolbar.aria_label')">
        <button v-for="item in items" :key="item.command" type="button"
            :class="{ active: item.active() }" :disabled="disabled || !item.enabled()"
            :title="item.title" :aria-label="item.title" :aria-pressed="item.active()"
            @pointerdown.prevent @click="item.run()">
            {{ item.label }}
        </button>
        <button type="button" :disabled="disabled || !can('set-link')" :title="t('editor.toolbar.link')"
            :aria-label="t('editor.toolbar.link')" :aria-pressed="state.link"
            :class="{ active: state.link }" @pointerdown.prevent @click="setLink">
            {{ t('editor.toolbar.link') }}
        </button>
        <button type="button" :disabled="disabled || !can('unset-link')"
            :title="t('editor.toolbar.remove_link')" :aria-label="t('editor.toolbar.remove_link')"
            @pointerdown.prevent @click="run('unset-link')">
            {{ t('editor.toolbar.remove_link') }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TextEditorCommand, TextEditorCommandOptions, TextEditorFormattingState } from './types'

const props = withDefaults(defineProps<{
    disabled?: boolean
    state: TextEditorFormattingState
    execute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
    canExecute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
}>(), { disabled: false })

const { t } = useI18n()

function run(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    return props.execute(command, options)
}

function can(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    return props.canExecute(command, options)
}

function setLink(): void {
    const href = window.prompt(t('editor.toolbar.link_url_prompt'), 'https://')
    if (href) run('set-link', { href })
}

const items = computed(() => [
    { command: 'bold' as const, label: 'B', title: t('editor.toolbar.bold'), active: () => props.state.bold },
    { command: 'italic' as const, label: 'I', title: t('editor.toolbar.italic'), active: () => props.state.italic },
    { command: 'underline' as const, label: 'U', title: t('editor.toolbar.underline'), active: () => props.state.underline },
    { command: 'strike' as const, label: 'S', title: t('editor.toolbar.strikethrough'), active: () => props.state.strike },
    { command: 'paragraph' as const, label: 'P', title: t('editor.toolbar.paragraph'), active: () => props.state.paragraph },
    { command: 'heading-1' as const, label: 'H1', title: t('editor.toolbar.heading_1'), active: () => props.state.headingLevel === 1 },
    { command: 'heading-2' as const, label: 'H2', title: t('editor.toolbar.heading_2'), active: () => props.state.headingLevel === 2 },
    { command: 'heading-3' as const, label: 'H3', title: t('editor.toolbar.heading_3'), active: () => props.state.headingLevel === 3 },
    { command: 'bullet-list' as const, label: t('editor.toolbar.bullet_list'), title: t('editor.toolbar.bullet_list'), active: () => props.state.bulletList },
    { command: 'ordered-list' as const, label: t('editor.toolbar.ordered_list'), title: t('editor.toolbar.ordered_list'), active: () => props.state.orderedList },
    { command: 'blockquote' as const, label: t('editor.toolbar.blockquote'), title: t('editor.toolbar.blockquote'), active: () => props.state.blockquote },
    { command: 'highlight' as const, label: t('editor.toolbar.highlight'), title: t('editor.toolbar.highlight'), active: () => props.state.highlight },
    { command: 'clear-formatting' as const, label: t('editor.toolbar.clear_formatting'), title: t('editor.toolbar.clear_formatting'), active: () => false },
    { command: 'undo' as const, label: t('editor.toolbar.undo'), title: t('editor.toolbar.undo'), active: () => false },
    { command: 'redo' as const, label: t('editor.toolbar.redo'), title: t('editor.toolbar.redo'), active: () => false }
].map(item => ({ ...item, run: () => run(item.command), enabled: () => can(item.command) })))
</script>
