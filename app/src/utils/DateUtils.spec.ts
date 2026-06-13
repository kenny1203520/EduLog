import { describe, it, expect } from 'vitest'
import { DateUtils } from './DateUtils'

describe('DateUtils', () => {
    it('isValidTimeZone returns true for valid time zones', () => {
        expect(DateUtils.isValidTimeZone('Asia/Taipei')).toBe(true)
        expect(DateUtils.isValidTimeZone('UTC')).toBe(true)
    })

    it('isValidTimeZone returns false for invalid time zones', () => {
        expect(DateUtils.isValidTimeZone('Invalid/Zone')).toBe(false)
        expect(DateUtils.isValidTimeZone('')).toBe(false)
    })

    it('parseLocalDate correctly parses YYYY-MM-DD', () => {
        const date = DateUtils.parseLocalDate('2026-06-14')
        expect(date).toBeDefined()
        expect(date?.getFullYear()).toBe(2026)
        expect(date?.getMonth()).toBe(5) // 0-indexed month
        expect(date?.getDate()).toBe(14)
    })

    it('formatLocalDate formats Date object to YYYY-MM-DD', () => {
        const date = new Date(2026, 5, 14) // June 14, 2026
        expect(DateUtils.formatLocalDate(date)).toBe('2026-06-14')
    })
    
    it('addDays correctly adds days to a date', () => {
        const date = new Date(2026, 5, 14)
        const nextDay = DateUtils.addDays(date, 5)
        expect(nextDay.getDate()).toBe(19)
    })
})
