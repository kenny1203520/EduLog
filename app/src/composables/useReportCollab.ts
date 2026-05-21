import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { SupabaseProvider } from '@/services/report/SupabaseProvider'
import { supabase } from '@/lib/supabase'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/useAuthStore'

export function useReportCollab(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const ydoc = ref<Y.Doc | null>(null)
    const provider = ref<SupabaseProvider | null>(null)
    const ready = ref(false)

    const reportIdValue = typeof reportId === 'string' ? reportId : reportId.value

    const initialize = async () => {
        if (!reportIdValue) return
        
        const doc = new Y.Doc()
        ydoc.value = doc
        
        const userId = authStore.user?.id || ''
        const supabaseProvider = new SupabaseProvider(supabase, doc, reportIdValue, userId)
        provider.value = supabaseProvider
        
        ready.value = true
    }

    const saveSnapshot = async () => {
        if (!provider.value) return false
        return provider.value.saveSnapshot()
    }

    const destroy = async () => {
        if (provider.value) {
            provider.value.destroy()
            provider.value = null
        }
        if (ydoc.value) {
            ydoc.value.destroy()
            ydoc.value = null
        }
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
        provider,
        ready,
        saveSnapshot,
        destroy
    }
}
