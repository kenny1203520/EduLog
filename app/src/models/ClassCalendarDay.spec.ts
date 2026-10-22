import { describe, expect, it } from 'vitest'
import { calendarGridRange, classifyClassDay, reportCompletionLevel, withoutRange } from './ClassCalendarDay'
import type { ClassOccurrence } from './ClassOccurrence'

const occurrence = (status: ClassOccurrence['status'], isConducted = true) => ({ status, isConducted }) as ClassOccurrence
const today = '2026-10-16'

describe('classifyClassDay', () => {
    it('marks held, upcoming and cancelled lessons', () => {
        expect(classifyClassDay('2026-10-10', today, [occurrence('scheduled')], null)).toBe('held')
        expect(classifyClassDay('2026-10-16', today, [occurrence('scheduled')], null)).toBe('held')
        expect(classifyClassDay('2026-10-10', today, [occurrence('scheduled', false)], null)).toBe('upcoming')
        expect(classifyClassDay('2026-10-24', today, [occurrence('scheduled')], null)).toBe('upcoming')
        expect(classifyClassDay('2026-10-10', today, [occurrence('cancelled')], null)).toBe('cancelled')
        expect(classifyClassDay('2026-10-10', today, [occurrence('cancelled'), occurrence('scheduled')], null)).toBe('held')
    })

    it('treats future planned dates without a generated lesson as upcoming, and other days as none', () => {
        const planned = (date: string) => date === '2026-10-31' || date === '2026-10-03'
        expect(classifyClassDay('2026-10-31', today, [], planned)).toBe('upcoming')
        expect(classifyClassDay('2026-10-03', today, [], planned)).toBe('none')
        expect(classifyClassDay('2026-10-30', today, [], planned)).toBe('none')
        expect(classifyClassDay('2026-10-31', today, [], null)).toBe('none')
    })
})

describe('reportCompletionLevel', () => {
    it('summarizes report counts', () => {
        expect(reportCompletionLevel(undefined)).toBeNull()
        expect(reportCompletionLevel({ total: 0, completed: 0 })).toBeNull()
        expect(reportCompletionLevel({ total: 3, completed: 3 })).toBe('complete')
        expect(reportCompletionLevel({ total: 3, completed: 1 })).toBe('partial')
        expect(reportCompletionLevel({ total: 3, completed: 0 })).toBe('none')
    })
})

describe('calendarGridRange', () => {
    it('covers the six-week grid around a month, Sunday first', () => {
        // October 2026 starts on a Thursday.
        expect(calendarGridRange(new Date(2026, 9, 21))).toEqual({ start: '2026-09-27', end: '2026-11-07' })
        // February 2026 starts on a Sunday.
        expect(calendarGridRange(new Date(2026, 1, 10))).toEqual({ start: '2026-02-01', end: '2026-03-14' })
    })

    it('drops only the dates inside a reloaded range', () => {
        expect(withoutRange({ '2026-09-30': 1, '2026-10-01': 2, '2026-10-02': 3 }, { start: '2026-10-01', end: '2026-10-01' }))
            .toEqual({ '2026-09-30': 1, '2026-10-02': 3 })
    })
})
