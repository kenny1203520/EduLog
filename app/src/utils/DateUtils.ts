/**
 * Utility for handling dates consistently across the application.
 * Prevents timezone shifting issues for date-only (YYYY-MM-DD) strings.
 */
export class DateUtils {
    /**
     * Parses a YYYY-MM-DD string into a Local Date object at 00:00:00.
     */
    static parseLocalDate(dateStr: string | undefined): Date | undefined {
        if (!dateStr) return undefined
        const parts = dateStr.split('-').map(Number)
        if (parts.length < 3) return new Date(dateStr) // Fallback
        const y = parts[0] ?? 2000
        const m = parts[1] ?? 1
        const d = parts[2] ?? 1
        return new Date(y, m - 1, d)
    }

    /**
     * Formats a Date object to YYYY-MM-DD string in local time.
     */
    static formatLocalDate(date: Date | undefined): string {
        if (!date) return ''
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    /**
     * Formats a date for display in local time.
     */
    static displayDate(date: Date | string | undefined): string {
        if (!date) return '-'
        const d = typeof date === 'string' ? this.parseLocalDate(date) : date
        if (!d) return '-'
        return d.toLocaleDateString()
    }
}
