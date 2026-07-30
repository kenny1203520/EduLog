import { describe, expect, it } from 'vitest'
import { isAttendanceReportStatus } from './reportListFilter'

describe('isAttendanceReportStatus', () => {
    it.each(['present', 'absent', 'pending'])('includes %s reports', status => {
        expect(isAttendanceReportStatus(status)).toBe(true)
    })

    it.each(['scheduled', 'bookable', 'cancelled', 'rescheduled', undefined])(
        'excludes non-attendance status %s',
        status => {
            expect(isAttendanceReportStatus(status)).toBe(false)
        }
    )
})
