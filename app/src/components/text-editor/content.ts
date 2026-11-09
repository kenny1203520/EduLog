import { generateHTML, generateText, type JSONContent } from '@tiptap/core'
import { createTextEditorExtensions, isAllowedEditorUrl } from './extensions'
import {
    normalizeTextContent,
    TEXT_EDITOR_PRESETS,
    type RichTextDocumentV1,
    type TextEditorAppearance,
    type TextEditorContent,
    type TextEditorContentInput,
    type TextEditorMetrics,
    type TextEditorPreset
} from './types'

const TEMPLATE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*([a-zA-Z0-9_]+))?\s*\}\}/g

export const EMPTY_RICH_TEXT_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function plainTextToJSON(value: string | null | undefined, templateVariables = false): JSONContent {
    const lines = normalizeTextContent(value).split('\n')
    return {
        type: 'doc',
        content: lines.map(line => ({
            type: 'paragraph',
            ...(line ? { content: textLineToNodes(line, templateVariables) } : {})
        }))
    }
}

function textLineToNodes(line: string, templateVariables: boolean): JSONContent[] {
    if (!templateVariables) return [{ type: 'text', text: line }]

    const result: JSONContent[] = []
    let cursor = 0
    for (const match of line.matchAll(TEMPLATE_TOKEN)) {
        const index = match.index ?? 0
        if (index > cursor) result.push({ type: 'text', text: line.slice(cursor, index) })
        result.push({
            type: 'templateVariable',
            attrs: { key: match[1], mode: match[2] || null }
        })
        cursor = index + match[0].length
    }
    if (cursor < line.length) result.push({ type: 'text', text: line.slice(cursor) })
    return result.length > 0 ? result : [{ type: 'text', text: line }]
}

export function isRichTextDocument(value: unknown): value is RichTextDocumentV1 {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<RichTextDocumentV1>
    return candidate.schemaVersion === 1 && isJSONContent(candidate.doc)
}

export function isTextEditorContent(value: unknown): value is TextEditorContent {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<TextEditorContent>
    return typeof candidate.plainText === 'string' && isRichTextDocument(candidate.richText)
}

function isJSONContent(value: unknown): value is JSONContent {
    return Boolean(value && typeof value === 'object' && typeof (value as JSONContent).type === 'string')
}

export function resolveRichTextDocument(
    value: TextEditorContentInput,
    options: { templateVariables?: boolean; appearance?: Partial<TextEditorAppearance> } = {}
): RichTextDocumentV1 {
    if (isTextEditorContent(value)) return cloneDocument(value.richText)
    if (isRichTextDocument(value)) return cloneDocument(value)
    if (isJSONContent(value)) {
        return { schemaVersion: 1, doc: structuredCloneSafe(value), appearance: options.appearance }
    }
    return {
        schemaVersion: 1,
        doc: plainTextToJSON(typeof value === 'string' ? value : '', options.templateVariables),
        ...(options.appearance ? { appearance: { ...options.appearance } } : {})
    }
}

export function createTextEditorContent(
    value: TextEditorContentInput,
    options: { templateVariables?: boolean; appearance?: Partial<TextEditorAppearance> } = {}
): TextEditorContent {
    const richText = resolveRichTextDocument(value, options)
    return {
        richText,
        plainText: richTextToPlainText(richText)
    }
}

export function richTextToPlainText(value: RichTextDocumentV1 | JSONContent): string {
    const doc = isRichTextDocument(value) ? value.doc : value
    return normalizeTextContent(generateText(doc, createTextEditorExtensions(), { blockSeparator: '\n' }))
}

export function richTextToHTML(value: RichTextDocumentV1 | JSONContent, sanitized = true): string {
    const doc = isRichTextDocument(value) ? value.doc : value
    const html = generateHTML(doc, createTextEditorExtensions())
    return sanitized ? sanitizeGeneratedHTML(html) : html
}

