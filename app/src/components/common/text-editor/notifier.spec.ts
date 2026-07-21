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
        expect(toast.error).toHaveBeenCalledWith('offline')

        notifier.setEnabled(false)
        notifier.notify(notification)
        expect(onNotification).toHaveBeenCalledTimes(2)
        expect(toast.error).toHaveBeenCalledTimes(1)
    })
})
