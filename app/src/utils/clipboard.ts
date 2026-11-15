/**
 * Robust clipboard utility that works across modern browsers and provides
 * a fallback for older browsers or strict environments like iOS Safari.
 * 
 * iOS Safari strictly blocks async clipboard writes (e.g. after a fetch request).
 * The fallback mechanism uses a hidden textarea and document.execCommand('copy')
 * which often bypasses this restriction if initiated within a user gesture chain.
 */
/**
 * Robust clipboard utility that works across modern browsers and provides
 * a fallback for older browsers or strict environments like iOS Safari.
 * 
 * iOS Safari strictly blocks async clipboard writes (e.g. after a fetch request).
 * For async content, pass a Promise<string> to use the ClipboardItem API
 * which maintains the user gesture chain.
 */
export async function copyToClipboard(textOrPromise: string | Promise<string>): Promise<boolean> {
    // Attempt modern Clipboard API first (only in secure contexts)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            if (textOrPromise instanceof Promise) {
                // For async content, Safari requires using ClipboardItem with the promise
                if (typeof ClipboardItem !== 'undefined') {
                    const item = new ClipboardItem({
                        'text/plain': textOrPromise.then(text => new Blob([text], { type: 'text/plain' }))
                    })
                    await navigator.clipboard.write([item])
                    return true
                } else {
                    // Fallback if ClipboardItem is not supported
                    const text = await textOrPromise
                    await navigator.clipboard.writeText(text)
                    return true
                }
            } else {
                // Synchronous text
                await navigator.clipboard.writeText(textOrPromise)
                return true
            }
        } catch (err) {
            console.warn('Clipboard API failed, trying fallback', err)
            // Fall through to the fallback method below
        }
    }

    // Fallback strategy for older browsers and iOS Safari strict mode
    // Note: If we are here with a Promise, we must await it, which might 
    // break the gesture chain in some browsers.
    const text = typeof textOrPromise === 'string' ? textOrPromise : await textOrPromise

    return new Promise((resolve) => {
        try {
            const textArea = document.createElement("textarea")
            textArea.value = text

            // Essential for iOS: must be in the DOM and visible but not disruptive
            textArea.style.position = "fixed"
            textArea.style.left = "-9999px"
            textArea.style.top = "0"
            textArea.setAttribute("readonly", "") // Prevent keyboard from popping up
            
            document.body.appendChild(textArea)

            // Select the text
            const isIOS = navigator.userAgent.match(/ipad|iphone/i)
            if (isIOS) {
                const range = document.createRange()
                range.selectNodeContents(textArea)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
                textArea.setSelectionRange(0, 999999)
            } else {
                textArea.select()
            }

            const successful = document.execCommand('copy')
            
            // Clean up
            document.body.removeChild(textArea)
            
            if (successful) {
                resolve(true)
            } else {
                console.error('Fallback: document.execCommand returned false')
                resolve(false)
            }
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err)
            resolve(false)
        }
    })
}

/**
 * Copies the same canonical editor document as both rich HTML and plain text.
 * Browsers without ClipboardItem support transparently fall back to plain text.
 */
export async function copyRichTextToClipboard(
    contentOrPromise: TextEditorContentInput | Promise<TextEditorContentInput>
): Promise<boolean> {
    const content = contentOrPromise instanceof Promise
        ? contentOrPromise.then(createTextEditorContent)
        : createTextEditorContent(contentOrPromise)

    if (navigator.clipboard?.write && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
        try {
            const plain = (value: Awaited<typeof content>) => new Blob([value.plainText], { type: 'text/plain' })
            const html = (value: Awaited<typeof content>) =>
                new Blob([richTextToHTML(value.richText, true)], { type: 'text/html' })
            const data = content instanceof Promise
                ? { 'text/plain': content.then(plain), 'text/html': content.then(html) }
                : { 'text/plain': plain(content), 'text/html': html(content) }
            await navigator.clipboard.write([new ClipboardItem(data)])
            return true
        } catch (error) {
            console.warn('Rich clipboard API failed, trying plain-text fallback', error)
        }
    }

    return copyToClipboard(content instanceof Promise ? content.then(value => value.plainText) : content.plainText)
}
import { createTextEditorContent, richTextToHTML } from '@/components/text-editor/content'
import type { TextEditorContentInput } from '@/components/text-editor/types'
