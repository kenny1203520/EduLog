import { supabase } from '@/lib/supabase'
import { Classroom, type ClassroomDTO, type ClassroomScheduleDTO } from '@/models/Classroom'
import { VisibilityPreferenceService } from '../VisibilityPreferenceService'
import { apiResourceClient } from '../api/ApiResourceClient'
import { getApiV1Mode } from '../api/ApiModeClient'

export type ClassroomVisibilityFilterMode = 'all' | 'visible' | 'hidden'

export class ClassroomService {
    static async getClassrooms(
        page: number = 1,
        perPage: number = 100,
        search?: string,
        visibilityMode: ClassroomVisibilityFilterMode = 'all'
    ): Promise<{ data: Classroom[], count: number }> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiResourceClient.list<ClassroomDTO>('classrooms', { page, perPage, search, sort: 'name', mode: 'v1' })
            const classrooms = (result.data || []).map((d) => new Classroom(d))
            return { data: classrooms, count: result.meta?.total ?? classrooms.length }
        }

        const from = (page - 1) * perPage
        const to = from + perPage - 1

        if (visibilityMode === 'all') {
            let query = supabase
                .from('classrooms')
                .select('*, classroom_schedules (*)', { count: 'exact' })

            if (search) {
                query = query.ilike('name', `%${search}%`)
            }

            const { data, error, count } = await query
                .order('name')
                .range(from, to)

            if (error) throw new Error(error.message)

            const classrooms = (data || []).map((d: any) => {
                const c = new Classroom(d)
                if (d.classroom_schedules) {
                    d.classroom_schedules.forEach((s: ClassroomScheduleDTO) => c.addSchedule(s))
                }
                return c
            })
            return { data: classrooms, count: count || 0 }
        }

        const chunkSize = Math.max(perPage, 250)
        const allClassrooms: Classroom[] = []

        for (let offset = 0; ; offset += chunkSize) {
            let query = supabase
                .from('classrooms')
                .select('*, classroom_schedules (*)')

            if (search) {
                query = query.ilike('name', `%${search}%`)
            }

            const { data, error } = await query
                .order('name')
                .range(offset, offset + chunkSize - 1)

            if (error) throw new Error(error.message)

            const chunk = (data || []).map((d: any) => {
                const classroom = new Classroom(d)
                if (d.classroom_schedules) {
                    d.classroom_schedules.forEach((s: ClassroomScheduleDTO) => classroom.addSchedule(s))
                }
                return classroom
            })

            allClassrooms.push(...chunk)

            if (chunk.length < chunkSize) {
                break
            }
        }

        const classroomIds = allClassrooms
            .map(classroom => classroom.id)
            .filter((id): id is string => Boolean(id))
        const hiddenIds = await VisibilityPreferenceService.getHiddenEntityIds('classroom', classroomIds)
        const filteredClassrooms = allClassrooms.filter(classroom => {
            const isHidden = !!classroom.id && hiddenIds.has(classroom.id)
            return visibilityMode === 'hidden' ? isHidden : !isHidden
        })

        return {
            data: filteredClassrooms.slice(from, to + 1),
            count: filteredClassrooms.length
        }
    }

    static async createClassroom(classroom: Partial<ClassroomDTO>): Promise<Classroom> {
        if (getApiV1Mode() === 'v1') return new Classroom((await apiResourceClient.create<ClassroomDTO>('classrooms', classroom, 'v1')).data)
        const { data, error } = await supabase.from('classrooms').insert(classroom).select().single()
        if (error) throw new Error(error.message)
        return new Classroom(data)
    }

    static async updateClassroom(id: string, updates: Partial<ClassroomDTO>): Promise<Classroom> {
        if (getApiV1Mode() === 'v1') return new Classroom((await apiResourceClient.update<ClassroomDTO>('classrooms', id, updates, 'v1')).data)
        const { data, error } = await supabase.from('classrooms').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return new Classroom(data)
    }

    static async deleteClassroom(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove('classrooms', id, 'v1'); return }
        const { error } = await supabase.from('classrooms').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async createSchedule(schedule: Partial<ClassroomScheduleDTO>): Promise<ClassroomScheduleDTO> {
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.create<ClassroomScheduleDTO>('classroom-schedules', schedule, 'v1')).data
        const { data, error } = await supabase.from('classroom_schedules').insert(schedule).select().single()
        if (error) throw new Error(error.message)
        return data as ClassroomScheduleDTO
    }

    static async deleteSchedule(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove('classroom-schedules', id, 'v1'); return }
        const { error } = await supabase.from('classroom_schedules').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }
}
