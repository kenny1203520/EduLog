const MAX_EXTERNAL_HREF_LENGTH = 4096

/** Returns a safe absolute HTTP(S) URL for report/enrollment links. */
export function safeExternalHref(value: string | null | undefined): string | null {
    const trimmed = (value || '').trim()
    if (!trimmed || trimmed.length > MAX_EXTERNAL_HREF_LENGTH) return null
    if (!/^https?:\/\//i.test(trimmed)) return null

    try {
        const parsed = new URL(trimmed)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
        return parsed.href
    } catch {
        return null
    }
}