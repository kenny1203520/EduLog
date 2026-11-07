import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, inject, type Ref, type WatchStopHandle } from 'vue'
import { onBeforeRouteLeave, routerViewLocationKey } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useAutoSave, type AutoSaveErrorContext } from '@/composables/useAutoSave'
import { classifyDraftRecovery, mergeDraftOntoServer, useReportLocalDraft, type DraftRecoveryAction } from '@/composables/useReportLocalDraft'
import { useReportCollab } from '@/composables/useReportCollab'
import type { LocalReportDraft } from '@/services/report/LocalDraftStore'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { mergeReportConflict } from '@/services/report/ReportConflictMerge'
import { useAuthStore } from '@/stores/useAuthStore'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { RealtimeBadgeTone } from '@/components/ui/RealtimeStatusBadge.vue'
import type { TextEditorChange, TextEditorContent, TextEditorHandle, TextEditorMetrics } from '@/components/text-editor/types'
import { calculateTextEditorMetrics, createTextEditorContent } from '@/components/text-editor/content'
import { createEditorNotifier } from '@/components/text-editor/notifier'
import { DEFAULT_EDITOR_USER_SETTINGS, normalizeEditorUserSettings, type EditorUserSettings } from '@/components/text-editor/settings'
import type { OccurrenceReportDTO, ReportDraftSnapshot, SaveReportResult } from '@/models/OccurrenceReport'
import {
    buildDirtyReportPayload,
    buildSnapshotFromDto,
    buildSnapshotFromProps,
    normalizeReportRating,
    normalizeSystemManagedReason,
    type AttendanceStatus
} from '@/models/ReportEditorSnapshot'
import { isBrowserOffline, isNetworkError } from '@/utils/networkErrors'
import { DateUtils } from '@/utils/dateUtils'
import { safeExternalHref } from '@/utils/safeExternalHref'
import { normalizeAbsenceReasonCode } from '@/utils/absenceReason'
import type { RenderedReportTemplate } from '@/composables/report/useReportTemplateManager'
import type { ReportEditorEmit, ResolvedReportEditorProps } from '@/components/report/reportEditorContract'

type EditorRef = Readonly<Ref<TextEditorHandle | null>>

interface ReportEditorSessionOptions {
    /** The three text editors the template renders (rich/collaborative or plain). */
    editors: { content: EditorRef; contactNotes: EditorRef; classNotes: EditorRef }
    openConfirm: (title: string, message: string, action: () => Promise<void>, isDangerous?: boolean) => void
}

/**
 * One report being edited: its fields, the auto-save state machine, the
 * collaboration (Yjs) metadata sync, device-local draft recovery and the
 * page-leave guards. ReportEditor renders this state and forwards events.
 */
