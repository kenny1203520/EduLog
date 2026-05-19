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

    onMounted(() => {
        initialize()
    })

    onBeforeUnmount(() => {
        destroy()
    })

    return {
        ydoc,
        ready,
        saveSnapshot,
        destroy
    }
}
