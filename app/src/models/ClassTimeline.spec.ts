import { describe, expect, it } from 'vitest'
import { classColorIndex, countJoinFlagsByDate, layoutTimeline, segmentOn, type ClassTimelineData } from './ClassTimeline'

const data: ClassTimelineData = {
    enrollment_id: 'e1',
    segments: [
        { class_session_id: 'a', class_session_name: 'A', classroom_id: null, effective_from: '2027-01-01', effective_to: '2027-01-10' },
        { class_session_id: 'b', class_session_name: 'B', classroom_id: null, effective_from: '2027-01-11', effective_to: null },
    ],
    transfers: [{
        id: 't1', from_class_session_id: 'a', from_class_session_name: 'A', to_class_session_id: 'b', to_class_session_name: 'B',
        effective_date: '2027-01-11', note: null, source: 'transfer', report_changes: [], created_by: null, created_at: '2027-01-05T00:00:00Z'
    }],
    lesson_transfers: [],
    reports: [
        { id: 'r1', occurrence_id: 'o1', occurrence_date: '2027-01-01', class_session_id: 'a', class_session_name: 'A', is_completed: true, is_blank: false, placement: 'regular' },
        { id: 'r2', occurrence_id: 'o2', occurrence_date: '2027-01-20', class_session_id: 'b', class_session_name: 'B', is_completed: false, is_blank: true, placement: 'regular' },
    ],
}

describe('class timeline model', () => {
    it('counts students joining a class per date and ignores make-ups out', () => {
        expect(countJoinFlagsByDate([
            { date: '2027-01-02', enrollment_id: 'e1', student_id: null, student_name: null, flag: 'makeup_in' },
            { date: '2027-01-02', enrollment_id: 'e2', student_id: null, student_name: null, flag: 'transfer_in' },
            { date: '2027-01-02', enrollment_id: 'e3', student_id: null, student_name: null, flag: 'makeup_in' },
            { date: '2027-01-09', enrollment_id: 'e4', student_id: null, student_name: null, flag: 'makeup_out' },
        ])).toEqual({ '2027-01-02': { makeupIn: 2, transferIn: 1 } })
    })

    it('lays segments end to end and runs the open segment to the end of the axis', () => {
        const layout = layoutTimeline(data, '2027-01-30')
        expect(layout.start).toBe('2027-01-01')
        expect(layout.end).toBe('2027-01-30')
        expect(layout.segments[0]!.left).toBe(0)
        expect(layout.segments[0]!.left + layout.segments[0]!.width).toBeCloseTo(layout.segments[1]!.left, 5)
        expect(layout.segments[1]!.left + layout.segments[1]!.width).toBeCloseTo(100, 5)
        expect(layout.reports.map(point => Math.round(point.left))).toEqual([0, 63])
        expect(layout.transfers[0]!.left).toBeCloseTo(layout.segments[1]!.left, 5)
    })

    it('keeps one colour per class in history order', () => {
        expect(classColorIndex('a', ['a', 'b'])).toBe(0)
        expect(classColorIndex('b', ['a', 'b'])).toBe(1)
        expect(classColorIndex('zzz', [])).toBe(classColorIndex('zzz', []))
        const layout = layoutTimeline(data, '2027-01-30')
        expect(layout.segments.map(segment => segment.colorIndex)).toEqual([0, 1])
    })

    it('finds the class on a date', () => {
        expect(segmentOn(data.segments, '2027-01-10')?.class_session_id).toBe('a')
        expect(segmentOn(data.segments, '2027-01-11')?.class_session_id).toBe('b')
        expect(segmentOn(data.segments, '2026-12-31')).toBeNull()
    })
})
