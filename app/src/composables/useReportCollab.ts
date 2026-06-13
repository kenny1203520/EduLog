import { ref, shallowRef, watch, onBeforeUnmount, type Ref } from 'vue'
import { SupabaseProvider } from '@/services/report/SupabaseProvider'
import { supabase } from '@/lib/supabase'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/useAuthStore'

export function useReportCollab(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const ydoc = shallowRef<Y.Doc | null>(null)
    const provider = shallowRef<SupabaseProvider | null>(null)
    const ready = ref(false)
    let generation = 0

    const getReportId = () => (typeof reportId === 'string' ? reportId : reportId.value)

    const destroyCurrent = async () => {
        ready.value = false

        if (provider.value) {
            await provider.value.destroy()
            provider.value = null
        }

        if (ydoc.value) {
            ydoc.value.destroy()
            ydoc.value = null
        }
    }

    const initialize = async () => {
        const token = ++generation
        await destroyCurrent()

        const reportIdValue = getReportId()
        if (!reportIdValue) return
        
        const doc = new Y.Doc()
        ydoc.value = doc
        
        const userId = authStore.user?.id || ''
        const supabaseProvider = new SupabaseProvider(supabase, doc, reportIdValue, userId)
        provider.value = supabaseProvider

        await supabaseProvider.ready

        if (token !== generation) {
            await supabaseProvider.destroy()
            doc.destroy()
            return
        }
        
        ready.value = true
    }

    const saveSnapshot = async () => {
        if (!provider.value) return false
        return provider.value.saveSnapshot()
    }

    const destroy = async () => {
        generation += 1
        await destroyCurrent()
    }

    watch(
        () => getReportId(),
        () => {
            void initialize()
        },
        { immediate: true }
    )

    onBeforeUnmount(() => {
        void destroy()
    })

    return {
        ydoc,
        provider,
        ready,
        saveSnapshot,
        destroy
    }
}
