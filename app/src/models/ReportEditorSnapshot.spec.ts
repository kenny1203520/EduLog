import { describe, expect, it } from 'vitest'
import {
    buildDirtyReportPayload,
    buildSnapshotFromDto,
    buildSnapshotFromProps,
    composeProgressLetter,
    isAttendanceOnlyChange,
    normalizeReportRating,
    normalizeSystemManagedReason,
} from './ReportEditorSnapshot'
import type { OccurrenceReportDTO } from './OccurrenceReport'

describe('report editor snapshot rules', () => {
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
