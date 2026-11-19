import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { IDLE_WARNING_MS, SESSION_EXPIRING_EVENT, useIdleSignOut } from './useIdleSignOut'
import { isBackgroundActivity, markUserActivity, resetUserActivityForTests } from '@/lib/userActivity'

const HOUR = 60 * 60 * 1000
const IDLE = 8 * HOUR

function harness() {
    const onExpire = vi.fn()
    const keepAlive = vi.fn().mockResolvedValue(undefined)
    let api!: ReturnType<typeof useIdleSignOut>
    const wrapper = mount(defineComponent({
        setup() { api = useIdleSignOut({ idleTimeoutMs: () => IDLE, onExpire, keepAlive }); return () => h('div') },
    }))
    return { wrapper, api, onExpire, keepAlive }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T08:00:00Z'))
    resetUserActivityForTests(Date.now())
})
afterEach(() => { vi.useRealTimers() })

describe('idle sign-out', () => {
    it('warns five minutes before the idle limit and asks editors to save', async () => {
        const saves = vi.fn()
        window.addEventListener(SESSION_EXPIRING_EVENT, saves)
        const { api, onExpire, wrapper } = harness()
        await vi.advanceTimersByTimeAsync(IDLE - IDLE_WARNING_MS - 30_000)
        expect(api.warning.value).toBe(false)
        await vi.advanceTimersByTimeAsync(30_000)
        expect(api.warning.value).toBe(true)
        expect(api.secondsLeft.value).toBeLessThanOrEqual(300)
        expect(saves).toHaveBeenCalledTimes(1)
        expect(onExpire).not.toHaveBeenCalled()
        wrapper.unmount()
        window.removeEventListener(SESSION_EXPIRING_EVENT, saves)
    })

    it('signs out at the limit after giving editors a final chance to save', async () => {
        const saves = vi.fn()
        window.addEventListener(SESSION_EXPIRING_EVENT, saves)
        const { onExpire, wrapper } = harness()
        await vi.advanceTimersByTimeAsync(IDLE + 15_000)
        await vi.advanceTimersByTimeAsync(3_000)
        expect(onExpire).toHaveBeenCalledTimes(1)
        expect(saves).toHaveBeenCalledTimes(2)
        wrapper.unmount()
        window.removeEventListener(SESSION_EXPIRING_EVENT, saves)
    })

    it('staying signed in clears the warning and tells the server', async () => {
        const { api, onExpire, keepAlive, wrapper } = harness()
        await vi.advanceTimersByTimeAsync(IDLE - 60_000)
        expect(api.warning.value).toBe(true)
        await api.staySignedIn()
        expect(api.warning.value).toBe(false)
        expect(keepAlive).toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(onExpire).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('counts interaction in this page as activity', async () => {
        const { api, onExpire, wrapper } = harness()
        await vi.advanceTimersByTimeAsync(7 * HOUR)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(api.warning.value).toBe(false)
        expect(onExpire).not.toHaveBeenCalled()
        wrapper.unmount()
    })

    it('counts activity recorded by another EduLog tab', async () => {
        const { onExpire, wrapper } = harness()
        await vi.advanceTimersByTimeAsync(7 * HOUR)
        window.localStorage.setItem('edulog:last-user-activity', String(Date.now()))
        await vi.advanceTimersByTimeAsync(2 * HOUR)
        expect(onExpire).not.toHaveBeenCalled()
        wrapper.unmount()
    })
})

describe('background request marking', () => {
    it('marks requests as background only after a minute without interaction', () => {
        markUserActivity()
        expect(isBackgroundActivity()).toBe(false)
        vi.advanceTimersByTime(61_000)
        expect(isBackgroundActivity()).toBe(true)
        markUserActivity()
        expect(isBackgroundActivity()).toBe(false)
    })
})
