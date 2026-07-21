import { describe, expect, it } from 'vitest'
import { CampSession, ClassSessionFactory, RegularClassSession, type ClassSessionDTO } from './ClassSession'

function regular(overrides: Partial<ClassSessionDTO> = {}) {
    return new RegularClassSession({
        name: 'Recurring class',
        course_ids: [],
        capacity: 10,
        session_type: 'regular',
        schedule_mode: 'weekly',
        start_date: '2026-07-01',
        schedule_rules: [
            { schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' }
        ],
        ...overrides
    })
}

describe('ClassSession schedules', () => {
    it('generates multiple weekly class days with their own times', () => {
        const session = regular({
            schedule_rules: [
                { schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' },
                { schedule_kind: 'weekly', day_of_week: 3, start_time: '14:00', end_time: '16:00' }
            ]
        })

        expect(session.plannedOccurrences(new Date(2026, 6, 20), new Date(2026, 6, 26))).toEqual([
            { occurrenceDate: '2026-07-20', startTime: '10:00', endTime: '12:00' },
            { occurrenceDate: '2026-07-22', startTime: '14:00', endTime: '16:00' }
        ])
    })

    it('skips a monthly day that does not exist', () => {
        const session = regular({
            schedule_mode: 'monthly',
            start_date: '2026-02-01',
            end_date: '2026-03-31',
            schedule_rules: [
                { schedule_kind: 'monthly', day_of_month: 31, start_time: '09:00', end_time: '10:00' }
            ]
        })

        expect(session.plannedOccurrences(new Date(2026, 1, 1), new Date(2026, 2, 31))).toEqual([
            { occurrenceDate: '2026-03-31', startTime: '09:00', endTime: '10:00' }
        ])
    })

    it('keeps an incomplete camp as a draft without occurrences', () => {
        const camp = new CampSession({
            name: 'Summer camp',
            course_ids: [],
            capacity: 20,
            session_type: 'camp',
            schedule_mode: 'specific_dates',
            schedule_rules: [
                { schedule_kind: 'specific_dates', occurrence_date: '2026-08-03', start_time: '09:00', end_time: '16:00' }
            ]
        })

        expect(camp.isDraft).toBe(true)
        expect(camp.plannedOccurrences(new Date(2026, 7, 1), new Date(2026, 7, 31))).toEqual([])
    })

    it('generates only configured camp dates inside its range', () => {
        const camp = new CampSession({
            name: 'Summer camp',
            course_ids: [],
            capacity: 20,
            session_type: 'camp',
            schedule_mode: 'specific_dates',
            start_date: '2026-08-01',
            end_date: '2026-08-10',
            schedule_rules: [
                { schedule_kind: 'specific_dates', occurrence_date: '2026-08-03', start_time: '09:00', end_time: '12:00' },
                { schedule_kind: 'specific_dates', occurrence_date: '2026-08-07', start_time: '13:00', end_time: '16:00' }
            ]
        })

        expect(camp.validate()).toEqual([])
        expect(camp.plannedOccurrences(new Date(2026, 7, 1), new Date(2026, 7, 31))).toHaveLength(2)
        expect(camp.isScheduledOn('2026-08-05')).toBe(false)
    })

    it('rejects duplicate daily rules and camp dates outside the range', () => {
        const duplicate = regular({
            schedule_rules: [
                { schedule_kind: 'weekly', day_of_week: 1, start_time: '09:00', end_time: '10:00' },
                { schedule_kind: 'weekly', day_of_week: 1, start_time: '11:00', end_time: '12:00' }
            ]
        })
        const camp = ClassSessionFactory.create({
            name: 'Camp',
            course_ids: [],
            capacity: 10,
            session_type: 'camp',
            schedule_mode: 'specific_dates',
            start_date: '2026-08-05',
            end_date: '2026-08-10',
            schedule_rules: [
                { schedule_kind: 'specific_dates', occurrence_date: '2026-08-03', start_time: '09:00', end_time: '10:00' }
            ]
        })

        expect(duplicate.validate()).toContain('A session can have at most one class per day')
        expect(camp.validate()).toContain('Camp schedule date 2026-08-03 is before the start date')
    })
})
