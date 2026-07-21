export interface ClassroomDTO {
    id?: string
    name: string
    address?: string
    phone?: string
    color?: string
    created_at?: string
    updated_at?: string
    external_link?: string
}

export type {
    ClassSessionDTO,
    ClassSessionScheduleRuleDTO,
    ScheduleMode,
    SessionType
} from './ClassSession'

export interface ClassroomScheduleDTO {
    id?: string
    classroom_id: string
    day_of_week: number // 0=Sunday, 6=Saturday
    start_time: string // HH:mm:ss
    end_time: string // HH:mm:ss
    created_at?: string
    updated_at?: string
}

export class Classroom {
    id?: string
    name: string
    address: string
    phone: string
    color: string
    external_link: string
    created_at?: string
    updated_at?: string
    schedules: ClassroomScheduleDTO[] = []

    constructor(data: ClassroomDTO) {
        this.id = data.id
        this.name = data.name
        this.address = data.address || ''
        this.phone = data.phone || ''
        this.color = data.color || '#10b981'
        this.external_link = data.external_link || ''
        this.created_at = data.created_at
        this.updated_at = data.updated_at
    }

    // ... (omitted)

    addSchedule(schedule: ClassroomScheduleDTO) {
        this.schedules.push(schedule)
        this.sortSchedules()
    }

    sortSchedules() {
        this.schedules.sort((a, b) => {
            if (a.day_of_week !== b.day_of_week) {
                return a.day_of_week - b.day_of_week
            }
            return a.start_time.localeCompare(b.start_time)
        })
    }
}
