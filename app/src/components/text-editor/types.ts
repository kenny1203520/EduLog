import type { JSONContent } from '@tiptap/core'

export type TextEditorPreset = 'form' | 'notes' | 'report' | 'template' | 'merge'
export type TextEditorResize = 'none' | 'vertical'
export type TextEditorChangeSource = 'local' | 'remote'
export type TextEditorMode = 'edit' | 'read' | 'disabled'

export interface TextEditorAppearance {
    minHeight: number
    fontScale: number
    mono: boolean
    resize: TextEditorResize
    padding: string
    borderRadius: string
    lineHeight: number
}

export interface RichTextDocumentV1 {
    schemaVersion: 1
    doc: JSONContent
    appearance?: Partial<TextEditorAppearance>
}

export interface TextEditorContent {
    richText: RichTextDocumentV1
    plainText: string
}

/** Input accepted during migration from legacy plain-text fields. */
export type TextEditorContentInput = TextEditorContent | RichTextDocumentV1 | JSONContent | string | null | undefined

export interface TextEditorChange {
    content: TextEditorContent
    source: TextEditorChangeSource
    /** @deprecated Use content.plainText. Kept for legacy consumers during migration. */
    value: string
}

export interface TextEditorActivity {
    caret: number
    selectionEnd: number
    focused?: boolean
}

export interface TextEditorMetrics {
    wordCount: number
    characterCount: number
    nonWhitespaceCharacterCount: number
    paragraphCount: number
    lineCount: number
    rawLength: number
}

export interface TextEditorReplaceOptions {
    emitChange?: boolean
    source?: TextEditorChangeSource
}

export interface TextEditorHtmlOptions {
    sanitized?: boolean
}

export type TextEditorCommand =
    | 'bold'
    | 'italic'
    | 'underline'
    | 'strike'
    | 'paragraph'
    | 'heading-1'
    | 'heading-2'
    | 'heading-3'
    | 'bullet-list'
    | 'ordered-list'
    | 'blockquote'
    | 'highlight'
    | 'set-link'
    | 'unset-link'
    | 'clear-formatting'
    | 'undo'
    | 'redo'

export interface TextEditorCommandOptions {
    href?: string
}

export interface TextEditorFormattingState {
    bold: boolean
    italic: boolean
    underline: boolean
    strike: boolean
    paragraph: boolean
    headingLevel: 1 | 2 | 3 | null
    bulletList: boolean
    orderedList: boolean
    blockquote: boolean
    highlight: boolean
    link: boolean
}

export interface TextEditorHandle {
    focus: () => void
    blur: () => void
    getContent: () => TextEditorContent
    getText: () => string
    getJSON: () => RichTextDocumentV1
    getHTML: (options?: TextEditorHtmlOptions) => string
    insertText: (text: string) => void
    insertContent: (content: TextEditorContentInput) => void
    replaceText: (value: string, options?: TextEditorReplaceOptions) => void
    replaceContent: (value: TextEditorContentInput, options?: TextEditorReplaceOptions) => void
    getSelection: () => TextEditorActivity
    getMetrics: () => TextEditorMetrics
    getStyle: () => TextEditorAppearance
    setStyle: (style: Partial<TextEditorAppearance>) => void
    resetStyle: () => void
    getMode: () => TextEditorMode
    setMode: (mode: TextEditorMode) => void
    execute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
    canExecute: (command: TextEditorCommand, options?: TextEditorCommandOptions) => boolean
    getFormattingState: () => TextEditorFormattingState
}

export interface TextDocumentLoadResult<TDocument> {
    document: TDocument | null
    version?: number
}

export interface TextDocumentSaveResult<TDocument> {
    success: boolean
    conflict?: boolean
    document?: TDocument
    version?: number
    message?: string
}

export interface TextDocumentRepository<TDocument, TSnapshot> {
    load(id: string): Promise<TextDocumentLoadResult<TDocument>>
    save(id: string, baseVersion: number | undefined, snapshot: TSnapshot): Promise<TextDocumentSaveResult<TDocument>>
    restore(id: string, versionId: string, baseVersion?: number): Promise<TextDocumentSaveResult<TDocument>>
}

export const TEXT_EDITOR_PRESETS: Record<TextEditorPreset, TextEditorAppearance> = {
    form: {
        minHeight: 96,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '0.75rem 1rem',
        borderRadius: '0.75rem',
        lineHeight: 1.6
    },
    notes: {
        minHeight: 90,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '0.5rem 0.75rem',
        borderRadius: '0.5rem',
        lineHeight: 1.55
    },
    report: {
        minHeight: 300,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '1rem',
        borderRadius: '0.5rem',
        lineHeight: 1.7
    },
    template: {
        minHeight: 288,
        fontScale: 100,
        mono: false,
        resize: 'vertical',
        padding: '0.75rem 1rem',
        borderRadius: '1rem',
        lineHeight: 1.6
    },
    merge: {
        minHeight: 160,
        fontScale: 100,
        mono: false,
        resize: 'none',
        padding: '1.5rem',
        borderRadius: '2.5rem',
        lineHeight: 1.6
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

/** Legacy helper retained for callers that still need escaped paragraph HTML. */
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
