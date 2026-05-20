import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import CollabService from '@/services/report/CollabService'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/useAuthStore'

export function useReportCollab(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const ydoc = ref<Y.Doc | null>(null)
    const ready = ref(false)

    const reportIdValue = typeof reportId === 'string' ? reportId : reportId.value

    const initialize = async () => {
        if (!reportIdValue) return
        const userId = authStore.user?.id || ''
        const doc = await CollabService.init(reportIdValue, userId)
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
        await CollabService.sendAwareness(reportIdValue, authStore.user?.id || '', payload)
    }

    const startAwarenessListener = () => {
        if (!reportIdValue) return
        awarenessUnsub = CollabService.onAwareness(reportIdValue, (p: any) => {
            // p is a parsed payload (object); store or merge
            // For simplicity convert to array of single payloads keyed by origin_user_id
            try {
                if (!p || !p.userId) return
                // ignore stale payloads (compare updatedAt)
                const existingIndex = awareness.value.findIndex(a => a.userId === p.userId)
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
        sendAwareness
    }
}