export function useReportEditorSession(
    props: ResolvedReportEditorProps,
    emit: ReportEditorEmit,
    options: ReportEditorSessionOptions
) {
    const preferences = usePreferencesStore()
    const contentEditorRef = options.editors.content
    const contactNotesEditorRef = options.editors.contactNotes
    const classNotesEditorRef = options.editors.classNotes
    const openConfirm = options.openConfirm
    const toast = useToast()
    const effectiveAutoSaveEnabled = computed(() => props.autoSaveEnabled ?? preferences.editorSettings.autoSave.enabled)
    const effectiveCollaborationEnabled = computed(() => props.collaborationEnabled ?? preferences.editorSettings.collaboration.enabled)
    const effectiveNotificationsEnabled = computed(() => props.notificationsEnabled ?? preferences.editorSettings.notificationsEnabled)
    const editorNotifier = createEditorNotifier(notification => emit('notification', notification), toast, effectiveNotificationsEnabled.value)
    watch(effectiveNotificationsEnabled, enabled => editorNotifier.setEnabled(enabled))

    const handleCopyContent = (text: string) => {
        if (!text) return
        if (isTextEditorHandle(contentEditorRef.value)) {
            const current = contentEditorRef.value.getText()
            contentEditorRef.value.replaceText(current + (current ? '\n\n' : '') + text, { emitChange: true })
        } else {
            const current = localContent.value || ''
            localContent.value = current + (current ? '\n\n' : '') + text
            handleInput()
        }
    }

    const aiInsertFlash = ref(false)
    let aiFlashTimer: ReturnType<typeof setTimeout> | undefined

    /** Brief visual cue that AI text landed in the report; nothing is stored in the document. */
    function flashAiInsert() {
        aiInsertFlash.value = true
        clearTimeout(aiFlashTimer)
        aiFlashTimer = setTimeout(() => { aiInsertFlash.value = false }, 1000)
    }

    /** Insert AI text at the cursor (or append when the rich editor is not ready). */
    function handleAiInsert(text: string) {
        if (!text) return
        if (isTextEditorHandle(contentEditorRef.value)) {
            const editor = contentEditorRef.value
            editor.insertText((editor.getText() ? '\n\n' : '') + text)
        } else {
            handleCopyContent(text)
        }
        flashAiInsert()
    }

    function handleAiReplace(text: string) {
        if (isTextEditorHandle(contentEditorRef.value)) {
            contentEditorRef.value.replaceText(text, { emitChange: true })
        } else {
            localContent.value = text
            handleInput()
        }
        flashAiInsert()
    }

    /** The server reads notes from the database, so unsaved edits are saved first. */
    async function flushBeforeAi(): Promise<boolean> {
        if (!hasUnsavedChanges.value) return true
        return saveNow({ reason: 'manual' })
    }
    async function handleDeleteReport() {
        if (!props.reportId) return

        openConfirm(
            t('report.editor.delete_report_title', 'Delete Report'),
            t('report.editor.delete_report_confirm', 'Are you sure you want to delete this report? This will revert the student\'s progress.'),
            async () => {
                try {
                    await OccurrenceReportService.deleteReportAndRevertProgress(props.reportId!)
                    toast.success(t('report.editor.delete_success') || 'Report deleted')
                    emit('deleted')
                } catch (e: any) {
                    console.error('Failed to delete report', e)
                    saveError.value = e.message
                }
            },
            true // Dangerous
        )
    }
    // Collab logic
    const collaborationUser = computed(() => ({ name: authStore.user?.display_name || authStore.user?.nickname || authStore.user?.full_name || 'Teacher', color: '#60A5FA' }))

    const reportIdRef = computed(() => props.reportId || '')
    const initialReportVersionRef = computed(() => props.initialVersion)
    const {
        ydoc,
        provider: awarenessProvider,
        ready,
        error: collaborationError,
        initialState: collabInitialState,
        saveSnapshot,
        setBaseReportVersion,
        reconnect: reconnectCollaboration,
        status: collaborationStatus,
        activePeers,
        onlineParticipantCount,
        setEnabled: setCollaborationEnabled,
        configure: configureCollaboration
    } = useReportCollab(reportIdRef as any, initialReportVersionRef, computed(() => ({
        enabled: effectiveCollaborationEnabled.value,
        snapshotDebounceMs: preferences.editorSettings.collaboration.snapshotDebounceMs,
        presenceEnabled: preferences.editorSettings.collaboration.presenceEnabled
    })))


    const collabWatchStops: WatchStopHandle[] = []
    let collabEditorGeneration = 0
    let reportEditorUnmounted = false

    function isTextEditorHandle(value: unknown): value is TextEditorHandle {
        if (!value || typeof value !== 'object') return false
        const handle = value as Partial<TextEditorHandle>
        return typeof handle.getText === 'function'
            && typeof handle.getContent === 'function'
            && typeof handle.replaceContent === 'function'
    }

    function handleEditorFieldFocus(event: FocusEvent) {
        const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-collab-field]') : null
        const field = element?.dataset.collabField
        const awareness = awarenessProvider.value?.awareness
        if (field && awareness) awareness.setLocalStateField('activity', { field, focused: true })
    }

    function handleEditorFieldBlur(event: FocusEvent) {
        const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-collab-field]') : null
        const field = element?.dataset.collabField
        const awareness = awarenessProvider.value?.awareness
        if (field && awareness && (!event.relatedTarget || !(event.relatedTarget instanceof Node) || !element?.contains(event.relatedTarget))) {
            awareness.setLocalStateField('activity', { field, focused: false })
        }
    }

    function handleCollaborationActivity(field: string, activity: { caret: number; selectionEnd: number; focused?: boolean }) {
        const awareness = awarenessProvider.value?.awareness
        if (!awareness) return
        awareness.setLocalStateField('activity', { field, ...activity })
    }
    let collabMetaMap: any = null
    let collabMetaObserver: ((event: any) => void) | null = null
    let collabMetaHydratedReportId: string | null = null
    let isApplyingRemoteCollab = false

    function cleanupReportCollabBindings() {
        collabWatchStops.splice(0).forEach((stop) => stop())

        if (collabMetaMap && collabMetaObserver) {
            collabMetaMap.unobserve(collabMetaObserver)
        }
        collabMetaMap = null
        collabMetaObserver = null

    }

    function withCollabGuard(fn: () => void) {
        isApplyingRemoteCollab = true
        try {
            fn()
        } finally {
            isApplyingRemoteCollab = false
        }
    }


    function syncTextRefsFromEditors() {
        if (isTextEditorHandle(contentEditorRef.value)) {
            const content = contentEditorRef.value.getContent()
            localContent.value = content.plainText
            contentDocument.value = content.richText
        }
        if (isTextEditorHandle(contactNotesEditorRef.value)) {
            const content = contactNotesEditorRef.value.getContent()
            contactNotes.value = content.plainText
            contactNotesDocument.value = content.richText
        }
        if (isTextEditorHandle(classNotesEditorRef.value)) {
            const content = classNotesEditorRef.value.getContent()
            classNotes.value = content.plainText
            classNotesDocument.value = content.richText
        }
    }

    function setEditorContentSilently(editorRef: { value: TextEditorHandle | null }, content: TextEditorContent) {
        if (isTextEditorHandle(editorRef.value)) editorRef.value.replaceContent(content)
    }

    function writeReportMeta(metaMap: any) {
        const managedReason = canonicalSystemManagedReason()
        metaMap.set('attendanceStatus', managedReason ? canonicalSystemManagedStatus() : attendanceStatus.value)
        metaMap.set('absenceReason', managedReason || absenceReason.value)
        metaMap.set('classParticipation', classParticipation.value)
        metaMap.set('classroomBehavior', classroomBehavior.value)
        metaMap.set('isCompleted', isCompleted.value)
        metaMap.set('progressStart', progressStart.value)
        metaMap.set('progressEnd', progressEnd.value)
        metaMap.set('selectedLessonId', selectedLessonId.value)
        metaMap.set('reportExternalLink', reportExternalLink.value)
        metaMap.set('version', version.value)
    }

    watch(ready, (isReady) => {
        const generation = ++collabEditorGeneration
        cleanupReportCollabBindings()

        if (isReady && ydoc.value) {
            // Setup reportMeta sync
            const metaMap = ydoc.value.getMap('reportMeta')
            collabMetaMap = metaMap

            // A reconnect reuses the same Y.Doc. Do not rehydrate Vue fields from
            // its map while the editor has local unsaved changes; that would reset
            // fields such as attendance to an older shared snapshot.
            const reportKey = props.reportId || ''
            const shouldHydrateMeta = collabMetaHydratedReportId !== reportKey || !hasUnsavedChanges.value
            if (shouldHydrateMeta) withCollabGuard(() => {
                const managedReason = canonicalSystemManagedReason()
                if (managedReason) {
                    // The API/props are canonical for system-managed attendance;
                    // never hydrate these two fields from a stale Yjs document.
                    attendanceStatus.value = canonicalSystemManagedStatus()
                    absenceReason.value = managedReason
                    metaMap.set('attendanceStatus', attendanceStatus.value)
                    metaMap.set('absenceReason', absenceReason.value)
                } else {
                    // The API props are the committed report state. A retained Yjs
                    // snapshot can outlive a save or reconnect, so it must not
                    // replace the status shown on the cards with an older value.
                    attendanceStatus.value = props.initialAttendanceStatus || 'pending'
                    metaMap.set('attendanceStatus', attendanceStatus.value)

                    if (metaMap.has('absenceReason')) absenceReason.value = normalizeAbsenceReasonCode(String(metaMap.get('absenceReason') || ''))
                    else metaMap.set('absenceReason', absenceReason.value)
                }

                if (metaMap.has('classParticipation')) {
                    classParticipation.value = normalizeReportRating(metaMap.get('classParticipation'))
                    if (metaMap.get('classParticipation') !== classParticipation.value) metaMap.set('classParticipation', classParticipation.value)
                } else metaMap.set('classParticipation', classParticipation.value)

                if (metaMap.has('classroomBehavior')) {
                    classroomBehavior.value = normalizeReportRating(metaMap.get('classroomBehavior'))
                    if (metaMap.get('classroomBehavior') !== classroomBehavior.value) metaMap.set('classroomBehavior', classroomBehavior.value)
                } else metaMap.set('classroomBehavior', classroomBehavior.value)

                if (metaMap.has('isCompleted')) isCompleted.value = Boolean(metaMap.get('isCompleted'))
                else metaMap.set('isCompleted', isCompleted.value)

                if (metaMap.has('progressStart')) progressStart.value = (metaMap.get('progressStart') as string) || ''
                else metaMap.set('progressStart', progressStart.value)

                if (metaMap.has('progressEnd')) progressEnd.value = (metaMap.get('progressEnd') as string) || ''
                else metaMap.set('progressEnd', progressEnd.value)

                if (metaMap.has('selectedLessonId')) selectedLessonId.value = (metaMap.get('selectedLessonId') as string) || ''
                else metaMap.set('selectedLessonId', selectedLessonId.value)

                if (metaMap.has('reportExternalLink')) reportExternalLink.value = (metaMap.get('reportExternalLink') as string) || ''
                else metaMap.set('reportExternalLink', reportExternalLink.value)

                if (metaMap.has('version')) {
                    const remoteVersion = Number(metaMap.get('version') || 0)
                    if (remoteVersion > version.value) {
                        version.value = remoteVersion
                        setBaseReportVersion(remoteVersion)
                    }
                } else {
                    metaMap.set('version', version.value)
                }
            })
            if (collabMetaHydratedReportId !== reportKey) collabMetaHydratedReportId = reportKey
            
            collabMetaObserver = (event) => {
                withCollabGuard(() => {
                    event.changes.keys.forEach((_: unknown, key: string) => {
                        const newVal = metaMap.get(key)
                        if (key === 'attendanceStatus' || key === 'absenceReason') {
                            const managedReason = canonicalSystemManagedReason()
                            if (managedReason) {
                                if (key === 'attendanceStatus') {
                                    const canonicalValue = canonicalSystemManagedStatus()
                                    if (newVal !== canonicalValue) metaMap.set(key, canonicalValue)
                                    if (attendanceStatus.value !== canonicalValue) attendanceStatus.value = canonicalValue
                                } else {
                                    const canonicalValue = managedReason
                                    if (newVal !== canonicalValue) metaMap.set(key, canonicalValue)
                                    if (absenceReason.value !== canonicalValue) absenceReason.value = canonicalValue
                                }
                            } else if (key === 'attendanceStatus' && newVal !== attendanceStatus.value) {
                                attendanceStatus.value = newVal as any
                            } else if (key === 'absenceReason' && newVal !== absenceReason.value) {
                                // A stale collaboration document may contain a
                                // holiday/suspension marker for a report that the
                                // canonical API says is user-managed. Ignore it.
                                if (!normalizeSystemManagedReason(newVal)) {
                                    const normalizedReason = normalizeAbsenceReasonCode(String(newVal || ''))
                                    absenceReason.value = normalizedReason
                                    if (normalizedReason !== newVal) metaMap.set('absenceReason', normalizedReason)
                                }
                                else if (metaMap.get('absenceReason') !== (props.initialAbsenceReason || '')) metaMap.set('absenceReason', props.initialAbsenceReason || '')
                            }
                        }
                        if (key === 'classParticipation') {
                            const rating = normalizeReportRating(newVal)
                            if (newVal !== rating) metaMap.set(key, rating)
                            if (rating !== classParticipation.value) classParticipation.value = rating
                        }
                        if (key === 'classroomBehavior') {
                            const rating = normalizeReportRating(newVal)
                            if (newVal !== rating) metaMap.set(key, rating)
                            if (rating !== classroomBehavior.value) classroomBehavior.value = rating
                        }
                        if (key === 'isCompleted' && Boolean(newVal) !== isCompleted.value) isCompleted.value = Boolean(newVal)
                        if (key === 'progressStart' && (newVal || '') !== progressStart.value) progressStart.value = newVal as any || ''
                        if (key === 'progressEnd' && (newVal || '') !== progressEnd.value) progressEnd.value = newVal as any || ''
                        if (key === 'selectedLessonId' && (newVal || '') !== selectedLessonId.value) selectedLessonId.value = newVal as any || ''
                        if (key === 'reportExternalLink' && (newVal || '') !== reportExternalLink.value) reportExternalLink.value = safeExternalHref(String(newVal || '')) || ''
                        if (key === 'version') {
                            // A peer's save advanced the report's DB version. Their
                            // content is CRDT-merged into our editor already, but
                            // `version` is also the optimistic-concurrency token this
                            // editor sends with ITS OWN next save (see onSave below) --
                            // trusting a broadcast for that would let a save through
                            // whose local snapshot was never confirmed to genuinely be
                            // that version's full state (e.g. after a dropped realtime
                            // message). So only the snapshot guard is updated here;
                            // `version` itself only advances once our own save
                            // succeeds, and until then the server's real CAS check
                            // will correctly surface a conflict instead of a silent
                            // overwrite.
                            const remoteVersion = Number(newVal || 0)
                            if (remoteVersion > version.value) {
                                remoteVersionDrift.value = true
                                setBaseReportVersion(remoteVersion)
                                editorNotifier.notify({
                                    code: 'remote-change',
                                    level: 'info',
                                    message: t('report.editor.remote_update_notice'),
                                    toast: true
                                })
                            }
                        }
                    })
                })
            }
            metaMap.observe(collabMetaObserver)

            // Listen for local changes to update map
            const setupMapSync = (refVar: any, mapKey: string) => {
                const stop = watch(refVar, (val) => {
                    if (isApplyingRemoteCollab || isInitializing.value) return
                    if (mapKey === 'attendanceStatus' || mapKey === 'absenceReason') {
                        const managedReason = canonicalSystemManagedReason()
                        if (managedReason) {
                            const canonicalValue = mapKey === 'attendanceStatus'
                                ? canonicalSystemManagedStatus()
                                : managedReason
                            if (metaMap.get(mapKey) !== canonicalValue) metaMap.set(mapKey, canonicalValue)
                            if (val !== canonicalValue) refVar.value = canonicalValue
                            return
                        }
                    }
                    if (metaMap.get(mapKey) !== val) {
                        metaMap.set(mapKey, val)
                        handleInput()
                    }
                }, { flush: 'sync' })
                collabWatchStops.push(stop)
            }
            
            setupMapSync(attendanceStatus, 'attendanceStatus')
            setupMapSync(absenceReason, 'absenceReason')
            setupMapSync(classParticipation, 'classParticipation')
            setupMapSync(classroomBehavior, 'classroomBehavior')
            setupMapSync(isCompleted, 'isCompleted')
            setupMapSync(progressStart, 'progressStart')
            setupMapSync(progressEnd, 'progressEnd')
            setupMapSync(selectedLessonId, 'selectedLessonId')
            setupMapSync(reportExternalLink, 'reportExternalLink')
            
            // Seed XML fragments on initialization if ydoc has no content but local has content
            nextTick(() => {
                if (reportEditorUnmounted || generation !== collabEditorGeneration || !ready.value || !ydoc.value) return
                withCollabGuard(() => {
                    let seeded = false

                    if (isTextEditorHandle(contentEditorRef.value) && !contentEditorRef.value.getText() && ydoc.value?.getXmlFragment('content_xml').length === 0 && localContent.value) {
                        setEditorContentSilently(contentEditorRef, contentEditorValue.value)
                        seeded = true
                    }
                    if (isTextEditorHandle(contactNotesEditorRef.value) && !contactNotesEditorRef.value.getText() && ydoc.value?.getXmlFragment('contactNotes_xml').length === 0 && contactNotes.value) {
                        setEditorContentSilently(contactNotesEditorRef, contactNotesEditorValue.value)
                        seeded = true
                    }
                    if (isTextEditorHandle(classNotesEditorRef.value) && !classNotesEditorRef.value.getText() && ydoc.value?.getXmlFragment('classNotes_xml').length === 0 && classNotes.value) {
                        setEditorContentSilently(classNotesEditorRef, classNotesEditorValue.value)
                        seeded = true
                    }

                    syncTextRefsFromEditors()

                    if (collabInitialState.value === 'stale') {
                        // The persisted collab snapshot was based on an older report
                        // version than the one we just loaded -- something else (a
                        // peer's save, an attendance-only update, a holiday version
                        // bump, ...) advanced the version since it was written. We
                        // have no way to know whether that snapshot held edits that
                        // were never otherwise persisted, so it must not be silently
                        // overwritten with a doc reseeded from the canonical row.
                        // Leave report_collab_docs untouched; it will be properly
                        // superseded once the user's own edits trigger a real save.
                        editorNotifier.notify({
                            code: 'remote-change',
                            level: 'warning',
                            message: t('report.editor.stale_collab_snapshot_notice'),
                            toast: true
                        })
                    } else if (seeded || collabInitialState.value !== 'loaded') {
                        void saveSnapshot()
                    }
                })

                if (collabInitialState.value === 'loaded') {
                    queueRecoveredDraftWhenReady()
                }
            })

        }
    })
    const authStore = useAuthStore()
    const { t } = useI18n()
    const collaborationConnectingMessage = computed(() => collaborationStatus.value === 'subscribing'
        ? t('report.editor.collaboration_subscribing')
        : t('report.editor.collaboration_connecting'))
    // Collaboration is a convenience: editing and saving keep working whatever the
    // state, so the badge only recolors instead of pushing banners into the layout.
    const collaborationBadge = computed<{ tone: RealtimeBadgeTone; label: string; message: string; canRetry: boolean }>(() => {
        const status = collaborationStatus.value
        if (collabInitialState.value === 'error' && status !== 'ready') {
            return { tone: 'paused', label: t('report.editor.collaboration_badge_paused'), message: collaborationStatusMessage.value, canRetry: true }
        }
        switch (status) {
            case 'ready':
                return { tone: 'live', label: t('report.editor.collaboration_badge_live'), message: t('report.editor.collaboration_live'), canRetry: false }
            case 'connecting':
            case 'subscribing':
                return { tone: 'connecting', label: t('report.editor.collaboration_connecting_short'), message: collaborationConnectingMessage.value, canRetry: false }
            case 'reconnecting':
            case 'offline':
                return { tone: 'warning', label: t(status === 'offline' ? 'report.editor.collaboration_badge_offline' : 'report.editor.collaboration_badge_reconnecting'), message: collaborationStatusMessage.value, canRetry: true }
            case 'forbidden':
            case 'auth-expired':
            case 'account-disabled':
                return { tone: 'paused', label: t('report.editor.collaboration_badge_paused'), message: collaborationStatusMessage.value, canRetry: false }
            default:
                return { tone: 'paused', label: t('report.editor.collaboration_badge_paused'), message: collaborationStatusMessage.value, canRetry: true }
        }
    })
    const collaborationStatusMessage = computed(() => {
        switch (collaborationStatus.value) {
            case 'offline': return t('report.editor.collaboration_offline')
            case 'forbidden': return t('report.editor.collaboration_forbidden')
            case 'auth-expired': return t('report.editor.collaboration_auth_expired')
            case 'account-disabled': return t('report.editor.collaboration_account_disabled')
            default: return t('report.editor.collaboration_disconnected')
        }
    })

    // Local state
    const initialMainContent = createTextEditorContent(props.initialContentDocument || props.initialContent)
    const initialContactContent = createTextEditorContent(props.initialContactNotesDocument || props.initialContactNotes)
    const initialClassContent = createTextEditorContent(props.initialClassNotesDocument || props.initialClassNotes)
    const localContent = ref(initialMainContent.plainText)
    const contentDocument = ref(initialMainContent.richText)
    // The version our local snapshot is actually based on. This is the optimistic-
    // concurrency token sent with every save, so it must only ever advance when our
    // local content genuinely catches up with that version: on our own successful
    // save, when the parent hands us a freshly-reloaded report, or on an explicit
    // canonical reload. A peer's collab broadcast alone must never bump it -- see
    // remoteVersionDrift below.
    const version = ref(props.initialVersion)
    // True once a Yjs broadcast has reported a report version newer than the one
    // our local snapshot is based on. We deliberately do NOT fast-forward `version`
    // to match: doing so used to let a stale local buffer pass the save's
    // optimistic-concurrency check and silently overwrite the peer's saved content.
    // Leaving `version` at its true baseline means the next save's CAS check
    // (ReportCommandService.saveReport) correctly reports a conflict instead.
    const remoteVersionDrift = ref(false)



    const selectedLessonId = ref(props.initialLessonId || '')
    const isCompleted = ref(props.initialIsCompleted)
    const progressStart = ref(props.initialProgressStart || '')
    const progressEnd = ref(props.initialProgressEnd || '')
    const attendanceStatus = ref<'present' | 'absent' | 'pending'>(props.initialAttendanceStatus)
    const absenceReason = ref(normalizeAbsenceReasonCode(props.initialAbsenceReason))
    // These refs are populated only from canonical API/props data. Collaboration
    // metadata must never be allowed to promote a normal report into a managed one.
    const managedAttendanceReason = ref<'holiday' | 'suspension' | null>(normalizeSystemManagedReason(props.initialAbsenceReason))
    const managedAttendanceStatus = ref<'present' | 'absent' | 'pending' | null>(
        managedAttendanceReason.value ? (props.initialAttendanceStatus || 'absent') : null
    )
    const classParticipation = ref<number | null>(normalizeReportRating(props.initialClassParticipation))
    const classroomBehavior = ref<number | null>(normalizeReportRating(props.initialClassroomBehavior))
    const contactNotes = ref(initialContactContent.plainText)
    const contactNotesDocument = ref(initialContactContent.richText)
    const classNotes = ref(initialClassContent.plainText)
    const classNotesDocument = ref(initialClassContent.richText)
    const reportExternalLink = ref(safeExternalHref(props.initialReportExternalLink) || '')

    const contentEditorValue = computed<TextEditorContent>({
        get: () => ({ plainText: localContent.value, richText: contentDocument.value }),
        set: value => { localContent.value = value.plainText; contentDocument.value = value.richText }
    })
    const contactNotesEditorValue = computed<TextEditorContent>({
        get: () => ({ plainText: contactNotes.value, richText: contactNotesDocument.value }),
        set: value => { contactNotes.value = value.plainText; contactNotesDocument.value = value.richText }
    })
    const classNotesEditorValue = computed<TextEditorContent>({
        get: () => ({ plainText: classNotes.value, richText: classNotesDocument.value }),
        set: value => { classNotes.value = value.plainText; classNotesDocument.value = value.richText }
    })
    function canonicalSystemManagedReason(): 'holiday' | 'suspension' | null {
        // The initial API value is authoritative. A collaboration document may
        // contain stale metadata from before the report became system-managed.
        return managedAttendanceReason.value
    }

    function canonicalSystemManagedStatus(): AttendanceStatus {
        return managedAttendanceStatus.value || props.initialAttendanceStatus || 'absent'
    }
    function buildCurrentSnapshot(overrides: Partial<ReportDraftSnapshot> = {}): ReportDraftSnapshot {
        const managedReason = canonicalSystemManagedReason()
        const snapshotAttendanceStatus = managedReason ? canonicalSystemManagedStatus() : attendanceStatus.value
        const normalizedReason = snapshotAttendanceStatus === 'absent'
            ? (managedReason || normalizeAbsenceReasonCode(absenceReason.value) || 'reason_not_provided')
            : null

        return {
            lessonId: selectedLessonId.value || '',
            isCompleted: isCompleted.value,
            progressLetter: progressLetter.value || '',
            attendanceStatus: snapshotAttendanceStatus,
            absenceReason: normalizedReason,
            classParticipation: classParticipation.value,
            classroomBehavior: classroomBehavior.value,
            contactNotes: contactNotes.value || '',
            contactNotesDocument: contactNotesDocument.value,
            classNotes: classNotes.value || '',
            classNotesDocument: classNotesDocument.value,
            content: localContent.value || '',
            contentDocument: contentDocument.value,
            externalLink: safeExternalHref(reportExternalLink.value) || '',
            ...overrides
        }
    }

    function buildDirtyPayload(current: ReportDraftSnapshot) {
        // System-managed attendance is authoritative in the database. Never turn
        // stale collaboration metadata or a translated fallback reason into a
        // mutation, and let other editable fields continue to save normally.
        return buildDirtyReportPayload(current, savedReportSnapshot.value, { includeAttendance: !isSystemManagedAbsence.value })
    }

    const savedReportSnapshot = ref<ReportDraftSnapshot>(buildSnapshotFromProps(props))


    // Computed progress letter for backend (combining start-end range)
    const progressLetter = computed(() => {
        if (progressStart.value && progressEnd.value) {
            return `${progressStart.value}-${progressEnd.value}`
        } else if (progressStart.value) {
            return progressStart.value
        } else if (progressEnd.value) {
            return progressEnd.value
        }
        return ''
    })

    // Check if absence reason is system-managed (holiday or suspension)
    const isSystemManagedAbsence = computed(() => {
        return canonicalSystemManagedReason() !== null
    })

    const getSystemManagedAbsenceLabel = () => {
        const reason = canonicalSystemManagedReason()
        if (reason === 'holiday') {
            return `${t('report.editor.absence_reasons.holiday')} (${t('common.system_managed')})`
        } else if (reason === 'suspension') {
            return `${t('report.editor.absence_reasons.suspension')} (${t('common.system_managed')})`
        }
        return absenceReason.value
    }

    // Validation
    const showAbsenceError = computed(() => {
        return attendanceStatus.value === 'absent' && !absenceReason.value && !isSystemManagedAbsence.value
    })

    const canSave = computed(() => {
        // Auto-set handles missing reason, so we allow saving
        return true
    })
    function snapshotToLocalReport(snapshot: ReportDraftSnapshot, reportVersion = version.value): OccurrenceReportDTO {
        return {
            id: props.reportId,
            enrollment_id: props.enrollmentId || '',
            class_occurrence_id: props.classOccurrenceId || '',
            lesson_id: snapshot.lessonId,
            content: snapshot.content,
            content_document: snapshot.contentDocument,
            is_completed: snapshot.isCompleted,
            progress_letter: snapshot.progressLetter,
            attendance_status: snapshot.attendanceStatus,
            absence_reason: snapshot.absenceReason || '',
            class_participation: snapshot.classParticipation,
            classroom_behavior: snapshot.classroomBehavior,
            contact_notes: snapshot.contactNotes,
            contact_notes_document: snapshot.contactNotesDocument,
            class_notes: snapshot.classNotes,
            class_notes_document: snapshot.classNotesDocument,
            external_link: snapshot.externalLink,
            version: reportVersion,
            last_edited_at: new Date().toISOString(),
            last_edited_by: authStore.user?.id,
            created_at: props.initialCreatedAt,
            updated_at: new Date().toISOString()
        }
    }

    // Auto-save setup
    const {
        status: autoSaveStatus,
        isSaving,
        lastSaved,
        hasUnsavedChanges,
        saveError,
        saveNow: autoSaveNow,
        triggerAutoSave,
        setEnabled: setAutoSaveEnabled,
        configure: configureAutoSave,
        retry: retrySave,
        drain,
        getLastSavedString,
        reset,
        errorKind: saveErrorKind,
        isOnline
    } = useAutoSave<ReportDraftSnapshot, SaveReportResult>({
        enabled: effectiveAutoSaveEnabled,
        debounceMs: computed(() => props.debounceMs ?? preferences.editorSettings.autoSave.debounceMs),
        saveOnBlur: computed(() => preferences.editorSettings.autoSave.saveOnBlur),
        saveOnSwitch: computed(() => preferences.editorSettings.autoSave.saveOnSwitch),
        saveOnUnmount: computed(() => preferences.editorSettings.autoSave.saveOnUnmount),
        onSave: async (snapshot) => {
            editorNotifier.notify({ code: 'save-started', level: 'info', message: t('report.saving'), toast: false })
            if (!props.reportId) {
                return { success: false, message: 'No report ID provided', messageKey: 'report.no_report_selected' }
            }

            if (!canSave.value) {
                return { success: false, message: t('report.editor.required_field_error') }
            }

            try {
                const { keys, payload } = buildDirtyPayload(snapshot)
                const isAttendanceOnly = keys.length > 0 && keys.every(key => key === 'attendanceStatus' || key === 'absenceReason')

                if (keys.length === 0) {
                    return { success: true, newVersion: version.value }
                }

                const baseSnapshot = savedReportSnapshot.value
                const result = isAttendanceOnly
                    ? await OccurrenceReportService.saveAttendanceOnly(
                        props.reportId,
                        version.value,
                        authStore.user?.id,
                        {
                            attendanceStatus: snapshot.attendanceStatus,
                            absenceReason: snapshot.absenceReason
                        }
                    )
                    : await OccurrenceReportService.saveReport(
                        props.reportId,
                        version.value,
                        authStore.user?.id,
                        payload
                    )

                // A CAS conflict is expected when another teacher saves first. If
                // only text changed, Yjs already contains the merged document; if
                // metadata changed on both sides, return field-level conflicts.
                if (result.conflict && result.serverReport) {
                    const merge = mergeReportConflict(
                        baseSnapshot,
                        snapshot,
                        result.serverReport,
                        collaborationStatus.value === 'ready'
                    )
                    if (merge.conflictFields.length > 0) {
                        return { ...result, serverVersion: result.serverReport.version, conflictFields: merge.conflictFields }
                    }
                    if (merge.changed && result.serverReport.version > version.value) {
                        const mergedResult = await OccurrenceReportService.saveReport(
                            props.reportId,
                            result.serverReport.version,
                            authStore.user?.id,
                            merge.payload as any
                        )
                        if (mergedResult.success) return { ...mergedResult, merged: true }
                        return {
                            ...mergedResult,
                            conflict: mergedResult.conflict || false,
                            serverVersion: mergedResult.serverReport?.version || result.serverReport.version,
                            conflictFields: mergedResult.conflictFields || []
                        }
                    }
                }
                return result
            } catch (error: any) {
                const message = error.message || 'Failed to save report'
                if (isNetworkError(error) || isBrowserOffline()) {
                    return {
                        success: false,
                        message,
                        errorCode: 'network_error',
                        messageKey: isBrowserOffline() ? 'report.editor.save_failed_offline' : 'report.editor.save_failed_network'
                    }
                }
                return { success: false, message, messageKey: 'errors.unknown' }
            }
        },
        onConflict: (serverReport, snapshot) => {
            editorNotifier.notify({ code: 'save-conflict', level: 'warning', message: t('report.conflict.description'), dedupeKey: `${props.reportId || 'new'}:${version.value}:conflict`, toast: true })
            if (serverReport) {
                emit('conflict', serverReport, snapshotToLocalReport(snapshot))
            }
        },
        onSuccess: async ({ snapshot, result }) => {
            const updatedReport = result.updatedReport
            const newVersion = updatedReport?.version ?? result.newVersion ?? version.value
            version.value = newVersion
            remoteVersionDrift.value = false
            const canonicalManagedReason = normalizeSystemManagedReason(updatedReport?.absence_reason)
            if (canonicalManagedReason) {
                managedAttendanceReason.value = canonicalManagedReason
                managedAttendanceStatus.value = updatedReport?.attendance_status || 'absent'
                attendanceStatus.value = managedAttendanceStatus.value
                absenceReason.value = canonicalManagedReason
                if (collabMetaMap) writeReportMeta(collabMetaMap)
            }
            savedReportSnapshot.value = updatedReport ? buildSnapshotFromDto(updatedReport) : snapshot
            setBaseReportVersion(newVersion)

            if (ydoc.value) {
                const metaMap = ydoc.value.getMap('reportMeta')
                const currentMetaVer = metaMap.get('version') as number || 0
                if (newVersion > currentMetaVer) {
                    metaMap.set('version', newVersion)
                }
                void saveSnapshot().catch((error) => console.warn('Collaboration snapshot deferred after canonical save', error))
            }

            if (updatedReport) {
                emit('save-success', updatedReport)
            }
            networkFailureNotified = false
            saveErrorMessage.value = ''
            editorNotifier.notify({ code: 'save-succeeded', level: 'success', message: t('report.save_success'), toast: false })
        },
        onError: (message, result, context?: AutoSaveErrorContext) => {
            emit('save-error', message)
            const errorCode = result?.errorCode
            const networkFailure = errorCode === 'network_error' || (!result && (isNetworkError(message) || isBrowserOffline()))
            const messageKey = result?.messageKey
                || (networkFailure ? (isBrowserOffline() ? 'report.editor.save_failed_offline' : 'report.editor.save_failed_network')
                    : errorCode === 'request_timeout' ? 'errors.request_timeout'
                    : errorCode === 'save_outcome_unknown' ? 'errors.save_outcome_unknown'
                        : errorCode === 'permission_denied' ? 'errors.permission_denied'
                    : errorCode === 'validation_error' ? 'errors.validation_failed'
                                : errorCode === 'system_managed' ? 'report.editor.system_managed_absence_notice'
                                : errorCode === 'conflict' ? 'errors.conflict'
                                    : 'errors.unknown')
            const translated = t(messageKey)
            saveErrorMessage.value = translated
            // Network failures retry on their own every few seconds; an error
            // toast (which never auto-dismisses) per attempt would pile up, so
            // only the first failure of a streak raises one.
            const retrying = networkFailure || errorCode === 'request_timeout' || errorCode === 'save_outcome_unknown'
            const showToast = !(retrying && networkFailureNotified)
            if (retrying) networkFailureNotified = true
            console.error('Report editor save failed:', {
                reportId: props.reportId,
                revision: context?.revision,
                errorCode,
                message,
                result
            })
            editorNotifier.notify({
                code: 'save-failed',
                level: 'error',
                message: translated,
                dedupeKey: `${props.reportId || 'new'}:${context?.revision ?? 'unknown'}:${errorCode || messageKey}`,
                context: { reportId: props.reportId, revision: context?.revision, errorCode: errorCode || messageKey },
                toast: showToast
            })
        }

    })

    // Computed
    const reportMetrics = computed(() => {
        const content = calculateTextEditorMetrics(localContent.value)
        const contact = calculateTextEditorMetrics(contactNotes.value)
        const classMetric = calculateTextEditorMetrics(classNotes.value)
        const total = Object.fromEntries(Object.keys(content).map(key => [key,
            content[key as keyof TextEditorMetrics] + contact[key as keyof TextEditorMetrics] + classMetric[key as keyof TextEditorMetrics]
        ])) as unknown as TextEditorMetrics
        return { content, contactNotes: contact, classNotes: classMetric, total }
    })
    const wordCount = computed(() => reportMetrics.value.content.wordCount)
    const characterCount = computed(() => reportMetrics.value.content.characterCount)
    watch(reportMetrics, metrics => emit('metrics-change', metrics), { immediate: true })

    // Watchers to sync props to local state (important for Master-Detail views where component is reused)
    watch(() => props.initialContent, (newContent) => {
        if (newContent !== localContent.value && !hasUnsavedChanges.value) {
            const content = createTextEditorContent(props.initialContentDocument || newContent)
            localContent.value = content.plainText
            contentDocument.value = content.richText
        }
    })

    watch(() => props.initialVersion, (newVersion) => {
        version.value = newVersion
        remoteVersionDrift.value = false
        setBaseReportVersion(newVersion)
    })

    watch(() => props.initialLessonId, (newVal) => {
        if (!hasUnsavedChanges.value) selectedLessonId.value = newVal || ''
    })

    watch(() => props.initialIsCompleted, (newVal) => {
        if (!hasUnsavedChanges.value) isCompleted.value = newVal ?? false
    })

    watch(() => props.initialProgressStart, (newVal) => {
        if (!hasUnsavedChanges.value) progressStart.value = newVal || ''
    })

    watch(() => props.initialProgressEnd, (newVal) => {
        if (!hasUnsavedChanges.value) progressEnd.value = newVal || ''
    })

    watch(() => props.initialAttendanceStatus, (newVal) => {
        if (normalizeSystemManagedReason(props.initialAbsenceReason)) {
            managedAttendanceStatus.value = newVal || 'absent'
            attendanceStatus.value = newVal || 'absent'
            return
        }
        if (!hasUnsavedChanges.value) attendanceStatus.value = newVal
    })

    watch(() => props.initialAbsenceReason, (newVal) => {
        const managedReason = normalizeSystemManagedReason(newVal)
        if (managedReason) {
            managedAttendanceReason.value = managedReason
            managedAttendanceStatus.value = props.initialAttendanceStatus || 'absent'
            attendanceStatus.value = props.initialAttendanceStatus || 'absent'
            absenceReason.value = managedReason
            if (collabMetaMap) writeReportMeta(collabMetaMap)
            return
        }
        managedAttendanceReason.value = null
        managedAttendanceStatus.value = null
        if (!hasUnsavedChanges.value) absenceReason.value = normalizeAbsenceReasonCode(newVal)
    })

    watch(() => props.initialClassParticipation, (newVal) => {
        if (!hasUnsavedChanges.value) classParticipation.value = normalizeReportRating(newVal)
    })

    watch(() => props.initialClassroomBehavior, (newVal) => {
        if (!hasUnsavedChanges.value) classroomBehavior.value = normalizeReportRating(newVal)
    })

    watch(() => props.initialContactNotes, (newVal) => {
        if (!hasUnsavedChanges.value) {
            const content = createTextEditorContent(props.initialContactNotesDocument || newVal || '')
            contactNotes.value = content.plainText
            contactNotesDocument.value = content.richText
        }
    })

    watch(() => props.initialClassNotes, (newVal) => {
        if (!hasUnsavedChanges.value) {
            const content = createTextEditorContent(props.initialClassNotesDocument || newVal || '')
            classNotes.value = content.plainText
            classNotesDocument.value = content.richText
        }
    })

    watch(() => props.initialReportExternalLink, (newVal) => {
        if (!hasUnsavedChanges.value) reportExternalLink.value = safeExternalHref(newVal) || ''
    })

    watch(attendanceStatus, (newStatus) => {
        if (newStatus !== 'absent' && absenceReason.value) {
            absenceReason.value = ''
        }
    })

    // Note: Progress values are now retained even when isCompleted is toggled
    /*
    watch(isCompleted, (newValue) => {
        if (newValue) {
            progressStart.value = ''
            progressEnd.value = ''
        }
    })
    */

    // Watch for changes that should trigger auto-save
    watch([
        selectedLessonId,
        isCompleted,
        progressStart,
        progressEnd,
        attendanceStatus,
        absenceReason,
        classParticipation,
        classroomBehavior,
        contactNotes,
        classNotes,
        reportExternalLink
    ], () => {
        // If collaboration is active, Yjs observers and setupMapSync handle the local input saves.
        // We only use this watcher when collaboration is NOT ready/active.
        if (ready.value && ydoc.value) {
            return
        }
        handleInput()
    })

    const isInitializing = ref(false)

    // Reset auto-save state when switching reports
    watch(() => props.reportId, () => {
        collabMetaHydratedReportId = null
        isInitializing.value = true
        managedAttendanceReason.value = normalizeSystemManagedReason(props.initialAbsenceReason)
        managedAttendanceStatus.value = managedAttendanceReason.value
            ? (props.initialAttendanceStatus || 'absent')
            : null
        savedReportSnapshot.value = buildSnapshotFromProps(props)
        reset()
        // 給予極短時間讓 props 傳遞到 local state
        setTimeout(() => {
            isInitializing.value = false
        }, 50)
    }, { immediate: true })

    // Stay in initializing state while parent is loading
    watch(() => props.loading, (newLoading) => {
        if (newLoading) {
            isInitializing.value = true
        } else {
            // 當載入完成後，給予極短時間穩定狀態
            setTimeout(() => {
                isInitializing.value = false
            }, 50)
        }
    })

    // Device-local draft: unsaved edits survive a lost connection, a closed tab or
    // a crash. It is deleted as soon as the server has the same content.
    const localDraft = useReportLocalDraft({ userId: () => authStore.user?.id })
    const saveErrorMessage = ref('')
    let networkFailureNotified = false
    type PendingDraftRecovery = { reportId: string; draft: LocalReportDraft; action: Extract<DraftRecoveryAction, 'restore' | 'merge'> }
    const pendingDraftRecovery = ref<PendingDraftRecovery | null>(null)
    const draftRecoveryTime = computed(() => pendingDraftRecovery.value
        ? DateUtils.displayDateTime(new Date(pendingDraftRecovery.value.draft.updatedAt))
        : '')

    const saveProblemStatus = computed<{ text: string; className: string } | null>(() => {
        if (!props.reportId) return null
        if (!isOnline.value && hasUnsavedChanges.value) {
            return {
                text: t(localDraft.persisted.value ? 'report.editor.offline_saved_locally' : 'report.editor.offline_unsaved'),
                className: 'text-amber-600'
            }
        }
        if (saveError.value && saveErrorKind.value === 'network') return { text: t('report.editor.save_failed_retrying'), className: 'text-amber-600' }
        if (saveError.value) return { text: t('report.editor.save_failed'), className: 'text-red-600' }
        return null
    })

    function persistLocalDraft(snapshot: ReportDraftSnapshot) {
        if (!props.reportId) return
        localDraft.schedule(props.reportId, {
            baseVersion: version.value ?? 0,
            baseSnapshot: savedReportSnapshot.value,
            snapshot
        })
    }

    watch(autoSaveStatus, (status) => {
        if (status === 'saved') void localDraft.discard(props.reportId)
    })

    function waitForCollaborationToSettle(timeoutMs = 3000): Promise<void> {
        if (!effectiveCollaborationEnabled.value || ready.value || isBrowserOffline()) return Promise.resolve()
        return new Promise((resolve) => {
            const timer = setTimeout(done, timeoutMs)
            const stop = watch(ready, (isReady) => { if (isReady) done() })
            function done() {
                clearTimeout(timer)
                stop()
                // Let the collab seeding and recovered-draft queueing settle first.
                setTimeout(resolve, 300)
            }
        })
    }

    let draftCheckedReportId: string | null = null
    async function checkLocalDraft() {
        const reportId = props.reportId
        if (!reportId || props.loading || isInitializing.value || draftCheckedReportId === reportId) return
        draftCheckedReportId = reportId
        pendingDraftRecovery.value = null
        const draft = await localDraft.load(reportId)
        if (!draft || props.reportId !== reportId || reportEditorUnmounted) return
        await waitForCollaborationToSettle()
        if (props.reportId !== reportId || reportEditorUnmounted) return
        syncTextRefsFromEditors()
        const action = classifyDraftRecovery(
            draft,
            { version: version.value ?? 0, snapshot: savedReportSnapshot.value },
            buildCurrentSnapshot()
        )
        if (action === 'discard') {
            void localDraft.discard(reportId)
            return
        }
        if (action === 'none') return
        pendingDraftRecovery.value = { reportId, draft, action }
    }

    watch([() => props.reportId, () => props.loading, () => isInitializing.value], ([reportId]) => {
        if (reportId !== draftCheckedReportId) pendingDraftRecovery.value = null
        if (draftCheckedReportId && reportId !== draftCheckedReportId) draftCheckedReportId = null
        void checkLocalDraft()
    }, { immediate: true })

    function applyDraftSnapshot(snapshot: ReportDraftSnapshot) {
        const [start = '', end = ''] = (snapshot.progressLetter || '').split('-')
        selectedLessonId.value = snapshot.lessonId || ''
        isCompleted.value = snapshot.isCompleted
        progressStart.value = start
        progressEnd.value = end
        if (!canonicalSystemManagedReason()) {
            attendanceStatus.value = snapshot.attendanceStatus
            absenceReason.value = normalizeAbsenceReasonCode(snapshot.absenceReason)
        }
        classParticipation.value = snapshot.classParticipation
        classroomBehavior.value = snapshot.classroomBehavior
        reportExternalLink.value = safeExternalHref(snapshot.externalLink) || ''

        const main = createTextEditorContent(snapshot.contentDocument || snapshot.content || '')
        const contact = createTextEditorContent(snapshot.contactNotesDocument || snapshot.contactNotes || '')
        const classNotesContent = createTextEditorContent(snapshot.classNotesDocument || snapshot.classNotes || '')
        localContent.value = main.plainText
        contentDocument.value = main.richText
        contactNotes.value = contact.plainText
        contactNotesDocument.value = contact.richText
        classNotes.value = classNotesContent.plainText
        classNotesDocument.value = classNotesContent.richText
        setEditorContentSilently(contentEditorRef, main)
        setEditorContentSilently(contactNotesEditorRef, contact)
        setEditorContentSilently(classNotesEditorRef, classNotesContent)
    }

    function restoreLocalDraft() {
        const recovery = pendingDraftRecovery.value
        if (!recovery || recovery.reportId !== props.reportId) return
        pendingDraftRecovery.value = null
        const { draft } = recovery

        if (recovery.action === 'restore') {
            applyDraftSnapshot(draft.snapshot)
            handleInput()
            editorNotifier.notify({ code: 'draft-recovered', level: 'success', message: t('report.editor.draft_recovery.restored'), toast: true })
            return
        }

        // Someone saved the report after this draft was written: three-way merge
        // against the draft's own base, and let the user settle real conflicts in
        // the same ConflictModal used for save conflicts.
        const serverSnapshot = savedReportSnapshot.value
        const serverReport: OccurrenceReportDTO = {
            ...snapshotToLocalReport(serverSnapshot, version.value),
            last_edited_by: undefined,
            last_edited_at: undefined
        }
        const merge = mergeReportConflict(draft.baseSnapshot, draft.snapshot, serverReport, false)
        const merged = mergeDraftOntoServer(draft, serverSnapshot)
        if (merge.conflictFields.length === 0) {
            applyDraftSnapshot(merged)
            handleInput()
            editorNotifier.notify({ code: 'draft-recovered', level: 'success', message: t('report.editor.draft_recovery.merged'), toast: true })
            return
        }
        emit('conflict', serverReport, snapshotToLocalReport(merged, draft.baseVersion))
    }

    function discardLocalDraft() {
        const recovery = pendingDraftRecovery.value
        pendingDraftRecovery.value = null
        if (recovery) void localDraft.discard(recovery.reportId)
    }

    function handleInput() {
        if (isInitializing.value || isApplyingRemoteCollab) {
            // 如果正在初始化（從 props 同步中），我們不觸發自動儲存
            // 這樣可以避免載入報告時立即觸發儲存任務
            return
        }

        emit('update:content', localContent.value)
        emit('update:report-external-link', reportExternalLink.value)

        if (props.reportId) {
            const snapshot = buildCurrentSnapshot()
            triggerAutoSave(snapshot)
            persistLocalDraft(snapshot)
        }
    }

    function handleTextEditorChange(
        field: 'content' | 'contactNotes' | 'classNotes',
        change: TextEditorChange
    ) {
        if (field === 'content') {
            localContent.value = change.content.plainText
            contentDocument.value = change.content.richText
        }
        if (field === 'contactNotes') {
            contactNotes.value = change.content.plainText
            contactNotesDocument.value = change.content.richText
        }
        if (field === 'classNotes') {
            classNotes.value = change.content.plainText
            classNotesDocument.value = change.content.richText
        }

        if (change.source === 'remote') {
            // The shared Y.Doc already merged this edit for us -- it did not
            // originate from this editor instance. Mirror it into local state and
            // upward via the content emits so any display that reads them stays
            // current, but do NOT enqueue an autosave: every connected peer's
            // editor observes the same fragment change, so letting each of them
            // independently re-save the merge would multiply writes for one edit
            // and race every peer's optimistic-concurrency check against the
            // others for no reason -- only the peer who actually typed it should
            // persist it.
            emit('update:content', localContent.value)
            emit('update:report-external-link', reportExternalLink.value)
            return
        }

        handleInput()
    }

    function queueRecoveredDraftWhenReady(attempt = 0) {
        if (isInitializing.value) {
            if (attempt < 10) {
                setTimeout(() => queueRecoveredDraftWhenReady(attempt + 1), 25)
            }
            return
        }

        syncTextRefsFromEditors()
        const recoveredSnapshot = buildCurrentSnapshot()
        if (buildDirtyPayload(recoveredSnapshot).keys.length > 0) {
            emit('update:content', recoveredSnapshot.content)
            triggerAutoSave(recoveredSnapshot)
            persistLocalDraft(recoveredSnapshot)
        }
    }

    function saveNow(_options?: { reason?: 'manual' | 'switch' }): Promise<boolean> {
        if (!props.reportId || !canSave.value) {
            return Promise.resolve(true)
        }

        if (!hasUnsavedChanges.value) {
            return Promise.resolve(true)
        }

        syncTextRefsFromEditors()
        return autoSaveNow(buildCurrentSnapshot())
    }

    function replaceWithCanonicalReport(report: OccurrenceReportDTO, notifyParent = false) {
        version.value = report.version
        remoteVersionDrift.value = false
        const main = createTextEditorContent(report.content_document || report.content || '')
        const contact = createTextEditorContent(report.contact_notes_document || report.contact_notes || '')
        const classNotesContent = createTextEditorContent(report.class_notes_document || report.class_notes || '')
        localContent.value = main.plainText
        contentDocument.value = main.richText
        selectedLessonId.value = report.lesson_id || ''
        isCompleted.value = report.is_completed ?? false
        progressStart.value = report.progress_letter ? report.progress_letter.split('-')[0] : ''
        progressEnd.value = report.progress_letter && report.progress_letter.includes('-') ? report.progress_letter.split('-')[1] : ''
        attendanceStatus.value = report.attendance_status as any
        absenceReason.value = normalizeAbsenceReasonCode(report.absence_reason)
        classParticipation.value = normalizeReportRating(report.class_participation)
        classroomBehavior.value = normalizeReportRating(report.classroom_behavior)
        contactNotes.value = contact.plainText
        contactNotesDocument.value = contact.richText
        classNotes.value = classNotesContent.plainText
        classNotesDocument.value = classNotesContent.richText
        reportExternalLink.value = safeExternalHref(report.external_link) || ''
        savedReportSnapshot.value = buildSnapshotFromDto(report)
        setBaseReportVersion(report.version)

        if (ydoc.value) {
            const metaMap = ydoc.value.getMap('reportMeta')
            withCollabGuard(() => {
                writeReportMeta(metaMap)
                setEditorContentSilently(contentEditorRef, createTextEditorContent(report.content_document || report.content || ''))
                setEditorContentSilently(contactNotesEditorRef, createTextEditorContent(report.contact_notes_document || report.contact_notes || ''))
                setEditorContentSilently(classNotesEditorRef, createTextEditorContent(report.class_notes_document || report.class_notes || ''))
            })
            void saveSnapshot()
        }

        if (notifyParent) {
            emit('restored', report)
        }

        // The server copy is now authoritative (conflict resolved or version
        // restored), so the device-local draft is no longer needed.
        void localDraft.discard(props.reportId)
        pendingDraftRecovery.value = null

        // Clear unsaved changes flag
        reset()
    }

    function handleReportRestored(report: OccurrenceReportDTO) {
        replaceWithCanonicalReport(report, true)
    }

    function getEditorSettings(): EditorUserSettings {
        return structuredClone(preferences.editorSettings)
    }

    function updateEditorSettings(settings: Partial<EditorUserSettings>): EditorUserSettings {
        preferences.editorSettings = normalizeEditorUserSettings({
            ...preferences.editorSettings,
            ...settings,
            appearance: { ...preferences.editorSettings.appearance, ...settings.appearance },
            autoSave: { ...preferences.editorSettings.autoSave, ...settings.autoSave },
            collaboration: { ...preferences.editorSettings.collaboration, ...settings.collaboration }
        })
        return getEditorSettings()
    }

    function resetEditorSettings(): EditorUserSettings {
        preferences.editorSettings = normalizeEditorUserSettings(DEFAULT_EDITOR_USER_SETTINGS)
        return getEditorSettings()
    }

    // Best-effort flush when the tab is closed, refreshed, or backgrounded. Vue's
    // onBeforeUnmount never fires for these (the page can be torn down mid-async-
    // work, or not unmount the component at all if it's merely backgrounded), so
    // up to a full debounce interval of typing -- and any pending Yjs snapshot --
    // would otherwise be silently lost. visibilitychange also covers mobile
    // Safari, which does not reliably fire pagehide/beforeunload.
    function flushOnPageHide() {
        if (hasUnsavedChanges.value) {
            void localDraft.flush()
            void saveNow()
        }
        void saveSnapshot()
    }

    // The browser's own "leave site?" prompt while edits are not on the server.
    function warnBeforeUnload(event: BeforeUnloadEvent) {
        if (!hasUnsavedChanges.value && !isSaving.value) return
        void localDraft.flush()
        event.preventDefault()
        event.returnValue = ''
    }

    // In-app navigation: try to save first, then ask before leaving unsaved work.
    // Only registered when the editor sits inside a <router-view>.
    if (inject(routerViewLocationKey, null)) {
        onBeforeRouteLeave(async () => {
            if (!hasUnsavedChanges.value) return true
            if (await saveNow()) return true
            await localDraft.flush()
            return window.confirm(t('report.editor.leave_unsaved_confirm'))
        })
    }
    function handleVisibilityChange() {
        if (document.visibilityState === 'hidden') flushOnPageHide()
    }

    onMounted(() => {
        window.addEventListener('pagehide', flushOnPageHide)
        window.addEventListener('beforeunload', warnBeforeUnload)
        document.addEventListener('visibilitychange', handleVisibilityChange)
    })

    onBeforeUnmount(async () => {
        reportEditorUnmounted = true
        collabEditorGeneration++
        window.removeEventListener('pagehide', flushOnPageHide)
        window.removeEventListener('beforeunload', warnBeforeUnload)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        cleanupReportCollabBindings()
        if (preferences.editorSettings.autoSave.saveOnUnmount) await saveNow()
    })

    /**
     * Puts a rendered report template into the report. With collaboration the
     * text is inserted at each editor's cursor; otherwise only empty fields
     * are filled.
     */
    function insertRenderedTemplate(rendered: RenderedReportTemplate) {
        const { content: renderedContent, contactNotes: renderedContactNotes, classNotes: renderedClassNotes } = rendered
        let changed = false

        if (ydoc.value) {
            if (renderedContent.plainText && isTextEditorHandle(contentEditorRef.value)) {
                if (contentEditorRef.value.getText()) contentEditorRef.value.insertText('\n\n')
                contentEditorRef.value.insertContent(renderedContent)
            }
            if (renderedContactNotes.plainText && isTextEditorHandle(contactNotesEditorRef.value)) {
                if (contactNotesEditorRef.value.getText()) contactNotesEditorRef.value.insertText('\n\n')
                contactNotesEditorRef.value.insertContent(renderedContactNotes)
            }
            if (renderedClassNotes.plainText && isTextEditorHandle(classNotesEditorRef.value)) {
                if (classNotesEditorRef.value.getText()) classNotesEditorRef.value.insertText('\n\n')
                classNotesEditorRef.value.insertContent(renderedClassNotes)
            }
            changed = true
        } else {
            if (!localContent.value.trim() && renderedContent.plainText) {
                localContent.value = renderedContent.plainText
                contentDocument.value = renderedContent.richText
                changed = true
            }

            if (!contactNotes.value.trim() && renderedContactNotes.plainText) {
                contactNotes.value = renderedContactNotes.plainText
                contactNotesDocument.value = renderedContactNotes.richText
                changed = true
            }

            if (!classNotes.value.trim() && renderedClassNotes.plainText) {
                classNotes.value = renderedClassNotes.plainText
                classNotesDocument.value = renderedClassNotes.richText
                changed = true
            }
        }

        if (changed) {
            handleInput()
        }
    }

    return {
        preferences,
        effectiveCollaborationEnabled,
        // collaboration
        ydoc,
        awarenessProvider,
        ready,
        collaborationError,
        collaborationStatus,
        activePeers,
        onlineParticipantCount,
        reconnectCollaboration,
        setCollaborationEnabled,
        configureCollaboration,
        collaborationUser,
        collaborationBadge,
        handleEditorFieldFocus,
        handleEditorFieldBlur,
        handleCollaborationActivity,
        // fields
        version,
        remoteVersionDrift,
        localContent,
        contentDocument,
        contactNotes,
        contactNotesDocument,
        classNotes,
        classNotesDocument,
        contentEditorValue,
        contactNotesEditorValue,
        classNotesEditorValue,
        selectedLessonId,
        isCompleted,
        progressStart,
        progressEnd,
        progressLetter,
        attendanceStatus,
        absenceReason,
        classParticipation,
        classroomBehavior,
        reportExternalLink,
        isSystemManagedAbsence,
        getSystemManagedAbsenceLabel,
        showAbsenceError,
        canSave,
        // saving
        autoSaveStatus,
        isSaving,
        lastSaved,
        hasUnsavedChanges,
        saveError,
        saveErrorMessage,
        saveProblemStatus,
        getLastSavedString,
        drain,
        retrySave,
        setAutoSaveEnabled,
        configureAutoSave,
        saveNow,
        buildCurrentSnapshot,
        replaceWithCanonicalReport,
        handleReportRestored,
        handleDeleteReport,
        handleTextEditorChange,
        // metrics
        reportMetrics,
        wordCount,
        characterCount,
        // device-local draft
        pendingDraftRecovery,
        draftRecoveryTime,
        restoreLocalDraft,
        discardLocalDraft,
        // content helpers
        handleCopyContent,
        aiInsertFlash,
        handleAiInsert,
        handleAiReplace,
        flushBeforeAi,
        insertRenderedTemplate,
        // editor settings
        getEditorSettings,
        updateEditorSettings,
        resetEditorSettings,
    }
}
