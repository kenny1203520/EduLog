import { describe, expect, it } from 'vitest'
import type { ClassSessionDTO } from '@/models/ClassSession'
import { buildSessionScheduleDisplayItems } from './sessionScheduleDisplay'

const translate = (key: string, named?: Record<string, unknown>) => {
    if (key === 'classroom.schedule_draft') return 'Draft'
    if (key === 'classroom.monthly_day_summary') return `Monthly ${named?.day} ${named?.time}`
    return key
}

const dayLabel = (day: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] || String(day)

function regular(overrides: Partial<ClassSessionDTO> = {}): ClassSessionDTO {
    return {
        name: 'Long recurring class name',
        course_ids: [],
        capacity: 18,
        session_type: 'regular',
        schedule_mode: 'weekly',
        start_date: '2026-07-01',
        time_zone: 'America/Argentina/Buenos_Aires',
        schedule_rules: [
            { schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' }
        ],
        ...overrides
    }
}

describe('session schedule display items', () => {
    it('returns one independently renderable item for every weekly rule', () => {
        const items = buildSessionScheduleDisplayItems(regular({
            schedule_rules: [
                { schedule_kind: 'weekly', day_of_week: 1, start_time: '10:00', end_time: '12:00' },
                { schedule_kind: 'weekly', day_of_week: 3, start_time: '14:00', end_time: '16:00' }
            ]
        }), translate, dayLabel)

        expect(items.map(item => item.text)).toEqual(['Mon 10:00-12:00', 'Wed 14:00-16:00'])
        expect(new Set(items.map(item => item.key)).size).toBe(2)
    })

    it('uses localized weekday and monthly text for the active locale', () => {
        const localizedTranslate = (key: string, named?: Record<string, unknown>) => {
            if (key === 'classroom.schedule_draft') return '尚未排課'
            if (key === 'classroom.monthly_day_summary') return `每月 ${named?.day} 日 ${named?.time}`
            return key
        }
        const localizedDay = (day: number) => ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][day] || String(day)

        const weekly = buildSessionScheduleDisplayItems(regular(), localizedTranslate, localizedDay)
        const monthly = buildSessionScheduleDisplayItems(regular({
            schedule_mode: 'monthly',
            schedule_rules: [{ schedule_kind: 'monthly', day_of_month: 28, start_time: '09:00', end_time: '10:30' }]
        }), localizedTranslate, localizedDay)

        expect(weekly[0]?.text).toBe('週一 10:00-12:00')
        expect(monthly[0]?.text).toBe('每月 28 日 09:00-10:30')
    })

    it('formats monthly and exact-date schedules without joining them into one long string', () => {
        const monthly = buildSessionScheduleDisplayItems(regular({
            schedule_mode: 'monthly',
            schedule_rules: [
                { schedule_kind: 'monthly', day_of_month: 28, start_time: '09:00', end_time: '10:30' }
            ]
        }), translate, dayLabel)
        const camp = buildSessionScheduleDisplayItems({
            name: 'Camp',
            course_ids: [],
            capacity: 20,
            session_type: 'camp',
            schedule_mode: 'specific_dates',
            start_date: '2026-08-01',
            end_date: '2026-08-10',
            schedule_rules: [
                { schedule_kind: 'specific_dates', occurrence_date: '2026-08-03', start_time: '09:00', end_time: '16:00' }
            ]
        }, translate, dayLabel)

        expect(monthly[0]?.text).toBe('Monthly 28 09:00-10:30')
        expect(camp[0]?.text).toBe('2026-08-03 09:00-16:00')
    })

    it('represents an incomplete camp as a draft item', () => {
        const items = buildSessionScheduleDisplayItems({
            name: 'Draft Camp',
            course_ids: [],
            capacity: 20,
            session_type: 'camp',
            schedule_mode: 'specific_dates',
            schedule_rules: []
        }, translate, dayLabel)

        expect(items).toEqual([{ key: 'draft', text: 'Draft' }])
    })
})
