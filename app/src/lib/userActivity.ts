/**
 * When the person last interacted with EduLog, shared across this browser's
 * tabs. The API uses it to tell user-caused requests from background polling,
 * and the idle sign-out uses it to decide when a session has gone quiet.
 */
const STORAGE_KEY = 'edulog:last-user-activity'
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
/** Requests after this long without interaction count as background. */
export const BACKGROUND_AFTER_MS = 60 * 1000
/** Interaction is written to shared storage at most this often. */
const SHARE_INTERVAL_MS = 15 * 1000

let lastActivity = Date.now()
let lastShared = 0
let installed = false
const listeners = new Set<(at: number) => void>()

function readShared(): number {
    try {
        const value = Number(window.localStorage.getItem(STORAGE_KEY))
        return Number.isFinite(value) ? value : 0
    } catch { return 0 }
}

function share(at: number) {
    if (at - lastShared < SHARE_INTERVAL_MS) return
    lastShared = at
    try { window.localStorage.setItem(STORAGE_KEY, String(at)) } catch { /* Per-tab tracking still works. */ }
}

function update(at: number, fromOtherTab = false) {
    if (at <= lastActivity) return
    lastActivity = at
    if (!fromOtherTab) share(at)
    for (const listener of listeners) listener(at)
}

/** Records an interaction now, such as choosing to stay signed in. */
export function markUserActivity(at = Date.now()) {
    lastShared = 0
    update(at)
}

/** The latest interaction in any EduLog tab of this browser. */
export function lastUserActivity(): number {
    return Math.max(lastActivity, typeof window === 'undefined' ? 0 : readShared())
}

/** True when nobody has interacted for a minute, so a request is background work. */
export function isBackgroundActivity(now = Date.now()): boolean {
    return now - lastUserActivity() > BACKGROUND_AFTER_MS
}

/** Calls back on every interaction in this or another tab; returns the unsubscribe. */
export function onUserActivity(listener: (at: number) => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** Starts listening for interaction. Safe to call more than once. */
export function installUserActivityTracking() {
    if (installed || typeof window === 'undefined') return
    installed = true
    const onInteraction = () => update(Date.now())
    for (const event of EVENTS) window.addEventListener(event, onInteraction, { passive: true, capture: true })
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY && event.newValue) update(Number(event.newValue), true)
    })
}

/** Test seam: forget all recorded activity. */
export function resetUserActivityForTests(at = Date.now()) {
    lastActivity = at
    lastShared = 0
    listeners.clear()
    try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}
