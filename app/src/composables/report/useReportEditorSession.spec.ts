import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, reactive, ref } from 'vue'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

const reports = vi.hoisted(() => ({ saveReport: vi.fn(), saveAttendanceOnly: vi.fn(), deleteReportAndRevertProgress: vi.fn() }))
const draft = vi.hoisted(() => ({ schedule: vi.fn(), discard: vi.fn(), load: vi.fn(), flush: vi.fn() }))
vi.mock('@/services/report/ReportQueryService', () => ({ ReportQueryService: reports }))
vi.mock('@/services/report/ReportCommandService', () => ({ ReportCommandService: reports }))
vi.mock('@/composables/useReportLocalDraft', async importOriginal => ({
    ...(await importOriginal<typeof import('@/composables/useReportLocalDraft')>()),
    useReportLocalDraft: () => ({ ...draft, persisted: ref(false) }),
}))
// Collaboration stays off: the session must then save through its own watchers.
vi.mock('@/composables/useReportCollab', () => ({
    useReportCollab: () => ({
        ydoc: ref(null), provider: ref(null), ready: ref(false), error: ref(null), initialState: ref('idle'),
        saveSnapshot: vi.fn().mockResolvedValue(undefined), setBaseReportVersion: vi.fn(), reconnect: vi.fn(),
        status: ref('disabled'), activePeers: ref([]), onlineParticipantCount: computed(() => 0),
        setEnabled: vi.fn(), configure: vi.fn(),
    }),
}))
vi.mock('@/stores/usePreferencesStore', () => ({
    usePreferencesStore: () => reactive({
        editorSettings: {
            notificationsEnabled: false,
            autoSave: { enabled: false, debounceMs: 2000, saveOnBlur: false, saveOnSwitch: true, saveOnUnmount: false },
            collaboration: { enabled: false, snapshotDebounceMs: 1000, presenceEnabled: false },
        },
    }),
}))
vi.mock('@/stores/useAuthStore', () => ({ useAuthStore: () => ({ user: { id: 'teacher', display_name: 'T' } }) }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), routerViewLocationKey: Symbol('routerViewLocation') }))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }) }))

import { useReportEditorSession } from './useReportEditorSession'
import type { ResolvedReportEditorProps } from '@/components/report/reportEditorContract'

function makeProps(overrides: Partial<ResolvedReportEditorProps> = {}) {
    return reactive({
        reportId: 'report', initialVersion: 4, loading: false, placeholder: '', disabled: false, showManualSave: true,
        debounceMs: 2000, enrollmentId: 'enrollment', classOccurrenceId: 'occurrence', courseName: '', courseStage: '',
        courseDisplayName: '', initialClassroomName: '', initialSessionName: '', initialSessionTime: '',
        initialStudentName: '', initialStudentId: '', initialLessonId: 'lesson', availableLessons: [],
        initialLessonEntries: [{ id: 'lesson-entry', enrollment_id: 'enrollment', course_id: 'course', lesson_id: 'lesson', is_completed: false, progress_letter: null }],
        initialPrimaryLessonEntryId: 'lesson-entry',
        initialReportExternalLink: '', initialIsCompleted: false, initialAttendanceStatus: 'pending',
        initialClassParticipation: null, initialClassroomBehavior: null, initialContactNotes: '',
        initialContactNotesDocument: null, initialClassNotes: '', initialClassNotesDocument: null,
        initialContent: 'Saved text', initialContentDocument: null, initialEnrollmentExternalLink: '',
        sourceIdentity: null, initialCreatedAt: '', compact: false,
        ...overrides,
    }) as ResolvedReportEditorProps
}

const saved = (overrides: Partial<OccurrenceReportDTO> = {}) => {
    const lessonId = overrides.lesson_id ?? 'lesson'
    return {
        success: true,
        updatedReport: {
            id: 'report', version: 5, lesson_id: lessonId, attendance_status: 'pending', content: 'Saved text', ...overrides,
            lesson_entries: overrides.lesson_entries ?? [{
                id: 'lesson-entry', enrollment_id: 'enrollment', course_id: 'course', lesson_id: lessonId,
                is_completed: overrides.is_completed ?? false, progress_letter: overrides.progress_letter ?? null,
            }],
            primary_lesson_entry_id: overrides.primary_lesson_entry_id ?? 'lesson-entry',
        },
    }
}

