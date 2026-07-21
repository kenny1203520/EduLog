import { mergeAttributes, Node } from '@tiptap/core'

export function formatTemplateVariableToken(key: string, mode?: string | null): string {
    return mode ? `{{${key}|${mode}}}` : `{{${key}}}`
}

export const TemplateVariable = Node.create({
    name: 'templateVariable',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
        return {
            key: { default: '' },
            mode: { default: null }
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-template-variable]' }]
    },

    renderHTML({ node, HTMLAttributes }) {
        const token = formatTemplateVariableToken(node.attrs.key, node.attrs.mode)
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-template-variable': node.attrs.key,
                'data-template-variable-mode': node.attrs.mode || undefined,
                class: 'text-editor-template-variable',
                contenteditable: 'false'
            }),
            token
        ]
    },

    renderText({ node }) {
        return formatTemplateVariableToken(node.attrs.key, node.attrs.mode)
    }
})
