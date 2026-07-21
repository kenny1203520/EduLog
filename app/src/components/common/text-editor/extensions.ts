import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { TemplateVariable } from './TemplateVariable'

export interface TextEditorExtensionOptions {
    history?: boolean
    templateVariables?: boolean
}

export function isAllowedEditorUrl(value: string): boolean {
    const trimmed = value.trim()
    if (!trimmed) return false
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return true
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
}

export function createTextEditorExtensions(options: TextEditorExtensionOptions = {}): Extensions {
    const extensions: Extensions = [
        StarterKit.configure({
            undoRedo: options.history === false ? false : undefined,
            code: false,
            codeBlock: false,
            horizontalRule: false,
            link: {
                openOnClick: false,
                autolink: true,
                linkOnPaste: true,
                protocols: [],
                isAllowedUri: (url) => isAllowedEditorUrl(url),
                HTMLAttributes: {
                    rel: 'noopener noreferrer nofollow',
                    target: '_blank'
                }
            },
            heading: { levels: [1, 2, 3] }
        }),
        Highlight.configure({ multicolor: false })
    ]

    if (options.templateVariables !== false) extensions.push(TemplateVariable)
    return extensions
}
