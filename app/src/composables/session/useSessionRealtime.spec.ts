import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const channel = vi.hoisted(() => ({
    handler: null as null | ((message: { payload?: unknown }) => void),
    status: null as null | ((status: string, detail?: string) => void),
    reconnect: vi.fn(),
    unsubscribe: vi.fn(),
}))
vi.mock('@/services/report/ApiRealtimeChannel', () => ({
    ApiRealtimeChannel: class {
        on(_type: string, _filter: unknown, handler: (message: { payload?: unknown }) => void) {
            channel.handler = handler
            return this
        }
        subscribe(callback: (status: string, detail?: string) => void) { channel.status = callback }
        reconnect() { channel.reconnect() }
        unsubscribe() { channel.unsubscribe() }
    },
}))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ locale: 'en', timeZone: 'UTC' }) }))

import { useSessionRealtime } from './useSessionRealtime'

describe('class session realtime', () => {
    let scope: ReturnType<typeof effectScope>
    const refresh = vi.fn<(options: { reportOnly?: boolean; refreshCatalog?: boolean }) => Promise<void>>()

    beforeEach(() => {
        vi.useFakeTimers()
        refresh.mockReset().mockResolvedValue()
        scope = effectScope()
    })
    afterEach(() => {
        scope.stop()
        vi.useRealTimers()
    })

    const setup = () => scope.run(() => useSessionRealtime({
        sessionId: 'session',
        userId: () => 'user',
        selectedDate: () => '2026-11-07',
        refresh,
    }))!

    it('coalesces a burst of report invalidations into one report-only refresh', async () => {
        const realtime = setup()
        realtime.startClassSessionRealtime()
        channel.handler!({ payload: { change: 'report' } })
        channel.handler!({ payload: { change: 'report' } })
        channel.handler!({ payload: { change: 'report' } })
        await vi.advanceTimersByTimeAsync(300)

        expect(refresh).toHaveBeenCalledTimes(1)
        expect(refresh).toHaveBeenCalledWith({ reportOnly: true, refreshCatalog: false })
    })

    it('runs a full refresh when any event in the batch is not a report change', async () => {
        const realtime = setup()
        realtime.scheduleRealtimeRefresh({ change: 'report' })
        realtime.scheduleRealtimeRefresh({ change: 'course' })
        await vi.advanceTimersByTimeAsync(300)

        expect(refresh).toHaveBeenCalledWith({ reportOnly: false, refreshCatalog: true })
    })

    it('ignores invalidations scoped to other dates', async () => {
        const realtime = setup()
        realtime.scheduleRealtimeRefresh({ change: 'report', date_from: '2026-12-01', date_to: '2026-12-31' })
        await vi.advanceTimersByTimeAsync(300)
        expect(refresh).not.toHaveBeenCalled()
    })

    it('queues events that arrive mid-refresh into one follow-up pass', async () => {
        let finish: () => void = () => {}
        refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
        const realtime = setup()
        realtime.scheduleRealtimeRefresh({ change: 'report' })
        await vi.advanceTimersByTimeAsync(300)
        realtime.scheduleRealtimeRefresh({ change: 'report' })
        realtime.scheduleRealtimeRefresh({ change: 'report' })
        await vi.advanceTimersByTimeAsync(1000)
        expect(refresh).toHaveBeenCalledTimes(1)

        finish()
        await vi.advanceTimersByTimeAsync(0)
        expect(refresh).toHaveBeenCalledTimes(2)
    })

    it('maps channel status to the badge and refreshes after a reconnect', async () => {
        const realtime = setup()
        realtime.startClassSessionRealtime()
        expect(realtime.realtimeBadge.value.tone).toBe('connecting')

        channel.status!('SUBSCRIBED')
        expect(realtime.realtimeBadge.value).toEqual({ tone: 'live', label: 'classroom.live_badge_live', canRetry: false })
        channel.status!('OFFLINE')
        expect(realtime.realtimeBadge.value.canRetry).toBe(true)
        channel.status!('SUBSCRIBED')
        await vi.advanceTimersByTimeAsync(300)
        expect(refresh).toHaveBeenCalledWith({ reportOnly: false, refreshCatalog: true })

        channel.status!('PERMISSION_DENIED', 'no access')
        channel.status!('CLOSED')
        expect(realtime.realtimeStatusMessage.value).toBe('classroom.live_updates_forbidden')
        expect(realtime.realtimeStatusDetail.value).toBe('no access')
    })

    it('retries the refresh after a refresh failure, otherwise reconnects', async () => {
        const realtime = setup()
        realtime.startClassSessionRealtime()
        realtime.retryRealtimeAction()
        expect(channel.reconnect).toHaveBeenCalledTimes(1)

        realtime.realtimeRefreshError.value = true
        realtime.retryRealtimeAction()
        await vi.advanceTimersByTimeAsync(300)
        expect(refresh).toHaveBeenCalledTimes(1)
        expect(channel.reconnect).toHaveBeenCalledTimes(1)
    })
})
