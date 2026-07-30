import { describe, expect, it } from 'vitest'
import { countRosterAttendance, getRosterEnrollments } from './RosterFilter'

const enrollments = [
    { id: '1', studentName: 'Amy Lin' },
    { id: '2', studentName: 'Ben Chen' },
    { id: '3', studentName: 'Cara Wu' }
]
const reports = new Map([
    ['1', { attendanceStatus: 'present' }],
    ['2', { attendanceStatus: 'absent' }],
    ['3', { attendanceStatus: 'pending' }]
])

describe('roster workflow filtering', () => {
    it('filters the shared workflow list without changing roster metrics', () => {
        const roster = getRosterEnrollments(enrollments, reports, 'amy', 'present')
        expect(roster.filtered.map(item => item.id)).toEqual(['1'])
        expect(roster.all).toHaveLength(3)
        expect(countRosterAttendance(roster.all, reports)).toEqual({ present: 1, pending: 1, absent: 1 })
    })

    it('returns a real empty roster separately from a no-match result', () => {
        expect(getRosterEnrollments([], new Map(), '', 'all')).toEqual({ all: [], filtered: [] })
        const noMatch = getRosterEnrollments(enrollments, reports, 'nobody', 'all')
        expect(noMatch.all).toHaveLength(3)
        expect(noMatch.filtered).toHaveLength(0)
    })
})
