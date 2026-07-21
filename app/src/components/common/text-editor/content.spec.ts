import { describe, expect, it } from 'vitest'
import {
    calculateTextEditorMetrics,
    createTextEditorContent,
    plainTextToJSON,
    richTextToHTML,
    richTextToPlainText,
    renderTemplateContent,
    sanitizeGeneratedHTML
} from './content'

describe('rich text content utilities', () => {
    it('round-trips legacy plain text through TipTap JSON', () => {
        const content = createTextEditorContent('第一段\r\n\r\nSecond line')
        expect(content.plainText).toBe('第一段\n\nSecond line')
        expect(richTextToPlainText(content.richText)).toBe(content.plainText)
        expect(richTextToHTML(content.richText)).toContain('<p>第一段</p><p></p><p>Second line</p>')
    })

    it('turns legacy template tokens into atomic variable nodes', () => {
        const doc = plainTextToJSON('Hi {{student_name}} {{lesson|roman}}', true)
        expect(doc.content?.[0]?.content?.map(node => node.type)).toEqual([
            'text', 'templateVariable', 'text', 'templateVariable'
        ])
        expect(richTextToPlainText({ schemaVersion: 1, doc })).toBe('Hi {{student_name}} {{lesson|roman}}')
    })

    it('calculates Unicode-aware metrics', () => {
        const metrics = calculateTextEditorMetrics('你好世界\nEnglish words\n\n🙂')
        expect(metrics.wordCount).toBeGreaterThanOrEqual(4)
        expect(metrics.characterCount).toBe(18)
        expect(metrics.paragraphCount).toBe(3)
        expect(metrics.lineCount).toBe(4)
    })

    it('removes event handlers and unsafe link protocols from generated HTML access', () => {
        const sanitized = sanitizeGeneratedHTML('<p onclick="alert(1)">x</p><a href="javascript:alert(1)">bad</a>')
        expect(sanitized).not.toContain('onclick')
        expect(sanitized).not.toContain('javascript:')
    })

    it('replaces atomic template variables without losing surrounding marks', () => {
        const source = createTextEditorContent({
            schemaVersion: 1,
            doc: {
                type: 'doc',
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'templateVariable',
                        attrs: { key: 'student_name', mode: null },
                        marks: [{ type: 'bold' }]
                    }]
                }]
            }
        })
        const rendered = renderTemplateContent(source, key => key === 'student_name' ? '王小明' : '')
        expect(rendered.plainText).toBe('王小明')
        expect(rendered.richText.doc.content?.[0]?.content?.[0]).toMatchObject({
            type: 'text', text: '王小明', marks: [{ type: 'bold' }]
        })
    })
})
