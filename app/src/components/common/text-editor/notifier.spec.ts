import { describe, expect, it, vi } from 'vitest'
import { createEditorNotifier } from './notifier'

describe('editor notifier', () => {
    it('always emits structured events and only shows enabled toast notifications', () => {
        const onNotification = vi.fn()
        const toast = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() } as any
        const notifier = createEditorNotifier(onNotification, toast)
        const notification = { code: 'save-failed' as const, level: 'error' as const, message: 'offline' }

        notifier.notify(notification)
        expect(onNotification).toHaveBeenCalledWith(notification)
        // Error-level toasts must not auto-dismiss: a failure the user didn't
        // get to read before the default timeout is not feedback.
        expect(toast.error).toHaveBeenCalledWith('offline', { timeout: false })

        notifier.setEnabled(false)
        notifier.notify(notification)
        expect(onNotification).toHaveBeenCalledTimes(2)
        expect(toast.error).toHaveBeenCalledTimes(1)
    })

    it('lets non-error levels use the default (auto-dismissing) toast timeout', () => {
        const toast = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() } as any
        const notifier = createEditorNotifier(undefined, toast)

        notifier.notify({ code: 'save-succeeded', level: 'success', message: 'Saved' })
        expect(toast.success).toHaveBeenCalledWith('Saved', undefined)
    })
})
