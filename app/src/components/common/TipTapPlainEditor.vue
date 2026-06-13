<template>
    <div
        ref="shellRef"
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
            v-for="item in remoteSelectionVisuals"
            :key="item.key"
            class="pointer-events-none absolute z-10"
            :style="item.selectionStyle"
        ></div>
        <div
            v-for="item in remoteCursorVisuals"
            :key="item.key"
            class="pointer-events-none absolute z-20"
            :style="item.caretStyle"
        >
            <div
                class="rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm"
                :style="{ background: item.color, color: item.textColor }"
            >
                {{ item.label }}
            </div>
        </div>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
    remoteSelections?: Array<{
        userId: string
        displayName?: string
        color?: string
        caret?: number
        selectionEnd?: number
    }>
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    disabled: false,
    fontScale: 100,
    minHeight: 120,
    mono: false,
    focusRingClass: 'ring-2 ring-emerald-500 border-emerald-500',
    remoteSelections: () => []
})

const emit = defineEmits<{
    'update:modelValue': [value: string]
    input: [payload: EditorActivityPayload]
    activity: [payload: EditorActivityPayload]
}>()

const focused = ref(false)
const shellRef = ref<HTMLElement | null>(null)
const remoteSelectionVisuals = ref<Array<{ key: string; selectionStyle: Record<string, string> }>>([])
const remoteCursorVisuals = ref<Array<{ key: string; caretStyle: Record<string, string>; label: string; color: string; textColor: string }>>([])

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

function clampPos(pos: number, maxPos: number): number {
    return Math.max(1, Math.min(pos, maxPos))
}

function refreshRemoteVisuals() {
    if (!editor || !shellRef.value) {
        remoteSelectionVisuals.value = []
        remoteCursorVisuals.value = []
        return
    }

    const view = editor.view
    const maxPos = view.state.doc.content.size + 1
    const shellRect = shellRef.value.getBoundingClientRect()

    const selectionList: Array<{ key: string; selectionStyle: Record<string, string> }> = []
    const caretList: Array<{ key: string; caretStyle: Record<string, string>; label: string; color: string; textColor: string }> = []

    props.remoteSelections.forEach((item) => {
        if (typeof item.caret !== 'number') {
            return
        }

        const color = item.color || '#BFDBFE'
        const label = item.displayName || item.userId
        const caret = clampPos(item.caret, maxPos)

        try {
            const caretRect = view.coordsAtPos(caret)
            const baseLeft = Math.max(0, caretRect.left - shellRect.left)
            const baseTop = Math.max(0, caretRect.top - shellRect.top - 22)
            const textColor = getContrastTextColor(color)

            caretList.push({
                key: `${item.userId}-caret-${caret}`,
                label,
                color,
                textColor,
                caretStyle: {
                    left: `${baseLeft}px`,
                    top: `${baseTop}px`
                }
            })

            if (typeof item.selectionEnd === 'number' && item.selectionEnd !== item.caret) {
                const selectionEnd = clampPos(item.selectionEnd, maxPos)
                const start = Math.min(caret, selectionEnd)
                const end = Math.max(caret, selectionEnd)
                const startRect = view.coordsAtPos(start)
                const endRect = view.coordsAtPos(end)
                const topPx = Math.min(startRect.top, endRect.top) - shellRect.top
                const bottomPx = Math.max(startRect.bottom, endRect.bottom) - shellRect.top
                const lineHeight = Math.max(16, startRect.bottom - startRect.top)

                // If selection spans multiple visual lines, draw a block covering the vertical span
                let left = Math.min(startRect.left, endRect.left) - shellRect.left
                let width = Math.max(2, Math.abs(endRect.left - startRect.left))
                let height = Math.max(lineHeight, bottomPx - topPx)
                let top = Math.max(0, topPx)

                if (Math.abs(startRect.top - endRect.top) >= lineHeight * 0.75) {
                    left = 0
                    width = Math.max(40, shellRect.width - 2)
                }

                selectionList.push({
                    key: `${item.userId}-selection-${start}-${end}`,
                    selectionStyle: {
                        left: `${Math.max(0, left)}px`,
                        top: `${top}px`,
                        width: `${width}px`,
                        height: `${height}px`,
                        background: `${color}33`,
                        borderRadius: '4px'
                    }
                })
            }
        } catch {
            // Skip invalid positions during rapid document updates.
        }
    })

    // Resolve label collisions: stack overlapping labels vertically
    const placedLabels: Array<{ left: number; top: number; width: number }> = []
    const adjustedCarets = caretList.map((c) => {
        const left = parseFloat(c.caretStyle.left as string)
        let top = parseFloat(c.caretStyle.top as string)
        const width = 60
        let collisions = 0
        for (const p of placedLabels) {
            const horizOverlap = Math.abs(p.left - left) < 60
            const vertOverlap = Math.abs(p.top - top) < 18
            if (horizOverlap && vertOverlap) collisions++
        }
        if (collisions > 0) {
            top = top - 18 * collisions
        }
        placedLabels.push({ left, top, width })
        return { ...c, caretStyle: { ...c.caretStyle, top: `${top}px` } }
    })

    remoteSelectionVisuals.value = selectionList
    remoteCursorVisuals.value = adjustedCarets
}

function hexToRgb(hex: string) {
    const h = hex.replace('#', '')
    const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

function getContrastTextColor(hex: string) {
    try {
        const { r, g, b } = hexToRgb(hex)
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        return luminance > 0.6 ? '#000000' : '#FFFFFF'
    } catch {
        return '#000000'
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
    onFocus: ({ editor }) => {
        focused.value = true
        emit('activity', getSelectionPayload(editor))
        nextTick(refreshRemoteVisuals)
    },
    onBlur: () => {
        focused.value = false
    },
    onSelectionUpdate: ({ editor }) => {
        emit('activity', getSelectionPayload(editor))
        nextTick(refreshRemoteVisuals)
    },
    onUpdate: ({ editor }) => {
        const value = editor.getText({ blockSeparator: '\n' })
        emit('update:modelValue', value)
        const payload = getSelectionPayload(editor)
        emit('input', payload)
        emit('activity', payload)
        nextTick(refreshRemoteVisuals)
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
        nextTick(refreshRemoteVisuals)
    }
)

watch(
    () => props.remoteSelections,
    () => {
        nextTick(refreshRemoteVisuals)
    },
    { deep: true }
)

onMounted(() => {
    nextTick(refreshRemoteVisuals)
    window.addEventListener('resize', refreshRemoteVisuals)
})

const showPlaceholder = computed(() => {
    return !focused.value && !props.modelValue?.trim() && !!props.placeholder
})

onBeforeUnmount(() => {
    window.removeEventListener('resize', refreshRemoteVisuals)
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

.editor-content :deep(.tiptap-content p + p) {
    margin-top: 0.125rem;
}
</style>
