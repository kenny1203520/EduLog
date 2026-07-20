export type TextEditorPreset = 'form' | 'notes' | 'report' | 'template' | 'merge'
export type TextEditorResize = 'none' | 'vertical'
export type TextEditorChangeSource = 'local' | 'remote'

export interface TextEditorChange {
    value: string
    source: TextEditorChangeSource
}

export interface TextEditorActivity {
    caret: number
    selectionEnd: number
}

export interface TextEditorReplaceOptions {
    emitChange?: boolean
}

export interface TextEditorHandle {
    focus: () => void
    getText: () => string
    insertText: (text: string) => void
    replaceText: (value: string, options?: TextEditorReplaceOptions) => void
}

export interface TextEditorAppearance {
    minHeight: number
    fontScale: number
    mono: boolean
    resize: TextEditorResize
    padding: string
    borderRadius: string
}

export const TEXT_EDITOR_PRESETS: Record<TextEditorPreset, TextEditorAppearance> = {
    form: {
        minHeight: 96,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '0.75rem 1rem',
        borderRadius: '0.75rem'
    },
    notes: {
        minHeight: 90,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '0.5rem 0.75rem',
        borderRadius: '0.5rem'
    },
    report: {
        minHeight: 300,
        fontScale: 100,
        mono: true,
        resize: 'vertical',
        padding: '1rem',
        borderRadius: '0.5rem'
    },
    template: {
        minHeight: 288,
        fontScale: 100,
        mono: true,
        resize: 'vertical',
        padding: '0.75rem 1rem',
        borderRadius: '1rem'
    },
    merge: {
        minHeight: 160,
        fontScale: 100,
        mono: true,
        resize: 'none',
        padding: '1.5rem',
        borderRadius: '2.5rem'
    }
}

export function normalizeTextContent(value: string | null | undefined): string {
    return (value ?? '').replace(/\r\n?/g, '\n')
}

export function insertTextAtSelection(
    content: string,
    insertion: string,
    caret: number,
    selectionEnd = caret
): string {
    const normalizedContent = normalizeTextContent(content)
    const normalizedInsertion = normalizeTextContent(insertion)
    const clamp = (position: number) => Math.max(0, Math.min(position, normalizedContent.length))
    const start = clamp(Math.min(caret, selectionEnd))
    const end = clamp(Math.max(caret, selectionEnd))
    return normalizedContent.slice(0, start) + normalizedInsertion + normalizedContent.slice(end)
}

export function textToEditorHtml(value: string | null | undefined): string {
    const normalized = normalizeTextContent(value)
    if (!normalized) return '<p></p>'

    return normalized
        .split('\n')
        .map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
        .join('')
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}
