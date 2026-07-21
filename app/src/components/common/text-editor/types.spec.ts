import { describe, expect, it } from 'vitest'
import { insertTextAtSelection, normalizeTextContent, textToEditorHtml } from './types'

describe('text editor content utilities', () => {
    it('normalizes only line endings without trimming content', () => {
        expect(normalizeTextContent('  first\r\nsecond  \r')).toBe('  first\nsecond  \n')
    })

    it('escapes text before converting plain lines to editor paragraphs', () => {
        expect(textToEditorHtml('<first>\n&second')).toBe('<p>&lt;first&gt;</p><p>&amp;second</p>')
    })

    it('inserts template variables at the current selection', () => {
        expect(insertTextAtSelection('before selected after', '{{student}}', 7, 15))
            .toBe('before {{student}} after')
    })
})
