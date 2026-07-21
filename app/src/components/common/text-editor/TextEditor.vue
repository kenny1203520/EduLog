<template>
    <div class="text-editor-shell" :data-disabled="effectiveMode === 'disabled'"
        :data-readonly="effectiveMode === 'read'" :data-preset="preset" :style="appearanceStyle">
        <TextEditorToolbar v-if="toolbarVisible && formattingEnabled && effectiveMode === 'edit'"
            :state="formattingState" :execute="execute" :can-execute="canExecute" />
        <EditorContent :editor="editor" class="text-editor-content" />
        <div v-if="showPlaceholder" class="text-editor-placeholder">{{ placeholder }}</div>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { createTextEditorExtensions, isAllowedEditorUrl } from './extensions'
import { calculateTextEditorMetrics, contentEquals, createTextEditorContent, richTextToHTML } from './content'
import { useTextEditorAppearance } from './useTextEditorAppearance'
import TextEditorToolbar from './TextEditorToolbar.vue'
import {
    normalizeTextContent,
    type RichTextDocumentV1,
    type TextEditorActivity,
    type TextEditorAppearance,
    type TextEditorChange,
    type TextEditorCommand,
    type TextEditorCommandOptions,
    type TextEditorContent,
    type TextEditorContentInput,
    type TextEditorFormattingState,
    type TextEditorHtmlOptions,
    type TextEditorMetrics,
    type TextEditorMode,
    type TextEditorPreset,
    type TextEditorReplaceOptions,
    type TextEditorResize
} from './types'
import './textEditor.css'

interface Props {
    modelValue?: TextEditorContentInput
    placeholder?: string
    mode?: TextEditorMode
    disabled?: boolean
    preset?: TextEditorPreset
    fontScale?: number
    minHeight?: number
    mono?: boolean | null
    resize?: TextEditorResize
    lineHeight?: number
    formattingEnabled?: boolean
    toolbarVisible?: boolean
    styleControlsEnabled?: boolean
    templateVariables?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '', mode: 'edit', disabled: false, preset: 'form', mono: null,
    formattingEnabled: true, toolbarVisible: true, styleControlsEnabled: true,
    templateVariables: false
})

const emit = defineEmits<{
    'update:modelValue': [value: any]
    change: [payload: TextEditorChange]
    activity: [payload: TextEditorActivity]
    'metrics-change': [metrics: TextEditorMetrics]
    'style-change': [style: TextEditorAppearance]
    'mode-change': [mode: TextEditorMode]
}>()

const effectiveMode = ref<TextEditorMode>(props.disabled ? 'disabled' : props.mode)
const documentAppearance = ref<Partial<TextEditorAppearance> | undefined>(
    createTextEditorContent(props.modelValue, { templateVariables: props.templateVariables }).richText.appearance
)
const { appearance, appearanceStyle } = useTextEditorAppearance({
    preset: toRef(props, 'preset'), minHeight: toRef(props, 'minHeight'),
    fontScale: toRef(props, 'fontScale'), mono: toRef(props, 'mono'), resize: toRef(props, 'resize'),
    lineHeight: toRef(props, 'lineHeight'), documentAppearance
})
const formattingRevision = ref(0)

const editor = new Editor({
    extensions: createTextEditorExtensions({ templateVariables: props.templateVariables }),
    content: createTextEditorContent(props.modelValue, { templateVariables: props.templateVariables }).richText.doc,
    editable: effectiveMode.value === 'edit',
    editorProps: { attributes: { class: 'text-editor-tiptap' } },
    onUpdate: () => publishContent('local'),
    onSelectionUpdate: () => { formattingRevision.value++; emitActivity() },
    onFocus: emitActivity
})

let lastContent = getContent()

