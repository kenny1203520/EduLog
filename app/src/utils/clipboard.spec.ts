import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextEditorContent } from '@/components/text-editor/content'
import { copyRichTextToClipboard } from './clipboard'

describe('copyRichTextToClipboard', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it.each([false, true])('writes matching plain text and HTML (deferred: %s)', async deferred => {
        const write = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { write, writeText: vi.fn() }
        })

        class ClipboardItemMock {
            readonly data: Record<string, Blob | Promise<Blob>>
            constructor(data: Record<string, Blob | Promise<Blob>>) {
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

        await expect(copyRichTextToClipboard(deferred ? Promise.resolve(content) : content)).resolves.toBe(true)
        expect(write).toHaveBeenCalledOnce()
        const item = write.mock.calls[0]?.[0]?.[0] as ClipboardItemMock
        expect(Object.keys(item.data).sort()).toEqual(['text/html', 'text/plain'])
        expect(await item.data['text/plain']).toMatchObject({ type: 'text/plain' })
        expect(await item.data['text/html']).toMatchObject({ type: 'text/html' })
    })
})
