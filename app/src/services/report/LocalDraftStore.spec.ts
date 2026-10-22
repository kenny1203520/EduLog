import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { DRAFT_MAX_AGE_MS, LocalDraftStore } from './LocalDraftStore'

function snapshot(content: string): ReportDraftSnapshot {
    const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] } as any
    return {
        lessonId: 'lesson-1', isCompleted: false, progressLetter: '', attendanceStatus: 'present', absenceReason: null,
        classParticipation: null, classroomBehavior: null,
        contactNotes: '', contactNotesDocument: document, classNotes: '', classNotesDocument: document,
        content, contentDocument: document, externalLink: ''
    }
}

describe('LocalDraftStore', () => {
    let now: number
    let store: LocalDraftStore

    beforeEach(() => {
        now = Date.UTC(2026, 9, 21)
        const factory = new IDBFactory()
        store = new LocalDraftStore(() => factory, () => now)
    })

    it('writes, reads and deletes a draft keyed by user and report', async () => {
        await expect(store.save('teacher-a', 'report-1', { baseVersion: 3, baseSnapshot: snapshot('base'), snapshot: snapshot('unsaved') })).resolves.toBe(true)

        const draft = await store.get('teacher-a', 'report-1')
        expect(draft).toMatchObject({ key: 'teacher-a:report-1', userId: 'teacher-a', reportId: 'report-1', baseVersion: 3, updatedAt: now })
        expect(draft?.snapshot.content).toBe('unsaved')
        expect(draft?.baseSnapshot.content).toBe('base')

        await store.delete('teacher-a', 'report-1')
        await expect(store.get('teacher-a', 'report-1')).resolves.toBeNull()
    })

    it('never returns another user\'s draft for the same report', async () => {
        await store.save('teacher-a', 'report-1', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('mine') })
        await expect(store.get('teacher-b', 'report-1')).resolves.toBeNull()
    })

    it('stores plain copies of reactive values', async () => {
        const { reactive } = await import('vue')
        const reactiveSnapshot = reactive(snapshot('proxied'))
        await expect(store.save('teacher-a', 'report-1', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: reactiveSnapshot })).resolves.toBe(true)
        expect((await store.get('teacher-a', 'report-1'))?.snapshot.content).toBe('proxied')
    })

    it('purges drafts older than 7 days and ignores expired ones on read', async () => {
        await store.save('teacher-a', 'old', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('old') })
        now += DRAFT_MAX_AGE_MS - 1000
        await store.save('teacher-a', 'recent', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('recent') })
        now += 2000

        await expect(store.get('teacher-a', 'old')).resolves.toBeNull()
        await expect(store.purgeExpired()).resolves.toBeGreaterThanOrEqual(0)
        await expect(store.purgeExpired()).resolves.toBe(0)
        expect((await store.get('teacher-a', 'recent'))?.snapshot.content).toBe('recent')
    })

    it('purgeExpired removes every stale draft', async () => {
        await store.save('teacher-a', 'r1', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('1') })
        await store.save('teacher-b', 'r2', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('2') })
        now += DRAFT_MAX_AGE_MS + 1
        await expect(store.purgeExpired()).resolves.toBe(2)
    })

    it('clearAll wipes every user\'s drafts (logout)', async () => {
        await store.save('teacher-a', 'r1', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('1') })
        await store.save('teacher-b', 'r2', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('2') })
        await store.clearAll()
        await expect(store.get('teacher-a', 'r1')).resolves.toBeNull()
        await expect(store.get('teacher-b', 'r2')).resolves.toBeNull()
    })

    it('degrades to a no-op when IndexedDB is unavailable', async () => {
        const unavailable = new LocalDraftStore(() => undefined)
        await expect(unavailable.isAvailable()).resolves.toBe(false)
        await expect(unavailable.save('teacher-a', 'r1', { baseVersion: 1, baseSnapshot: snapshot(''), snapshot: snapshot('x') })).resolves.toBe(false)
        await expect(unavailable.get('teacher-a', 'r1')).resolves.toBeNull()
    })
})
