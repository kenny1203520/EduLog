import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import type { ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { LocalDraftStore } from '@/services/report/LocalDraftStore'
import { classifyDraftRecovery, mergeDraftOntoServer, useReportLocalDraft } from './useReportLocalDraft'

function snapshot(overrides: Partial<ReportDraftSnapshot> = {}): ReportDraftSnapshot {
    return {
        lessonId: 'lesson-1', isCompleted: false, progressLetter: '', attendanceStatus: 'present', absenceReason: null,
        classParticipation: null, classroomBehavior: null,
        contactNotes: '', contactNotesDocument: null as any, classNotes: '', classNotesDocument: null as any,
        content: '', contentDocument: null as any, externalLink: '',
        ...overrides
    }
}


describe('classifyDraftRecovery', () => {
    const server = { version: 4, snapshot: snapshot({ content: 'server' }) }

    it('discards a draft the server already has', () => {
        expect(classifyDraftRecovery({ baseVersion: 3, snapshot: snapshot({ content: 'server' }) }, server, snapshot())).toBe('discard')
    })

    it('does nothing when the editor already shows the draft', () => {
        const current = snapshot({ content: 'typed offline' })
        expect(classifyDraftRecovery({ baseVersion: 4, snapshot: current }, server, current)).toBe('none')
    })

    it('offers a restore when the draft was made on the current server version', () => {
        expect(classifyDraftRecovery({ baseVersion: 4, snapshot: snapshot({ content: 'typed offline' }) }, server, server.snapshot)).toBe('restore')
    })

    it('routes to the merge/conflict flow when someone saved since', () => {
        expect(classifyDraftRecovery({ baseVersion: 3, snapshot: snapshot({ content: 'typed offline' }) }, server, server.snapshot)).toBe('merge')
    })

    it('ignores display labels that changed while the saved lesson fields stayed the same', () => {
        const draftSnapshot = snapshot({
            lessonEntries: [{
                id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: false, progress_letter: 'B',
                course_name: 'Course A', lesson_title: 'Lesson A',
            }],
            primaryLessonEntryId: 'entry-a',
        })
        const serverSnapshot = snapshot({
            lessonEntries: [{
                id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: false, progress_letter: 'B',
            }],
            primaryLessonEntryId: 'entry-a',
        })
        expect(classifyDraftRecovery({ baseVersion: 4, snapshot: draftSnapshot }, { version: 4, snapshot: serverSnapshot }, serverSnapshot)).toBe('discard')
    })
})

describe('mergeDraftOntoServer', () => {
    it('keeps server-only changes and applies the draft\'s own edits', () => {
        const base = snapshot({ content: 'base', classNotes: 'base notes' })
        const draft = snapshot({ content: 'base', classNotes: 'my notes' })
        const server = snapshot({ content: 'peer content', classNotes: 'base notes', isCompleted: true })
        expect(mergeDraftOntoServer({ baseSnapshot: base, snapshot: draft }, server)).toMatchObject({
            content: 'peer content',
            classNotes: 'my notes',
            isCompleted: true
        })
    })
})

describe('useReportLocalDraft', () => {
    function setup(userId: string | undefined) {
        const factory = new IDBFactory()
        const store = new LocalDraftStore(() => factory)
        const draft = useReportLocalDraft({ userId: () => userId, store, debounceMs: 30 })
        return { store, draft }
    }

    it('debounces writes and marks the edits as persisted', async () => {
        const { store, draft } = setup('teacher-a')
        const save = vi.spyOn(store, 'save')

        draft.schedule('r1', { baseVersion: 1, baseSnapshot: snapshot(), snapshot: snapshot({ content: 'a' }) })
        draft.schedule('r1', { baseVersion: 1, baseSnapshot: snapshot(), snapshot: snapshot({ content: 'ab' }) })
        expect(save).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(draft.persisted.value).toBe(true))

        expect(save).toHaveBeenCalledTimes(1)
        expect((await draft.load('r1'))?.snapshot.content).toBe('ab')
    })

    it('discard cancels a pending write and deletes the stored draft', async () => {
        const { draft } = setup('teacher-a')
        draft.schedule('r1', { baseVersion: 1, baseSnapshot: snapshot(), snapshot: snapshot({ content: 'a' }) })
        await draft.flush()
        draft.schedule('r1', { baseVersion: 1, baseSnapshot: snapshot(), snapshot: snapshot({ content: 'b' }) })
        await draft.discard('r1')
        await new Promise(resolve => setTimeout(resolve, 60))
        await expect(draft.load('r1')).resolves.toBeNull()
        expect(draft.persisted.value).toBe(false)
    })

    it('does not write without a signed-in user', async () => {
        const { store, draft } = setup(undefined)
        const save = vi.spyOn(store, 'save')
        draft.schedule('r1', { baseVersion: 1, baseSnapshot: snapshot(), snapshot: snapshot({ content: 'a' }) })
        await draft.flush()
        expect(save).not.toHaveBeenCalled()
    })
})
