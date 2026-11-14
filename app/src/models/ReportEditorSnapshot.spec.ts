import { describe, expect, it } from 'vitest'
import {
    buildDirtyReportPayload,
    buildSnapshotFromDto,
    buildSnapshotFromProps,
    composeProgressLetter,
    createLessonEntryId,
    isAttendanceOnlyChange,
    normalizeReportRating,
    normalizeSystemManagedReason,
} from './ReportEditorSnapshot'
import type { OccurrenceReportDTO } from './OccurrenceReport'

describe('report editor snapshot rules', () => {
    it('creates secure version-4 lesson entry ids', () => {
        const id = createLessonEntryId()
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    it('recognizes only holiday and suspension as system-managed', () => {
        expect(normalizeSystemManagedReason(' Holiday ')).toBe('holiday')
        expect(normalizeSystemManagedReason('suspension')).toBe('suspension')
        expect(normalizeSystemManagedReason('sick_or_injured')).toBeNull()
        expect(normalizeSystemManagedReason(null)).toBeNull()
    })

    it('treats empty and non-positive ratings as unrated', () => {
        expect(normalizeReportRating('4')).toBe(4)
        expect(normalizeReportRating(0)).toBeNull()
        expect(normalizeReportRating('')).toBeNull()
        expect(normalizeReportRating('abc')).toBeNull()
    })

    it('composes progress ranges', () => {
        expect(composeProgressLetter('A', 'C')).toBe('A-C')
        expect(composeProgressLetter('', 'C')).toBe('C')
        expect(composeProgressLetter(undefined, undefined)).toBe('')
    })

    it('builds the saved baseline from props', () => {
        const snapshot = buildSnapshotFromProps({
            initialProgressStart: 'B',
            initialProgressEnd: 'D',
            initialAttendanceStatus: 'absent',
            initialAbsenceReason: 'holiday',
            initialClassParticipation: 0,
            initialContent: 'Hello',
            initialReportExternalLink: 'javascript:alert(1)',
        })
        expect(snapshot).toMatchObject({
            progressLetter: 'B-D',
            attendanceStatus: 'absent',
            absenceReason: 'holiday',
            classParticipation: null,
            content: 'Hello',
            externalLink: '',
        })
    })

    it('builds a snapshot from a saved report, dropping the reason when present', () => {
        const snapshot = buildSnapshotFromDto({
            lesson_id: 'lesson',
            attendance_status: 'present',
            absence_reason: 'sick_or_injured',
            content: 'Done',
            version: 3,
        } as OccurrenceReportDTO)
        expect(snapshot.absenceReason).toBe('')
        expect(snapshot.lessonId).toBe('lesson')
        expect(snapshot.content).toBe('Done')
    })

    it('normalizes a legacy scalar lesson into a stable primary entry', () => {
        const report = {
            enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: true,
            progress_letter: 'B-C', attendance_status: 'present', content: '', version: 1,
        } as OccurrenceReportDTO
        const first = buildSnapshotFromDto(report)
        const second = buildSnapshotFromDto(report)
        expect(first.lessonEntries).toHaveLength(1)
        expect(first.lessonEntries?.[0]).toMatchObject({
            enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: true, progress_letter: 'B-C',
        })
        expect(first.primaryLessonEntryId).toBe(first.lessonEntries?.[0]?.id)
        expect(second.primaryLessonEntryId).toBe(first.primaryLessonEntryId)
    })

    it('saves a complete multi-course entry collection and primary id together', () => {
        const previous = buildSnapshotFromProps({ enrollmentId: 'enrollment-a' })
        const entries = [
            { id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: true, progress_letter: 'B' },
            { id: 'entry-b', enrollment_id: 'enrollment-b', lesson_id: 'lesson-b', is_completed: false, progress_letter: 'C-D' },
        ]
        const current = { ...previous, lessonEntries: entries, primaryLessonEntryId: 'entry-b' }
        const { keys, payload } = buildDirtyReportPayload(current, previous, { includeAttendance: true })
        expect(keys).toContain('lessonEntries')
        expect(keys).toContain('primaryLessonEntryId')
        expect(payload).toMatchObject({ lessonEntries: entries, primaryLessonEntryId: 'entry-b' })
    })

    it('sends the primary entry id with the entries when only a second entry is added', () => {
        const base = buildSnapshotFromProps({ enrollmentId: 'enrollment-a' })
        const first = { id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: true, progress_letter: null }
        const previous = { ...base, lessonEntries: [first], primaryLessonEntryId: 'entry-a' }
        const entries = [first, { id: 'entry-b', enrollment_id: 'enrollment-b', lesson_id: 'lesson-b', is_completed: false, progress_letter: 'C-D' }]
        const { keys, payload } = buildDirtyReportPayload({ ...previous, lessonEntries: entries }, previous, { includeAttendance: true })
        expect(keys).toEqual(['lessonEntries'])
        expect(payload).toEqual({ lessonEntries: entries, primaryLessonEntryId: 'entry-a' })
    })

    it('sends the entries with the primary entry id when only the primary entry changes', () => {
        const base = buildSnapshotFromProps({ enrollmentId: 'enrollment-a' })
        const entries = [
            { id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: true, progress_letter: null },
            { id: 'entry-b', enrollment_id: 'enrollment-b', lesson_id: 'lesson-b', is_completed: false, progress_letter: 'C-D' },
        ]
        const previous = { ...base, lessonEntries: entries, primaryLessonEntryId: 'entry-a' }
        const { keys, payload } = buildDirtyReportPayload({ ...previous, primaryLessonEntryId: 'entry-b' }, previous, { includeAttendance: true })
        expect(keys).toEqual(['primaryLessonEntryId'])
        expect(payload).toEqual({ lessonEntries: entries, primaryLessonEntryId: 'entry-b' })
    })

    it('ignores display-only course and lesson labels when deciding if entries changed', () => {
        const previous = buildSnapshotFromProps({ enrollmentId: 'enrollment-a' })
        const entry = {
            id: 'entry-a', enrollment_id: 'enrollment-a', lesson_id: 'lesson-a', is_completed: false, progress_letter: 'B',
            course_id: 'course-a', course_name: 'Course A', lesson_sequence: 2, lesson_title: 'Lesson Two',
        }
        const baseline = { ...previous, lessonEntries: [entry], primaryLessonEntryId: 'entry-a' }
        const refreshed = {
            ...baseline,
            lessonEntries: [{ ...entry, course_name: 'Updated course label', lesson_title: 'Updated lesson title' }],
        }
        expect(buildDirtyReportPayload(refreshed, baseline, { includeAttendance: true }).keys).toEqual([])
    })

    it('sends only changed fields and plain text with rich-text changes', () => {
        const previous = buildSnapshotFromProps({ initialContent: 'a', initialAttendanceStatus: 'pending' })
        const current = { ...previous, content: 'b', contentDocument: buildSnapshotFromProps({ initialContent: 'b' }).contentDocument, isCompleted: true }
        const { keys, payload } = buildDirtyReportPayload(current, previous, { includeAttendance: true })
        expect(keys).toEqual(['isCompleted', 'content', 'contentDocument'])
        expect(payload).toEqual({ isCompleted: true, content: 'b', contentDocument: current.contentDocument })
    })

    it('leaves attendance out when it is system-managed', () => {
        const previous = buildSnapshotFromProps({ initialAttendanceStatus: 'pending' })
        const current = { ...previous, attendanceStatus: 'absent' as const, absenceReason: 'holiday' }
        expect(buildDirtyReportPayload(current, previous, { includeAttendance: false }).keys).toEqual([])
        const withAttendance = buildDirtyReportPayload(current, previous, { includeAttendance: true })
        expect(isAttendanceOnlyChange(withAttendance.keys)).toBe(true)
        expect(isAttendanceOnlyChange([])).toBe(false)
    })
})