describe('report editor session', () => {
    let scope: ReturnType<typeof effectScope>
    const emit = vi.fn()

    beforeEach(() => {
        vi.useFakeTimers()
        vi.resetAllMocks()
        draft.load.mockResolvedValue(null)
        draft.discard.mockResolvedValue(undefined)
        scope = effectScope()
    })
    afterEach(() => {
        scope.stop()
        vi.useRealTimers()
    })

    async function setup(overrides: Partial<ResolvedReportEditorProps> = {}) {
        const session = scope.run(() => useReportEditorSession(makeProps(overrides), emit, {
            editors: { content: ref(null), contactNotes: ref(null), classNotes: ref(null) },
            openConfirm: vi.fn(),
        }))!
        // The editor ignores input for 50ms while it takes its props.
        await vi.advanceTimersByTimeAsync(60)
        return session
    }

    it('saves only the changed fields against the loaded version', async () => {
        reports.saveReport.mockResolvedValue(saved({ is_completed: true }))
        const session = await setup()
        session.isCompleted.value = true
        await nextTick()
        expect(session.hasUnsavedChanges.value).toBe(true)
        expect(draft.schedule).toHaveBeenCalled()

        await expect(session.saveNow()).resolves.toBe(true)
        expect(reports.saveReport).toHaveBeenCalledWith('report', 4, 'teacher', expect.objectContaining({
            isCompleted: true,
            lessonEntries: expect.arrayContaining([expect.objectContaining({ enrollment_id: 'enrollment', lesson_id: 'lesson', is_completed: true })]),
        }))
        expect(session.version.value).toBe(5)
        expect(emit).toHaveBeenCalledWith('save-success', expect.objectContaining({ version: 5 }))
    })

    it('blocks saving an incomplete lesson entry until its course and lesson are selected', async () => {
        const session = await setup({ initialLessonId: undefined, initialLessonEntries: [], initialPrimaryLessonEntryId: null })
        session.lessonEntries.value.push({
            id: 'new-entry', enrollment_id: 'enrollment', lesson_id: null, is_completed: false, progress_letter: null,
        })
        await nextTick()

        expect(session.canSave.value).toBe(false)
        await expect(session.saveNow()).resolves.toBe(false)
        expect(reports.saveReport).not.toHaveBeenCalled()

        session.lessonEntries.value[0] = { ...session.lessonEntries.value[0]!, course_id: 'course', lesson_id: 'lesson' }
        await nextTick()
        expect(session.canSave.value).toBe(true)
    })

    it('saves an attendance-only change through the attendance endpoint', async () => {
        reports.saveAttendanceOnly.mockResolvedValue(saved({ attendance_status: 'absent', absence_reason: 'reason_not_provided' }))
        const session = await setup()
        session.attendanceStatus.value = 'absent'
        await nextTick()
        await session.saveNow()

        expect(reports.saveReport).not.toHaveBeenCalled()
        expect(reports.saveAttendanceOnly).toHaveBeenCalledWith('report', 4, 'teacher', {
            attendanceStatus: 'absent', absenceReason: 'reason_not_provided',
        })
    })

    it('keeps system-managed attendance read-only and out of the save', async () => {
        reports.saveReport.mockResolvedValue(saved({ attendance_status: 'absent', absence_reason: 'holiday', is_completed: true }))
        const session = await setup({ initialAttendanceStatus: 'absent', initialAbsenceReason: 'holiday' })
        expect(session.isSystemManagedAbsence.value).toBe(true)

        session.isCompleted.value = true
        await nextTick()
        await session.saveNow()
        expect(reports.saveReport).toHaveBeenCalledWith('report', 4, 'teacher', expect.objectContaining({
            isCompleted: true,
            lessonEntries: expect.arrayContaining([expect.objectContaining({ enrollment_id: 'enrollment', lesson_id: 'lesson', is_completed: true })]),
        }))
        expect(session.buildCurrentSnapshot().absenceReason).toBe('holiday')
    })

    it('raises a conflict with the local edits when the server has a newer version', async () => {
        const serverReport = { id: 'report', version: 6, lesson_id: 'lesson', is_completed: false, attendance_status: 'pending', content: 'Saved text', progress_letter: 'B' }
        reports.saveReport.mockResolvedValue({ success: false, conflict: true, serverReport })
        const session = await setup()
        session.progressStart.value = 'C'
        await nextTick()
        await session.saveNow()

        expect(emit).toHaveBeenCalledWith('conflict', serverReport, expect.objectContaining({ progress_letter: 'C', version: 4 }))
    })

    it('replaces local fields with a canonical report and drops the local draft', async () => {
        const session = await setup()
        session.isCompleted.value = true
        await nextTick()
        session.replaceWithCanonicalReport({ id: 'report', version: 9, lesson_id: 'other', is_completed: false, attendance_status: 'present', content: 'Restored', progress_letter: 'A-B' } as OccurrenceReportDTO)

        expect(session.version.value).toBe(9)
        expect(session.selectedLessonId.value).toBe('other')
        expect(session.localContent.value).toBe('Restored')
        expect([session.progressStart.value, session.progressEnd.value]).toEqual(['A', 'B'])
        expect(session.hasUnsavedChanges.value).toBe(false)
        expect(draft.discard).toHaveBeenCalledWith('report')
    })
})
