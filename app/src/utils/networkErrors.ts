const NETWORK_MESSAGE_PATTERNS = [
    /^network offline$/i, // ApiV1Client refuses mutations while navigator.onLine is false
    /failed to fetch/i, // Chromium
    /networkerror/i, // Firefox
    /^load failed$/i, // Safari
    /network request failed/i,
    /timed out/i,
    /status 5\d\d\b/i // ApiV1Client for a 5xx without an error envelope
]

/**
 * True for failures caused by the connection or a temporarily unavailable
 * server (offline, fetch failure, timeout, 5xx) -- the ones worth retrying
 * unchanged. Permission, validation and version conflicts are not.
 */
export function isNetworkError(error: unknown): boolean {
    if (!error) return false
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number' && status >= 500 && status <= 599) return true
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    return NETWORK_MESSAGE_PATTERNS.some(pattern => pattern.test(message))
}

export function isBrowserOffline(): boolean {
    return typeof navigator !== 'undefined' && navigator.onLine === false
}
