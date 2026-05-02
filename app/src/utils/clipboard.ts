/**
 * Robust clipboard utility that works across modern browsers and provides
 * a fallback for older browsers or strict environments like iOS Safari.
 * 
 * iOS Safari strictly blocks async clipboard writes (e.g. after a fetch request).
 * The fallback mechanism uses a hidden textarea and document.execCommand('copy')
 * which often bypasses this restriction if initiated within a user gesture chain.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
    // Attempt modern Clipboard API first (only in secure contexts)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text)
            return true
        } catch (err) {
            console.warn('Clipboard API failed, trying fallback', err)
            // Fall through to the fallback method below
        }
    }

    // Fallback strategy for older browsers and iOS Safari strict mode
    return new Promise((resolve) => {
        try {
            const textArea = document.createElement("textarea")
            textArea.value = text

            // Prevent scrolling and ensure it's not visible, but MUST remain in the layout
            // flow for iOS to allow selection and copying.
            textArea.style.position = "fixed"
            textArea.style.top = "0"
            textArea.style.left = "0"
            textArea.style.width = "2rem"
            textArea.style.height = "2rem"
            textArea.style.padding = "0"
            textArea.style.border = "none"
            textArea.style.outline = "none"
            textArea.style.boxShadow = "none"
            textArea.style.background = "transparent"
            textArea.style.opacity = "0"
            textArea.style.pointerEvents = "none" // Prevent accidental interaction

            document.body.appendChild(textArea)

            // Select the text carefully to appease iOS Safari
            if (navigator.userAgent.match(/ipad|iphone/i)) {
                // iOS-specific selection
                const range = document.createRange()
                range.selectNodeContents(textArea)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
                textArea.setSelectionRange(0, 999999)
            } else {
                // Standard selection
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
