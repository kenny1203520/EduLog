import { Classroom, type ClassroomDTO, type ClassroomScheduleDTO } from '@/models/Classroom'
import { VisibilityPreferenceService } from '../VisibilityPreferenceService'
import { apiResourceClient } from '../api/ApiResourceClient'

export type ClassroomVisibilityFilterMode = 'all' | 'visible' | 'hidden'

function toClassroom(dto: ClassroomDTO & { classroom_schedules?: ClassroomScheduleDTO[] }) {
    const classroom = new Classroom(dto)
    for (const schedule of dto.classroom_schedules ?? []) classroom.addSchedule(schedule)
    return classroom
}

export class ClassroomService {
    static async getClassrooms(page: number = 1, perPage: number = 100, search?: string, visibilityMode: ClassroomVisibilityFilterMode = 'all'): Promise<{ data: Classroom[], count: number }> {
        const result = await apiResourceClient.list<ClassroomDTO & { classroom_schedules?: ClassroomScheduleDTO[] }>('classrooms', { page, perPage, search, sort: 'name' })
        let classrooms = (result.data || []).map(toClassroom)
        if (visibilityMode !== 'all') {
            const ids = classrooms.map((classroom) => classroom.id).filter((id): id is string => Boolean(id))
            const hiddenIds = await VisibilityPreferenceService.getHiddenEntityIds('classroom', ids)
            classrooms = classrooms.filter((classroom) => visibilityMode === 'hidden' ? hiddenIds.has(classroom.id ?? '') : !hiddenIds.has(classroom.id ?? ''))
        }
        return { data: classrooms, count: result.meta?.total ?? classrooms.length }
    }

    static async getAllClassrooms(search?: string, visibilityMode: ClassroomVisibilityFilterMode = 'all'): Promise<{ data: Classroom[], count: number }> {
        const pageSize = 100
        const classrooms: Classroom[] = []
        let page = 1
        let total = 0
        do {
            const result = await this.getClassrooms(page, pageSize, search, visibilityMode)
            classrooms.push(...result.data)
            total = result.count
            page += 1
            if (result.data.length === 0) break
        } while (classrooms.length < total)
        return { data: classrooms, count: total }
    }

    static async createClassroom(classroom: Partial<ClassroomDTO>): Promise<Classroom> {
        return new Classroom((await apiResourceClient.create<ClassroomDTO>('classrooms', classroom)).data)
    }

    static async updateClassroom(id: string, updates: Partial<ClassroomDTO>): Promise<Classroom> {
        return new Classroom((await apiResourceClient.update<ClassroomDTO>('classrooms', id, updates)).data)
    }

    static async deleteClassroom(id: string): Promise<void> {
        await apiResourceClient.remove('classrooms', id)
    }

    static async createSchedule(schedule: Partial<ClassroomScheduleDTO>): Promise<ClassroomScheduleDTO> {
        return (await apiResourceClient.create<ClassroomScheduleDTO>('classroom-schedules', schedule)).data
    }

    static async deleteSchedule(id: string): Promise<void> {
        await apiResourceClient.remove('classroom-schedules', id)
    }
}