function getSelection(): TextEditorActivity {
    return { caret: editor.state.selection.from, selectionEnd: editor.state.selection.to }
}
function emitActivity(): void { emit('activity', getSelection()) }
function getContent(): TextEditorContent {
    return createTextEditorContent({
        schemaVersion: 1,
        doc: editor.getJSON(),
        ...(documentAppearance.value ? { appearance: { ...documentAppearance.value } } : {})
    })
}
function emitModel(content: TextEditorContent): void {
    emit('update:modelValue', typeof props.modelValue === 'string' ? content.plainText : content)
}
function publishContent(source: 'local' | 'remote', emitChange = true): void {
    const content = getContent()
    if (contentEquals(content, lastContent)) return
    lastContent = content
    emitModel(content)
    if (emitChange) emit('change', { content, value: content.plainText, source })
    emit('metrics-change', calculateTextEditorMetrics(content))
    emitActivity()
    formattingRevision.value++
}
function focus(): void { editor.commands.focus() }
function blur(): void { editor.commands.blur() }
function getText(): string { return getContent().plainText }
function getJSON(): RichTextDocumentV1 { return getContent().richText }
function getHTML(options: TextEditorHtmlOptions = {}): string {
    return richTextToHTML(getJSON(), options.sanitized !== false)
}
function replaceContent(value: TextEditorContentInput, options: TextEditorReplaceOptions = {}): void {
    const resolved = createTextEditorContent(value, { templateVariables: props.templateVariables })
    documentAppearance.value = resolved.richText.appearance
    editor.commands.setContent(resolved.richText.doc, { emitUpdate: false })
    lastContent = resolved
    emitModel(resolved)
    if (options.emitChange === true) {
        emit('change', { content: resolved, value: resolved.plainText, source: options.source || 'local' })
    }
    emit('metrics-change', calculateTextEditorMetrics(resolved))
    formattingRevision.value++
}
function replaceText(value: string, options?: TextEditorReplaceOptions): void {
    replaceContent(normalizeTextContent(value), options)
}
function insertText(value: string): void {
    if (effectiveMode.value !== 'edit') return
    editor.chain().focus().insertContent(normalizeTextContent(value)).run()
}
function insertContent(value: TextEditorContentInput): void {
    if (effectiveMode.value !== 'edit') return
    const resolved = createTextEditorContent(value, { templateVariables: props.templateVariables })
    editor.chain().focus().insertContent(resolved.richText.doc.content || []).run()
}
function getMetrics(): TextEditorMetrics { return calculateTextEditorMetrics(getContent()) }
function getStyle(): TextEditorAppearance { return { ...appearance.value } }
function setStyle(style: Partial<TextEditorAppearance>): void {
    if (!props.styleControlsEnabled) return
    documentAppearance.value = { ...(documentAppearance.value || {}), ...style }
    emit('style-change', getStyle())
    publishContent('local')
}
function resetStyle(): void {
    if (!props.styleControlsEnabled) return
    documentAppearance.value = undefined
    emit('style-change', getStyle())
    publishContent('local')
}
function getMode(): TextEditorMode { return effectiveMode.value }
function setMode(mode: TextEditorMode): void {
    effectiveMode.value = mode
    editor.setEditable(mode === 'edit')
    emit('mode-change', mode)
}

function commandChain(command: TextEditorCommand, options: TextEditorCommandOptions = {}, dryRun = false): boolean {
    if (effectiveMode.value !== 'edit') return false
    const chain = dryRun ? editor.can().chain().focus() : editor.chain().focus()
    switch (command) {
        case 'bold': return chain.toggleBold().run()
        case 'italic': return chain.toggleItalic().run()
        case 'underline': return chain.toggleUnderline().run()
        case 'strike': return chain.toggleStrike().run()
        case 'paragraph': return chain.setParagraph().run()
        case 'heading-1': return chain.toggleHeading({ level: 1 }).run()
        case 'heading-2': return chain.toggleHeading({ level: 2 }).run()
        case 'heading-3': return chain.toggleHeading({ level: 3 }).run()
        case 'bullet-list': return chain.toggleBulletList().run()
        case 'ordered-list': return chain.toggleOrderedList().run()
        case 'blockquote': return chain.toggleBlockquote().run()
        case 'highlight': return chain.toggleHighlight().run()
        case 'set-link': return Boolean(options.href && isAllowedEditorUrl(options.href) && chain.setLink({ href: options.href }).run())
        case 'unset-link': return chain.unsetLink().run()
        case 'clear-formatting': return chain.unsetAllMarks().clearNodes().run()
        case 'undo': return chain.undo().run()
        case 'redo': return chain.redo().run()
    }
}
function execute(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    if (!props.formattingEnabled) return false
    return commandChain(command, options, false)
}
function canExecute(command: TextEditorCommand, options?: TextEditorCommandOptions): boolean {
    if (!props.formattingEnabled) return false
    return commandChain(command, options, true)
}
function getFormattingState(): TextEditorFormattingState {
    return {
        bold: editor.isActive('bold'), italic: editor.isActive('italic'), underline: editor.isActive('underline'),
        strike: editor.isActive('strike'), paragraph: editor.isActive('paragraph'),
        headingLevel: editor.isActive('heading', { level: 1 }) ? 1 : editor.isActive('heading', { level: 2 }) ? 2 : editor.isActive('heading', { level: 3 }) ? 3 : null,
        bulletList: editor.isActive('bulletList'), orderedList: editor.isActive('orderedList'),
        blockquote: editor.isActive('blockquote'), highlight: editor.isActive('highlight'), link: editor.isActive('link')
    }
}
const formattingState = computed(() => { void formattingRevision.value; return getFormattingState() })
const showPlaceholder = computed(() => editor.isEmpty && Boolean(props.placeholder))

watch(() => props.modelValue, value => {
    const resolved = createTextEditorContent(value, { templateVariables: props.templateVariables })
    if (!contentEquals(resolved, getContent())) replaceContent(resolved)
}, { deep: true })
watch(() => [props.disabled, props.mode] as const, ([disabled, mode]) => setMode(disabled ? 'disabled' : mode))

onBeforeUnmount(() => editor.destroy())

defineExpose({ editor, focus, blur, getContent, getText, getJSON, getHTML, insertText, insertContent,
    replaceText, replaceContent, getSelection, getMetrics, getStyle, setStyle, resetStyle,
    getMode, setMode, execute, canExecute, getFormattingState })
</script>
