export interface HolidayDTO {
    id?: string
    start_date: string
    end_date: string
    name?: string
    classroom_id?: string
    class_session_id?: string
    created_at?: string
    updated_at?: string
    // Joined data
    classrooms?: { name: string }
    class_sessions?: { name: string }
}

export class Holiday {
    id?: string
    startDate: string
    endDate: string
    name?: string
    classroomId?: string
    classSessionId?: string
    classroomName?: string
    sessionName?: string
    createdAt?: Date
    updatedAt?: Date

    constructor(data: HolidayDTO) {
        this.id = data.id
        this.startDate = data.start_date
        this.endDate = data.end_date
        this.name = data.name
        this.classroomId = data.classroom_id
        this.classSessionId = data.class_session_id
        this.classroomName = data.classrooms?.name
        this.sessionName = data.class_sessions?.name
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    get formattedRange(): string {
        if (this.startDate === this.endDate) return this.startDate
        return `${this.startDate} ~ ${this.endDate}`
    }
}
