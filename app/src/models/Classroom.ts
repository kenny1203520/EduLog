export interface ClassroomDTO {
    id?: string
    name: string
    address?: string
    color?: string
    created_at?: string
    updated_at?: string
}

export interface ClassSessionDTO {
    id?: string
    name: string
    classroom_id?: string
    course_ids: string[]
    day_of_week: number
    start_time: string
    end_time: string
    capacity: number
}

export interface ClassroomScheduleDTO {
    id?: string
    classroom_id: string
    day_of_week: number // 0=Sunday, 6=Saturday
    start_time: string // HH:mm:ss
    end_time: string // HH:mm:ss
}

export class Classroom {
    id?: string
    name: string
    address: string
    color: string
    schedules: ClassroomScheduleDTO[] = []

    constructor(data: ClassroomDTO) {
        this.id = data.id
        this.name = data.name
        this.address = data.address || ''
        this.color = data.color || '#10b981'
    }

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
