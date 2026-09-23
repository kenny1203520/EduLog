/**
 * Utility for handling dates consistently across the application.
 * Date-only values remain calendar dates, while "now" and timestamps can be
 * interpreted with the user's preferred IANA time zone.
 */
import i18n from '@/i18n'
import { TimeZoneService } from '@/services/TimeZoneService'

export class DateUtils {
    static getBrowserTimeZone(): string {
        return TimeZoneService.getBrowserTimeZone()
    }

    static getDefaultTimeZone(): string {
        return TimeZoneService.getDefaultTimeZone()
    }

    static isValidTimeZone(timeZone: string | undefined): timeZone is string {
        return TimeZoneService.isValid(timeZone)
    }

    static getSupportedTimeZones(): string[] {
        return TimeZoneService.getSupportedTimeZones()
    }

    static formatTimeZoneLabel(timeZone: string, locale?: string): string {
        return TimeZoneService.formatLabel(timeZone, locale || i18n.global.locale.value)
    }

    static getTimeZoneOffsetLabel(timeZone: string, locale?: string): string {
        return TimeZoneService.getOffsetLabel(timeZone, locale || i18n.global.locale.value)
    }

    /**
     * Parses a YYYY-MM-DD string into a Local Date object at 00:00:00.
     * The Date is only a carrier for the calendar day; avoid treating it as an instant.
     */
    static parseLocalDate(dateStr: string | undefined): Date | undefined {
        if (!dateStr) return undefined
        const parts = dateStr.split('-').map(Number)
        if (parts.length < 3) return new Date(dateStr)
        const y = parts[0] ?? 2000
        const m = parts[1] ?? 1
        const d = parts[2] ?? 1
        return new Date(y, m - 1, d)
    }

    /**
     * Formats a date-only Date carrier to YYYY-MM-DD using local calendar fields.
     */
    static formatLocalDate(date: Date | undefined): string {
        if (!date) return ''
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    static todayString(timeZone: string = this.getDefaultTimeZone()): string {
        return this.formatInstantDate(new Date(), timeZone)
    }

    static todayDate(timeZone: string = this.getDefaultTimeZone()): Date {
        return this.parseLocalDate(this.todayString(timeZone)) || new Date()
    }

    static currentTimeString(timeZone: string = this.getDefaultTimeZone()): string {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date())
        const hour = parts.find(p => p.type === 'hour')?.value || '00'
        const minute = parts.find(p => p.type === 'minute')?.value || '00'
        return `${hour}:${minute}`
    }

    static addDays(date: Date, days: number): Date {
        const next = new Date(date)
        next.setDate(next.getDate() + days)
        return next
    }

    static addDaysToDateString(dateStr: string, days: number): string {
        const date = this.parseLocalDate(dateStr) || new Date()
        return this.formatLocalDate(this.addDays(date, days))
    }

    static parseTimeParts(time: string | undefined): { hour: number; minute: number; second: number } | null {
        if (!time) return null
        const [hourRaw, minuteRaw, secondRaw] = time.split(':')
        const hour = Number(hourRaw)
        const minute = Number(minuteRaw)
        const second = secondRaw === undefined ? 0 : Number(secondRaw)
        if (
            Number.isNaN(hour) ||
            Number.isNaN(minute) ||
            Number.isNaN(second) ||
            hour < 0 ||
            hour > 23 ||
            minute < 0 ||
            minute > 59 ||
            second < 0 ||
            second > 59
        ) {
            return null
        }
        return { hour, minute, second }
    }

    private static getZonedParts(date: Date, timeZone: string): {
        year: number
        month: number
        day: number
        hour: number
        minute: number
        second: number
    } {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date)

        const value = (type: string) => Number(parts.find(p => p.type === type)?.value || '0')
        return {
            year: value('year'),
            month: value('month'),
            day: value('day'),
            hour: value('hour'),
            minute: value('minute'),
            second: value('second')
        }
    }

    static getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
        if (!this.isValidTimeZone(timeZone)) timeZone = TimeZoneService.getDefaultTimeZone()
        const parts = this.getZonedParts(date, timeZone)
        const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
        return Math.round((zonedAsUtc - date.getTime()) / 60000)
    }

    static zonedDateTimeToInstant(
        dateStr: string | undefined,
        time: string | undefined,
        timeZone: string = this.getDefaultTimeZone()
    ): Date | null {
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
        const timeParts = this.parseTimeParts(time)
        if (!timeParts) return null
        const [year, month, day] = dateStr.split('-').map(Number)
        const utcGuess = Date.UTC(year, month - 1, day, timeParts.hour, timeParts.minute, timeParts.second)
        let instant = new Date(utcGuess - this.getTimeZoneOffsetMinutes(new Date(utcGuess), timeZone) * 60000)
        const correctedOffset = this.getTimeZoneOffsetMinutes(instant, timeZone)
        instant = new Date(utcGuess - correctedOffset * 60000)
        return instant
    }

    static formatInstantDate(date: Date, timeZone: string = this.getDefaultTimeZone()): string {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date)
        const y = parts.find(p => p.type === 'year')?.value || '2000'
        const m = parts.find(p => p.type === 'month')?.value || '01'
        const d = parts.find(p => p.type === 'day')?.value || '01'
        return `${y}-${m}-${d}`
    }

    /**
     * Locale defaults to the current app language (not the browser's) so a
     * caller that forgets to pass one explicitly still respects the user's
     * language preference instead of silently falling back to OS locale.
     */
    static displayDate(date: Date | string | undefined, locale: string = i18n.global.locale.value, timeZone: string = this.getDefaultTimeZone()): string {
        if (!date) return '-'
        if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return this.parseLocalDate(date)?.toLocaleDateString(locale) || '-'
        }
        const d = typeof date === 'string' ? new Date(date) : date
        if (Number.isNaN(d.getTime())) return '-'
        return d.toLocaleDateString(locale, { timeZone })
    }

    static displayDateTime(date: Date | string | undefined, locale: string = i18n.global.locale.value, timeZone: string = this.getDefaultTimeZone()): string {
        if (!date) return '-'
        const d = typeof date === 'string' ? new Date(date) : date
        if (Number.isNaN(d.getTime())) return '-'
        return d.toLocaleString(locale, { timeZone })
    }
}
