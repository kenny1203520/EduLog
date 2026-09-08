import { computed, isRef, onBeforeUnmount, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import i18n from '@/i18n'
import {
    SupabaseProvider,
    type ReportCollabConnectionStatus,
    type ReportCollabInitialState,
    type ReportCollabPeer,
    type SupabaseProviderOptions
} from '@/services/report/SupabaseProvider'
import { apiDataClient } from '@/services/api/ApiDataClient'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/useAuthStore'

export type ReportCollaborationStatus = 'disabled' | 'connecting' | 'ready' | 'error'

export interface ReportCollaborationConfiguration {
    enabled: boolean
    snapshotDebounceMs: number
    presenceEnabled: boolean
    connectOnMount: boolean
}

export interface ReportCollaborationOptions extends Partial<ReportCollaborationConfiguration> {
    providerFactory?: (
        doc: Y.Doc,
        reportId: string,
        reportVersion: number,
        userId: string,
        options: SupabaseProviderOptions
    ) => SupabaseProvider
}

type MaybeRef<T> = T | Ref<T>

function resolve<T>(value: MaybeRef<T> | undefined): T | undefined {
    return isRef(value) ? value.value : value
}

export function useReportCollab(
    reportId: Ref<string> | string,
    reportVersion: Ref<number> | number,
    inputOptions: MaybeRef<ReportCollaborationOptions> = {}
) {
    const authStore = useAuthStore()
    const initialOptions = resolve(inputOptions) || {}
    const configuration = reactive<ReportCollaborationConfiguration>({
        enabled: initialOptions.enabled ?? true,
        snapshotDebounceMs: Math.max(250, Math.min(30000, initialOptions.snapshotDebounceMs ?? 2500)),
        presenceEnabled: initialOptions.presenceEnabled ?? true,
        connectOnMount: initialOptions.connectOnMount ?? true
    })
    const providerFactory = initialOptions.providerFactory || defaultProviderFactory
    const ydoc = shallowRef<Y.Doc | null>(null)
    const provider = shallowRef<SupabaseProvider | null>(null)
    const ready = ref(false)
    const status = ref<ReportCollaborationStatus>(configuration.enabled ? 'connecting' : 'disabled')
    const error = ref<string | null>(null)
    const initialState = ref<ReportCollabInitialState>('none')
    const activePeers = ref<ReportCollabPeer[]>([])
    const lastSyncedAt = ref<Date | null>(null)
    let generation = 0
    let awarenessHandler: (() => void) | null = null

    const getReportId = () => (typeof reportId === 'string' ? reportId : reportId.value)
    const getReportVersion = () => (typeof reportVersion === 'number' ? reportVersion : reportVersion.value)

    function updatePeers(): void {
        activePeers.value = provider.value?.getActivePeers() || []
    }

    // Defaults to flushing the pending Yjs snapshot before tearing the provider
    // down. This runs both when switching to a different report (connect(), via
    // its internal teardown of the previous session) and on unmount (destroy()):
    // collaborative content that only exists in the Y.Doc and never made it into
    // occurrence_reports would otherwise be silently discarded whenever either
    // happens, which is exactly the "switched pages" / "closed the tab mid-edit"
    // data-loss path this guards against.
    async function destroyCurrent(flush = true) {
        ready.value = false
        initialState.value = 'none'
        activePeers.value = []
        if (provider.value) {
            if (flush) await provider.value.saveSnapshot()
            if (awarenessHandler) provider.value.awareness.off('change', awarenessHandler)
            awarenessHandler = null
            await provider.value.destroy()
            provider.value = null
        }
        if (ydoc.value) {
            ydoc.value.destroy()
            ydoc.value = null
        }
    }

    function handleStatus(next: ReportCollabConnectionStatus): void {
        status.value = next === 'connected' ? 'ready' : next === 'disconnected' ? 'error' : next
        if (next === 'error') error.value = i18n.global.t('report.collaboration_connection_failed')
    }

    const connect = async () => {
        if (!configuration.enabled) {
            status.value = 'disabled'
            return false
        }
        const token = ++generation
        await destroyCurrent(false)
        if (token !== generation) return false
        const reportIdValue = getReportId()
        if (!reportIdValue) {
            status.value = 'error'
            return false
        }

        error.value = null
        status.value = 'connecting'
        const doc = new Y.Doc()
        ydoc.value = doc
        const userId = authStore.user?.id || ''
        const nextProvider = providerFactory(doc, reportIdValue, getReportVersion(), userId, {
            snapshotDebounceMs: configuration.snapshotDebounceMs,
            presenceEnabled: configuration.presenceEnabled,
            onStatus: handleStatus
        })
        provider.value = nextProvider
        awarenessHandler = updatePeers
        nextProvider.awareness.on('change', awarenessHandler)

        try {
            await nextProvider.ready
        } catch (reason: any) {
            if (token === generation) {
                error.value = reason?.message || i18n.global.t('report.collaboration_init_failed')
                status.value = 'error'
                await destroyCurrent(false)
            } else {
                await nextProvider.destroy()
                doc.destroy()
            }
            return false
        }

        if (token !== generation) {
            await nextProvider.destroy()
            doc.destroy()
            return false
        }
        initialState.value = nextProvider.initialState
        ready.value = true
        status.value = nextProvider.connected ? 'ready' : status.value
        updatePeers()
        return true
    }

    const disconnect = async (options: { flush?: boolean } = {}) => {
        generation += 1
        await destroyCurrent(options.flush ?? true)
        status.value = configuration.enabled ? 'error' : 'disabled'
    }

    const reconnect = async () => {
        await disconnect({ flush: true })
        return connect()
    }

    const saveSnapshot = async () => {
        if (!provider.value) return false
        const saved = await provider.value.saveSnapshot()
        if (saved) lastSyncedAt.value = new Date()
        return saved
    }

    const setBaseReportVersion = (version: number) => provider.value?.setBaseReportVersion(version)

    function setEnabled(enabled: boolean) {
        configuration.enabled = enabled
        if (!enabled) void disconnect({ flush: true })
        else void connect()
    }

    function configure(updates: Partial<ReportCollaborationConfiguration>): ReportCollaborationConfiguration {
        const requiresReconnect =
            (updates.snapshotDebounceMs !== undefined && updates.snapshotDebounceMs !== configuration.snapshotDebounceMs) ||
            (updates.presenceEnabled !== undefined && updates.presenceEnabled !== configuration.presenceEnabled)
        if (updates.snapshotDebounceMs !== undefined) configuration.snapshotDebounceMs = Math.max(250, Math.min(30000, updates.snapshotDebounceMs))
        if (updates.presenceEnabled !== undefined) configuration.presenceEnabled = updates.presenceEnabled
        if (updates.connectOnMount !== undefined) configuration.connectOnMount = updates.connectOnMount
        if (updates.enabled !== undefined && updates.enabled !== configuration.enabled) setEnabled(updates.enabled)
        else if (requiresReconnect && configuration.enabled && provider.value) void reconnect()
        return { ...configuration }
    }

    const destroy = async () => {
        generation += 1
        await destroyCurrent()
        status.value = configuration.enabled ? 'error' : 'disabled'
    }

    watch(
        () => getReportId(),
        () => {
            if (configuration.enabled && configuration.connectOnMount) void connect()
            else void disconnect({ flush: true })
        },
        { immediate: true }
    )

    if (isRef(inputOptions)) {
        watch(inputOptions, value => configure(value || {}), { deep: true })
    }

    onBeforeUnmount(() => { void destroy() })

    return {
        configuration, ydoc, provider, ready, status, error, initialState, activePeers,
        activePeerCount: computed(() => activePeers.value.length), onlineParticipantCount: computed(() => ready.value && provider.value?.connected ? activePeers.value.length + 1 : 0), lastSyncedAt,
        connect, disconnect, reconnect, saveSnapshot, setBaseReportVersion, setEnabled, configure, destroy
    }
}

function defaultProviderFactory(
    doc: Y.Doc,
    reportId: string,
    reportVersion: number,
    userId: string,
    options: SupabaseProviderOptions
): SupabaseProvider {
    return new SupabaseProvider(apiDataClient, doc, reportId, reportVersion, userId, options)
}
