import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import { copyRichTextToClipboard } from './clipboard'

describe('copyRichTextToClipboard', () => {
    afterEach(() => vi.restoreAllMocks())

    it('writes matching text/plain and sanitized text/html representations', async () => {
        const write = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { write, writeText: vi.fn() }
        })

        class ClipboardItemMock {
            readonly data: Record<string, Promise<Blob>>
            constructor(data: Record<string, Promise<Blob>>) {
                this.data = data
            }
        }
        vi.stubGlobal('ClipboardItem', ClipboardItemMock)

        const content = createTextEditorContent({
            schemaVersion: 1,
            doc: {
                type: 'doc',
                content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }]
                }]
            }
        })

        await expect(copyRichTextToClipboard(content)).resolves.toBe(true)
        expect(write).toHaveBeenCalledOnce()
        const item = write.mock.calls[0]?.[0]?.[0] as ClipboardItemMock
        expect(Object.keys(item.data).sort()).toEqual(['text/html', 'text/plain'])
        await expect(item.data['text/plain']).resolves.toMatchObject({ type: 'text/plain' })
        await expect(item.data['text/html']).resolves.toMatchObject({ type: 'text/html' })
    })
})
