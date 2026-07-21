import { describe, expect, it } from 'vitest'
import type { ClassSessionDTO } from './ClassSession'
import { SessionEligibilityPolicy } from './SessionEligibilityPolicy'

const sessions: ClassSessionDTO[] = [
    {
        id: 'session-a',
        name: 'Course A Room 1',
        classroom_id: 'room-1',
        course_ids: ['course-a'],
        capacity: 10,
        start_date: '2026-07-01',
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: []
    },
    {
        id: 'session-b',
        name: 'Course B Room 1',
        classroom_id: 'room-1',
        course_ids: ['course-b'],
        capacity: 10,
        start_date: '2026-07-01',
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: []
    },
    {
        id: 'session-c',
        name: 'Course A Room 2',
        classroom_id: 'room-2',
        course_ids: ['course-a'],
        capacity: 10,
        start_date: '2026-07-01',
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: []
    },
    {
        id: 'session-empty',
        name: 'Unassigned',
        classroom_id: 'room-3',
        course_ids: [],
        capacity: 10,
        start_date: '2026-07-01',
        session_type: 'regular',
        schedule_mode: 'weekly',
        schedule_rules: []
    }
]

describe('SessionEligibilityPolicy', () => {
    it('only accepts sessions that explicitly contain the course', () => {
        expect(SessionEligibilityPolicy.supportsCourse(sessions[0], 'course-a')).toBe(true)
        expect(SessionEligibilityPolicy.supportsCourse(sessions[1], 'course-a')).toBe(false)
        expect(SessionEligibilityPolicy.supportsCourse(sessions[3], 'course-a')).toBe(false)
    })

    it('combines course, classroom, and current-session filters', () => {
        expect(SessionEligibilityPolicy.filter(sessions, {
            courseId: 'course-a',
            classroomId: 'room-1'
        }).map(session => session.id)).toEqual(['session-a'])

        expect(SessionEligibilityPolicy.filter(sessions, {
            courseId: 'course-a',
            excludeSessionId: 'session-a'
        }).map(session => session.id)).toEqual(['session-c'])
    })

    it('returns only classrooms that contain eligible sessions', () => {
        expect([...SessionEligibilityPolicy.classroomIds(sessions, 'course-a')]).toEqual(['room-1', 'room-2'])
    })
})
