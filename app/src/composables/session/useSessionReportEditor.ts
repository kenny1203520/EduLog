import { computed, nextTick, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { shouldApplyCommittedReport } from '@/services/report/CommittedReportState'
import { useFeedback } from '@/composables/useFeedback'
import { useAuthStore } from '@/stores/useAuthStore'
import type { Enrollment } from '@/models/Enrollment'
import type { Lesson } from '@/models/Course'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport, type OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { DateUtils } from '@/utils/dateUtils'
import { ReportCommandService } from '@/services/report/ReportCommandService'
import { ReportQueryService } from '@/services/report/ReportQueryService'

export type ReportEditorExpose = {
    saveNow: (options?: { reason?: 'manual' | 'switch' }) => Promise<boolean>
    replaceWithCanonicalReport: (report: OccurrenceReportDTO) => void
}

/** True when a committed save changed anything the roster's progress cards derive from. */
export function reportProgressChanged(previous: OccurrenceReport | null | undefined, saved: OccurrenceReportDTO): boolean {
    return !previous
        || previous.lessonId !== saved.lesson_id
        || previous.isCompleted !== (saved.is_completed ?? false)
        || previous.progressLetter !== saved.progress_letter
        || previous.attendanceStatus !== saved.attendance_status
}

interface SessionReportEditorSource {
    todayOccurrence: Ref<any>
    selectedDateKey: Ref<string | null>
    enrollments: Ref<Enrollment[]>
    rosterEnrollments: Ref<Enrollment[]>
    reportMap: Ref<Map<string, any>>
    /** The mounted editor, for save-before-switch and canonical replacement. */
    quickReportEditorRef: Readonly<Ref<ReportEditorExpose | null>>
    savingMap: Ref<Map<string, boolean>>
    getLessonsForCourse: (courseId: string) => Promise<Lesson[]>
    /** Called after a committed save changed a student's progress. */
    onProgressChanged: (enrollmentId: string, occurrence: ClassOccurrence | null) => void
}

/**
 * The quick report editor beside the class roster: which student is open, the
 * editor's own report snapshot, save/restore handling and conflict resolution.
 */
export function useSessionReportEditor(source: SessionReportEditorSource) {
    const { t } = useI18n()
    const toast = useToast()
    const { reportError } = useFeedback()
    const auth = useAuthStore()
    const { todayOccurrence, selectedDateKey, enrollments, reportMap, savingMap, quickReportEditorRef } = source

    const showSplitView = ref(false)
    const selectedEnrollmentId = ref<string | null>(null)
    const courseLessons = ref<any[]>([])
    const selectedEditorEnrollmentSnapshot = ref<Enrollment | null>(null)
    const selectedEditorReportSnapshot = ref<OccurrenceReport | null>(null)
    const selectedEditorReport = computed(() => selectedEditorReportSnapshot.value)
    const selectedEditorEnrollment = computed(() =>
        source.rosterEnrollments.value.find(enrollment => enrollment.id === selectedEnrollmentId.value)
        || selectedEditorEnrollmentSnapshot.value
    )
    let editorSelectionRequest = 0

    // Conflict Resolution State
    const showConflictModal = ref(false)
    const conflictServerVersion = ref(0)
    const conflictLocalVersion = ref(0)
    const conflictReportId = ref<string | null>(null)
    const conflictServerReport = ref<OccurrenceReportDTO | null>(null)
    const conflictLocalReport = ref<OccurrenceReportDTO | null>(null)

    /** Forgets the open student without saving; callers save first. */
    function resetEditorSelection() {
        showSplitView.value = false
        selectedEnrollmentId.value = null
        selectedEditorEnrollmentSnapshot.value = null
        selectedEditorReportSnapshot.value = null
    }

    function isStaleSelection(selectionRequest: number, occurrenceId: string | undefined, dateKey: string | null): boolean {
        return selectionRequest !== editorSelectionRequest
            || todayOccurrence.value?.id !== occurrenceId
            || selectedDateKey.value !== dateKey
    }

    async function toggleSplitView(enrollmentId: string) {
        if (selectedEnrollmentId.value === enrollmentId && showSplitView.value) {
            await closeSplitView()
            return
        }

        const selectionRequest = ++editorSelectionRequest
        const saveSucceeded = await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
        if (saveSucceeded === false || selectionRequest !== editorSelectionRequest) return

        const occurrenceId = todayOccurrence.value?.id
        const occurrenceDate = todayOccurrence.value?.occurrenceDate
        const dateKey = occurrenceDate ? DateUtils.formatLocalDate(occurrenceDate) : null

        // Resolve course lessons without allowing a slow request to change the
        // editor after the user selected another student or occurrence.
        const enrollment = enrollments.value.find(e => e.id === enrollmentId)
        if (enrollment?.courseId) {
            const lessons = await source.getLessonsForCourse(enrollment.courseId)
            if (isStaleSelection(selectionRequest, occurrenceId, dateKey)) return
            courseLessons.value = lessons
        }

        let editorReport = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
        // Resolve the current persisted version before mounting the editor. Once
        // mounted, background refreshes only replace the card snapshot.
        if (occurrenceId) {
            savingMap.value.set(enrollmentId, true)
            try {
                const fetched = await ReportQueryService.getReport(enrollmentId, occurrenceId)
                if (isStaleSelection(selectionRequest, occurrenceId, dateKey)) return
                if (fetched) {
                    const cardReport = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
                    editorReport = cardReport && cardReport.id === fetched.id && cardReport.version > fetched.version ? cardReport : fetched
                    reportMap.value = new Map(reportMap.value).set(enrollmentId, editorReport)
                }
            } catch (error) {
                console.error('Failed to sync report on quick edit open', error)
            } finally {
                savingMap.value.delete(enrollmentId)
            }
        }

        if (isStaleSelection(selectionRequest, occurrenceId, dateKey)) return

        selectedEnrollmentId.value = enrollmentId
        selectedEditorEnrollmentSnapshot.value = enrollment || null
        selectedEditorReportSnapshot.value = editorReport ? new OccurrenceReport(editorReport.toDTO()) : null
        showSplitView.value = true
    }

    async function closeSplitView() {
        const enrollmentIdToRestore = selectedEnrollmentId.value
        editorSelectionRequest++
        const saveSucceeded = await quickReportEditorRef.value?.saveNow({ reason: 'switch' })
        if (saveSucceeded === false) return
        resetEditorSelection()

        await nextTick()
        if (enrollmentIdToRestore) scrollToEnrollment(enrollmentIdToRestore)
    }

    function scrollToEnrollment(enrollmentId: string) {
        requestAnimationFrame(() => {
            const selector = `[data-enrollment-id="${enrollmentId}"]`
            const targets = Array.from(document.querySelectorAll<HTMLElement>(selector))
            const target = targets.find(el => el.offsetParent !== null) || targets[0]
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
    }

    function handleEditorUpdate(content: string, enrollmentId: string) {
        const report = selectedEnrollmentId.value === enrollmentId ? selectedEditorReportSnapshot.value : null
        if (report) {
            report.content = content
        }
    }

    function handleReportExternalLinkUpdate(link: string, enrollmentId: string) {
        const report = selectedEnrollmentId.value === enrollmentId ? selectedEditorReportSnapshot.value : null
        if (report) {
            report.externalLink = link
        }
    }

    function handleSaveSuccess(updatedReport: OccurrenceReportDTO, enrollmentId: string) {
        const report = reportMap.value.get(enrollmentId) as OccurrenceReport | null | undefined
        const occurrenceId = todayOccurrence.value?.id
        if (!occurrenceId || !enrollments.value.some(enrollment => enrollment.id === enrollmentId)) return
        const incomingReport = new OccurrenceReport(updatedReport)
        if (!shouldApplyCommittedReport(incomingReport, report, enrollmentId, occurrenceId)) return
        const progressChanged = reportProgressChanged(report, updatedReport)

        // Cards intentionally show committed data only. Keep the editor's own
        // draft snapshot independent so this replacement cannot reset its fields.
        reportMap.value = new Map(reportMap.value).set(enrollmentId, incomingReport)
        if (progressChanged) source.onProgressChanged(enrollmentId, todayOccurrence.value)
    }

    function handleReportRestored(restoredReport: OccurrenceReportDTO) {
        if (selectedEnrollmentId.value) {
            const restored = new OccurrenceReport(restoredReport)
            reportMap.value = new Map(reportMap.value).set(selectedEnrollmentId.value, restored)
            selectedEditorReportSnapshot.value = new OccurrenceReport(restoredReport)
        }
    }

    function handleSaveError(error: string) {
        console.error('Report editor save failed:', error)
    }

    function handleConflict(serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO) {
        conflictReportId.value = serverReport.id || null
        conflictServerVersion.value = serverReport.version
        conflictLocalVersion.value = localReport.version
        conflictServerReport.value = serverReport
        conflictLocalReport.value = localReport
        showConflictModal.value = true
    }

    function closeConflictModal() {
        showConflictModal.value = false
        conflictReportId.value = null
    }

    async function resolveConflict(resolvedReport: OccurrenceReportDTO) {
        if (!conflictReportId.value) return

        try {
            const report = await ReportCommandService.resolveConflict(
                conflictReportId.value,
                resolvedReport,
                auth.user?.id,
                conflictServerVersion.value
            )

            // Find which enrollment this belongs to
            for (const [enrId, r] of reportMap.value.entries()) {
                if (r.id === report.id) {
                    reportMap.value.set(enrId, report)
                    break
                }
            }

            quickReportEditorRef.value?.replaceWithCanonicalReport(report.toDTO())

            showConflictModal.value = false
            conflictReportId.value = null
            toast.success(t('report.save_success'))
        } catch (error) {
            console.error('Failed to resolve conflict:', error)
            reportError(error, 'report.resolve_conflict_error')
        }
    }

    return {
        showSplitView,
        selectedEnrollmentId,
        courseLessons,
        selectedEditorEnrollmentSnapshot,
        selectedEditorReport,
        selectedEditorEnrollment,
        showConflictModal,
        conflictServerVersion,
        conflictLocalVersion,
        conflictServerReport,
        conflictLocalReport,
        resetEditorSelection,
        toggleSplitView,
        closeSplitView,
        handleEditorUpdate,
        handleReportExternalLinkUpdate,
        handleSaveSuccess,
        handleReportRestored,
        handleSaveError,
        handleConflict,
        closeConflictModal,
        resolveConflict,
    }
}
