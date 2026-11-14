import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'

const roster = vi.hoisted(() => ({ getSessionTeachers: vi.fn() }))
const holiday = vi.hoisted(() => ({ isTeacherOnLeave: vi.fn() }))
const occurrenceApi = vi.hoisted(() => ({ updateOccurrence: vi.fn() }))
const feedback = vi.hoisted(() => ({ errorKey: vi.fn(), reportError: vi.fn() }))
vi.mock('@/services/holiday/HolidayQueryService', () => ({ HolidayQueryService: holiday }))
vi.mock('@/services/occurrence/OccurrenceQueryService', () => ({ OccurrenceQueryService: occurrenceApi }))
vi.mock('@/services/occurrence/OccurrenceCommandService', () => ({ OccurrenceCommandService: occurrenceApi }))
vi.mock('@/services/occurrence/OccurrenceSyncService', () => ({ OccurrenceSyncService: occurrenceApi }))
vi.mock('@/services/teacher/TeacherService', () => ({ TeacherService: roster }))
vi.mock('vue-i18n', async importOriginal => ({ ...(await importOriginal<typeof import('vue-i18n')>()), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-toastification', () => ({ useToast: () => ({ success: vi.fn() }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => feedback }))
vi.mock('@/stores/useAuthStore', () => ({ useAuthStore: () => ({ user: { id: 'user-a' } }) }))

import { filterTeachersByName, teachersEffectiveOn, useOccurrenceTeachers } from './useOccurrenceTeachers'

const assignment = (id: string, from: string, to: string | null = null, userId = `user-${id}`) =>
    ({ id, user_id: userId, name: `Teacher ${id}`, effective_from: from, effective_to: to }) as unknown as SessionTeacherAssignmentDTO

describe('occurrence teacher helpers', () => {
    it('keeps assignments effective on the date', () => {
        const all = [assignment('a', '2026-01-01'), assignment('b', '2026-01-01', '2026-06-30'), assignment('c', '2026-12-01')]
        expect(teachersEffectiveOn(all, '2026-11-07').map(item => item.id)).toEqual(['a'])
    })

    it('filters teachers by name, ignoring case and blank queries', () => {
        const teachers = [{ name: 'Alice' }, { name: 'Bob' }]
        expect(filterTeachersByName(teachers, ' ali ')).toEqual([{ name: 'Alice' }])
        expect(filterTeachersByName(teachers, '  ')).toBe(teachers)
    })
})

describe('occurrence teachers', () => {
    let scope: ReturnType<typeof effectScope>
    const todayOccurrence = ref<any>(null)
    const isOccurrenceInHoliday = ref(false)

    beforeEach(() => {
        vi.resetAllMocks()
        scope = effectScope()
        todayOccurrence.value = { id: 'occ', occurrenceDate: new Date(2026, 10, 7), teacherAttendance: { a: true } }
        isOccurrenceInHoliday.value = false
    })
    afterEach(() => scope.stop())

    const setup = () => scope.run(() => useOccurrenceTeachers({
        sessionId: 'session', session: ref({ classroom_id: 'room' }), todayOccurrence, isOccurrenceInHoliday,
    }))!

    it('derives attendance rows and counts from the effective assignments and leave', async () => {
        holiday.isTeacherOnLeave.mockImplementation(async (_date: string, teacherId: string) => teacherId === 'c')
        const teachers = setup()
        roster.getSessionTeachers.mockResolvedValue([assignment('a', '2026-01-01'), assignment('b', '2026-01-01'), assignment('c', '2026-01-01')])
        await teachers.loadOccurrenceTeachers()

        expect(teachers.teacherAttendanceCounts.value).toEqual({ present: 1, absent: 0, onLeave: 1, pending: 1 })
        expect(teachers.teacherAttendanceRows.value.map(row => [row.teacher.id, row.present, row.onLeave, row.canEdit])).toEqual([
            ['a', true, false, true],
            ['b', false, false, false],
            ['c', false, true, false],
        ])
    })

    it('retries a failed roster read and includes a newly assigned teacher on an existing lesson', async () => {
        const teachers = setup()
        roster.getSessionTeachers.mockRejectedValueOnce(new Error('unavailable'))
        await teachers.loadOccurrenceTeachers()
        expect(teachers.teacherRosterFailed.value).toBe(true)
        roster.getSessionTeachers.mockResolvedValueOnce([assignment('a', '2026-01-01'), assignment('new', '2026-11-07')])
        holiday.isTeacherOnLeave.mockResolvedValue(false)
        await teachers.loadOccurrenceTeachers()
        expect(roster.getSessionTeachers).toHaveBeenLastCalledWith('session', '2026-11-07')
        expect(teachers.teacherRosterFailed.value).toBe(false)
        expect(teachers.teacherAttendanceRows.value.find(row => row.teacher.id === 'new')?.pending).toBe(true)
    })

    it('sends only the edited teacher and keeps the other attendance entry', async () => {
        const teachers = setup()
        occurrenceApi.updateOccurrence.mockResolvedValue({ teacherAttendance: { b: false } })
        await teachers.toggleTeacherAttendance('b', false)
        expect(occurrenceApi.updateOccurrence).toHaveBeenCalledWith('occ', { teacher_attendance: { b: false } })
        expect(todayOccurrence.value.teacherAttendance).toEqual({ a: true, b: false })
    })

    it('refuses to mark a teacher present on a holiday', async () => {
        isOccurrenceInHoliday.value = true
        const teachers = setup()
        await teachers.toggleTeacherAttendance('a', true)
        expect(todayOccurrence.value.teacherAttendance).toEqual({ a: true })
        expect(feedback.errorKey).toHaveBeenCalledWith('report.error.cannot_set_teacher_present_during_holiday')
        expect(occurrenceApi.updateOccurrence).not.toHaveBeenCalled()
    })

    it('keeps the original attendance when the server rejects a teacher on leave', async () => {
        occurrenceApi.updateOccurrence.mockRejectedValue({ code: 'TEACHER_ON_LEAVE' })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const teachers = setup()
        await teachers.toggleTeacherAttendance('b', true)
        expect(todayOccurrence.value.teacherAttendance).toEqual({ a: true })
        expect(feedback.errorKey).toHaveBeenCalledWith('report.error.cannot_set_teacher_present_during_leave')
    })
})