export function sanitizeGeneratedHTML(html: string): string {
    if (typeof document === 'undefined') return html

    const template = document.createElement('template')
    template.innerHTML = html
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove())
    template.content.querySelectorAll<HTMLElement>('*').forEach(node => {
        for (const attribute of Array.from(node.attributes)) {
            if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name)
        }
    })
    template.content.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
        const href = link.getAttribute('href') || ''
        if (!isAllowedEditorUrl(href)) link.removeAttribute('href')
        link.setAttribute('rel', 'noopener noreferrer nofollow')
        link.setAttribute('target', '_blank')
    })
    return template.innerHTML
}

export function calculateTextEditorMetrics(value: string | TextEditorContent): TextEditorMetrics {
    const text = normalizeTextContent(typeof value === 'string' ? value : value.plainText)
    const lines = text.length === 0 ? [] : text.split('\n')
    const graphemes = segment(text.replace(/\n/g, ''), 'grapheme')
    const words = segment(text, 'word').filter(item => item.isWordLike)

    return {
        wordCount: words.length,
        characterCount: graphemes.length,
        nonWhitespaceCharacterCount: graphemes.filter(item => !/^\s$/u.test(item.segment)).length,
        paragraphCount: lines.filter(line => line.trim().length > 0).length,
        lineCount: lines.length,
        rawLength: text.length
    }
}

function segment(value: string, granularity: 'grapheme' | 'word'): Array<{ segment: string; isWordLike: boolean }> {
    const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string | string[], options?: { granularity: string }) => { segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter
    if (Segmenter) {
        return Array.from(new Segmenter(['zh-TW', 'en'], { granularity }).segment(value))
            .map(item => ({ segment: item.segment, isWordLike: item.isWordLike !== false && /[^\s\p{P}\p{S}]/u.test(item.segment) }))
    }

    if (granularity === 'grapheme') {
        return Array.from(value).map(item => ({ segment: item, isWordLike: /[^\s\p{P}\p{S}]/u.test(item) }))
    }

    const matches = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
    return matches.map(item => ({ segment: item, isWordLike: true }))
}

export function resolveTextEditorAppearance(
    preset: TextEditorPreset,
    documentAppearance?: Partial<TextEditorAppearance>,
    overrides?: Partial<TextEditorAppearance>
): TextEditorAppearance {
    return {
        ...TEXT_EDITOR_PRESETS[preset],
        ...documentAppearance,
        ...withoutUndefined(overrides || {})
    }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null)) as Partial<T>
}

function cloneDocument(value: RichTextDocumentV1): RichTextDocumentV1 {
    return structuredCloneSafe(value)
}

function structuredCloneSafe<T>(value: T): T {
    // Vue props may be reactive proxies, which native structuredClone rejects.
    return JSON.parse(JSON.stringify(value)) as T
}

export function contentEquals(left: TextEditorContentInput, right: TextEditorContentInput): boolean {
    const a = createTextEditorContent(left)
    const b = createTextEditorContent(right)
    return a.plainText === b.plainText && JSON.stringify(a.richText) === JSON.stringify(b.richText)
}

/** Resolves atomic template-variable nodes while preserving surrounding document structure and marks. */
export function renderTemplateContent(
    value: TextEditorContentInput,
    resolveVariable: (key: string, mode?: string | null) => string,
    renderLegacyText?: (text: string) => string
): TextEditorContent {
    const source = createTextEditorContent(value, { templateVariables: true })
    const transform = (node: JSONContent): JSONContent => {
        if (node.type === 'templateVariable') {
            return {
                type: 'text',
                text: resolveVariable(String(node.attrs?.key || ''), node.attrs?.mode || null),
                ...(node.marks ? { marks: structuredCloneSafe(node.marks) } : {})
            }
        }
        if (node.type === 'text' && typeof node.text === 'string' && renderLegacyText) {
            return { ...structuredCloneSafe(node), text: renderLegacyText(node.text) }
        }
        return {
            ...structuredCloneSafe(node),
            ...(node.content ? { content: node.content.map(transform) } : {})
        }
    }
    return createTextEditorContent({
        schemaVersion: 1,
        doc: transform(source.richText.doc),
        appearance: source.richText.appearance
    })
}
