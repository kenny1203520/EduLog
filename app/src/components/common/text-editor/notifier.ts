import type { ToastInterface } from 'vue-toastification'

export type EditorNotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type EditorNotificationCode =
    | 'save-started' | 'save-succeeded' | 'save-failed' | 'save-conflict'
    | 'draft-recovered' | 'collaboration-connected' | 'collaboration-disconnected'
    | 'collaboration-reconnecting' | 'collaboration-error' | 'remote-change'

export interface EditorNotification {
    code: EditorNotificationCode
    level: EditorNotificationLevel
    message: string
    context?: Record<string, unknown>
    toast?: boolean
    /** Suppress identical notifications within the dedupe window. */
    dedupeKey?: string
}

export interface EditorNotifier {
    enabled: boolean
    notify(notification: EditorNotification): void
    setEnabled(enabled: boolean): void
}

export function createEditorNotifier(
    onNotification?: (notification: EditorNotification) => void,
    toast?: ToastInterface,
    enabled = true
): EditorNotifier {
    const recentlyNotified = new Map<string, number>()
    const dedupeWindowMs = 2000

    return {
        enabled,
        notify(notification) {
            onNotification?.(notification)
            if (!this.enabled || notification.toast === false || !toast) return
            if (notification.dedupeKey) {
                const now = Date.now()
                const previous = recentlyNotified.get(notification.dedupeKey)
                if (previous !== undefined && now - previous <dedupeWindowMs) return
                recentlyNotified.set(notification.dedupeKey, now)
                for (const [key, timestamp] of recentlyNotified) {
                    if (now - timestamp >= dedupeWindowMs) recentlyNotified.delete(key)
                }
            }
            // Error toasts must not auto-dismiss -- a failure the user didn't
            // get to read before the default 3s timeout is not feedback.
            const options = notification.level === 'error' ? { timeout: false as const } : undefined
            toast[notification.level](notification.message, options)
        },
        setEnabled(value) { this.enabled = value }
    }
}
