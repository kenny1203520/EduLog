export interface HolidayDTO {
    id?: string
    start_date: string
    end_date: string
    name?: string
    classroom_ids?: string[]
    class_session_ids?: string[]
    created_at?: string
    updated_at?: string
    // Joined data (Note: Supabase doesn't easily join arrays, so we'll fetch names in UI if needed)
}

export class Holiday {
    id?: string
    startDate: string
    endDate: string
    name?: string
    classroomIds: string[]
    classSessionIds: string[]
    createdAt?: Date
    updatedAt?: Date

    constructor(data: HolidayDTO) {
        this.id = data.id
        this.startDate = data.start_date
        this.endDate = data.end_date
        this.name = data.name
        this.classroomIds = data.classroom_ids || []
        this.classSessionIds = data.class_session_ids || []
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    get formattedRange(): string {
        if (this.startDate === this.endDate) return this.startDate
        return `${this.startDate} ~ ${this.endDate}`
    }
}
