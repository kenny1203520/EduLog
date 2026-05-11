import { DateUtils } from '@/utils/DateUtils'

export interface SuspensionDTO {
    id?: string
    enrollment_id: string
    start_date: string
    end_date?: string | null
    reason?: string
    created_at?: string
    updated_at?: string
}

export class Suspension {
    id?: string
    enrollmentId: string
    startDate: string
    endDate?: string | null
    reason?: string
    createdAt?: Date
    updatedAt?: Date

    constructor(data: SuspensionDTO) {
        this.id = data.id
        this.enrollmentId = data.enrollment_id
        this.startDate = data.start_date
        this.endDate = data.end_date
        this.reason = data.reason
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    get isActive(): boolean {
        const now = DateUtils.todayString()
        if (this.endDate) {
            return now >= this.startDate && now <= this.endDate
        }
        return now >= this.startDate
    }

    get isIndefinite(): boolean {
        return !this.endDate
    }

    get displayDateRange(): string {
        if (this.endDate) {
            return `${this.startDate} ~ ${this.endDate}`
        }
        return `${this.startDate} ~ (Indefinite)`
    }
}
