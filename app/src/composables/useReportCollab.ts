import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import CollabService from '@/services/report/CollabService'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/useAuthStore'

export function useReportCollab(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const ydoc = ref<Y.Doc | null>(null)
    const ready = ref(false)

    const reportIdValue = typeof reportId === 'string' ? reportId : reportId.value

    // Per-session origin token to distinguish multiple tabs for same user
    const sessionId = (() => {
        try {
            // prefer crypto.randomUUID when available
            // @ts-ignore
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
        } catch (e) {}
        return 's-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xFFFFFF).toString(36)
    })()

    const initialize = async () => {
        if (!reportIdValue) return
        const originKey = sessionId
        const doc = await CollabService.init(reportIdValue, originKey, authStore.user?.id || '')
        ydoc.value = doc
        ready.value = true
    }

    const saveSnapshot = async () => {
        if (!reportIdValue || !authStore.user?.id) return false
        return CollabService.saveSnapshot(reportIdValue, authStore.user.id)
    }

    const destroy = async () => {
        if (!reportIdValue) return
        await CollabService.destroy(reportIdValue)
        ydoc.value = null
        ready.value = false
    }

    // Awareness map (array of awareness payloads from other users)
    const awareness = ref<any[]>([])

    let awarenessUnsub: (() => void) | null = null

    const sendAwareness = async (payload: object) => {
        if (!reportIdValue) return
        // ensure payload includes userId and sessionId for consumers
        const composed = { ...(payload || {}), userId: authStore.user?.id || '', sessionId }
        await CollabService.sendAwareness(reportIdValue, sessionId, authStore.user?.id || '', composed)
    }

    const startAwarenessListener = () => {
        if (!reportIdValue) return
        awarenessUnsub = CollabService.onAwareness(reportIdValue, (p: any) => {
            // p is a parsed payload (object); store or merge
            // For simplicity convert to array of single payloads keyed by origin_user_id
            try {
                if (!p) return
                // Use sessionId as unique key so multiple tabs of same user don't overwrite
                const key = p.sessionId || p.userId || null
                if (!key) return
                // ignore stale payloads (compare updatedAt)
                const existingIndex = awareness.value.findIndex(a => (a.sessionId || a.userId) === key)
                if (existingIndex >= 0) {
                    const existing = awareness.value[existingIndex]
                    const existingTs = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : 0
                    const incomingTs = p?.updatedAt ? new Date(p.updatedAt).getTime() : 0
                    if (incomingTs < existingTs) return
                    awareness.value.splice(existingIndex, 1, p)
                } else {
                    awareness.value.push(p)
                }
            } catch (e) {
                console.error(e)
            }
        })
    }

    onMounted(() => {
        initialize()
        startAwarenessListener()
    })

    onBeforeUnmount(() => {
        if (awarenessUnsub) awarenessUnsub()
        destroy()
    })

    // lifecycle handled above: initialize() and destroy() are invoked once

    return {
        ydoc,
        ready,
        saveSnapshot,
        destroy,
        awareness,
        sendAwareness,
        sessionId
    }
}
