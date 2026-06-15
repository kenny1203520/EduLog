import { describe, expect, it } from 'vitest'
import { isTeacherPresentForScope } from './TeacherAttendanceScope'

describe('isTeacherPresentForScope', () => {
    it('requires the current teacher to be assigned to the occurrence', () => {
        expect(isTeacherPresentForScope({
            teacherId: 'teacher-1',
            teacherUserId: 'user-1',
            occurrenceTeacherIds: ['teacher-2'],
            teacherAttendance: { 'teacher-1': true }
        })).toBe(false)
    })

    it('treats explicit teacher attendance false as absent', () => {
        expect(isTeacherPresentForScope({
            teacherId: 'teacher-1',
            teacherUserId: 'user-1',
            occurrenceTeacherIds: ['teacher-1'],
            teacherAttendance: { 'teacher-1': false }
        })).toBe(false)
    })

    it('lets a user_id false override a legacy teacher_id true value', () => {
        expect(isTeacherPresentForScope({
            teacherId: 'teacher-1',
            teacherUserId: 'user-1',
            occurrenceTeacherIds: ['teacher-1'],
            teacherAttendance: {
                'teacher-1': true,
                'user-1': false
            }
        })).toBe(false)
    })

    it('supports legacy occurrences that stored user_id as the assignment key', () => {
        expect(isTeacherPresentForScope({
            teacherId: 'teacher-1',
            teacherUserId: 'user-1',
            occurrenceTeacherIds: ['user-1'],
            teacherAttendance: { 'user-1': true }
        })).toBe(true)
    })

    it('does not assume present when attendance has no explicit true value', () => {
        expect(isTeacherPresentForScope({
            teacherId: 'teacher-1',
            teacherUserId: 'user-1',
            occurrenceTeacherIds: ['teacher-1'],
            teacherAttendance: {}
        })).toBe(false)
    })
})
