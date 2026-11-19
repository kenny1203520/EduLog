import { onMounted, onUnmounted, ref } from 'vue'
import { installUserActivityTracking, lastUserActivity, markUserActivity, onUserActivity } from '@/lib/userActivity'

/** Open report editors save when they hear this, before an idle sign-out. */
export const SESSION_EXPIRING_EVENT = 'edulog:session-expiring'
/** The warning appears this long before the idle sign-out. */
export const IDLE_WARNING_MS = 5 * 60 * 1000
const CHECK_INTERVAL_MS = 15 * 1000
/**
 * Interaction without any API request (reading, scrolling) still reaches the
 * server at least this often, so its idle clock never runs ahead of this one.
 */
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000
/** Time given to editors to save before the session is ended. */
const FINAL_SAVE_GRACE_MS = 3 * 1000

export type IdleSignOutOptions = {
    /** Idle limit the server enforces. */
    idleTimeoutMs: () => number
    /** Ends the session (sign out and leave). */
    onExpire: () => Promise<void> | void
    /** A user-caused request that refreshes the server's activity record. */
    keepAlive: () => Promise<unknown>
}

/**
 * Warns five minutes before an idle session ends, asks open editors to save,
 * and signs out at the deadline. Activity in any EduLog tab counts.
 */
export function useIdleSignOut(options: IdleSignOutOptions) {
    const warning = ref(false)
    const secondsLeft = ref(0)
    let timer: ReturnType<typeof setInterval> | undefined
    let stopListening: (() => void) | undefined
    let expiring = false
    let lastKeepAlive = Date.now()

    function keepAlive() {
        lastKeepAlive = Date.now()
        return Promise.resolve(options.keepAlive()).catch(() => undefined)
    }

    function requestSave() {
        window.dispatchEvent(new Event(SESSION_EXPIRING_EVENT))
    }

    async function expire() {
        if (expiring) return
        expiring = true
        warning.value = false
        requestSave()
        await new Promise((resolve) => setTimeout(resolve, FINAL_SAVE_GRACE_MS))
        // Activity during the grace period (another tab, or a late click) cancels the sign-out.
        if (Date.now() < lastUserActivity() + options.idleTimeoutMs()) { expiring = false; check(); return }
        await options.onExpire()
    }

    function check(now = Date.now()) {
        if (expiring) return
        const deadline = lastUserActivity() + options.idleTimeoutMs()
        const left = deadline - now
        if (left <= 0) { void expire(); return }
        const shouldWarn = left <= IDLE_WARNING_MS
        if (shouldWarn && !warning.value) requestSave()
        warning.value = shouldWarn
        secondsLeft.value = Math.ceil(left / 1000)
    }

    /** The person chose to stay: count it as activity and tell the server. */
    async function staySignedIn() {
        markUserActivity()
        check()
        await keepAlive()
    }

    onMounted(() => {
        installUserActivityTracking()
        stopListening = onUserActivity((at) => {
            check()
            if (at - lastKeepAlive >= KEEP_ALIVE_INTERVAL_MS) void keepAlive()
        })
        check()
        timer = setInterval(() => check(), CHECK_INTERVAL_MS)
    })
    onUnmounted(() => {
        clearInterval(timer)
        stopListening?.()
    })

    return { warning, secondsLeft, staySignedIn, check }
}
