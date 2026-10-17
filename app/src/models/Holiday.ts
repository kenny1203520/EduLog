import { DateUtils } from '@/utils/DateUtils'

export interface HolidayDTO {
    id?: string
    start_date: string
    end_date: string
    time_zone?: string
    name?: string
    kind?: 'closure' | 'teacher_leave'
    classroom_ids?: string[]
    class_session_ids?: string[]
    teacher_ids?: string[]
    created_at?: string
    updated_at?: string
    // Joined data (Note: Supabase doesn't easily join arrays, so we'll fetch names in UI if needed)
}

export class Holiday {
    id?: string
    startDate: string
    endDate: string
    timeZone: string
    name?: string
    kind: 'closure' | 'teacher_leave'
    classroomIds: string[]
    classSessionIds: string[]
    teacherIds: string[]
    createdAt?: Date
    updatedAt?: Date

    constructor(data: HolidayDTO) {
        this.id = data.id
        this.startDate = data.start_date
        this.endDate = data.end_date
        this.timeZone = DateUtils.isValidTimeZone(data.time_zone) ? data.time_zone : DateUtils.getDefaultTimeZone()
        this.name = data.name
        this.kind = data.kind === 'teacher_leave' ? 'teacher_leave' : 'closure'
        this.classroomIds = data.classroom_ids || []
        this.classSessionIds = data.class_session_ids || []
        this.teacherIds = data.teacher_ids || []
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    get formattedRange(): string {
        const start = DateUtils.displayDate(this.startDate, undefined, this.timeZone)
        const end = DateUtils.displayDate(this.endDate, undefined, this.timeZone)
        if (this.startDate === this.endDate) return start
        return `${start} ~ ${end}`
    }
}
