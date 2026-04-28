import { supabase } from '@/lib/supabase'

export class EnrollmentSupportService {
    static async deleteReportsForEnrollment(enrollmentId: string): Promise<void> {
        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('enrollment_id', enrollmentId)

        if (error) {
            console.error(`Failed to delete reports for enrollment ${enrollmentId}:`, error)
        }
    }

    static normalizeDateOnly(value: string | Date): string {
        if (value instanceof Date) {
            if (Number.isNaN(value.getTime())) {
                throw new Error('Invalid date format. Please select a valid date.')
            }
            const y = value.getFullYear()
            const m = String(value.getMonth() + 1).padStart(2, '0')
            const d = String(value.getDate()).padStart(2, '0')
            return `${y}-${m}-${d}`
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return value
        }

        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) {
            throw new Error('Invalid date format. Please select a valid date.')
        }

        const y = parsed.getFullYear()
        const m = String(parsed.getMonth() + 1).padStart(2, '0')
        const d = String(parsed.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }

    static dayOfWeekFromDateOnly(dateOnly: string): number {
        const parts = dateOnly.split('-').map(Number)
        const y = parts[0] || 2000
        const m = parts[1] || 1
        const d = parts[2] || 1
        return new Date(y, m - 1, d).getDay()
    }
}
