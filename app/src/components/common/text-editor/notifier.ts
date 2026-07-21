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
    return {
        enabled,
        notify(notification) {
            onNotification?.(notification)
            if (!this.enabled || notification.toast === false || !toast) return
            toast[notification.level](notification.message)
        },
        setEnabled(value) { this.enabled = value }
    }
}
