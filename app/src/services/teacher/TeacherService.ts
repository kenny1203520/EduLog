import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { PageApiService } from '@/services/api/PageApiService'

export interface TeacherDTO {
    id?: string
    user_id?: string | null
    name: string
    email?: string | null
    phone?: string | null
    birthday?: string | null
    gov_id?: string | null
    address?: string | null
    bio?: string | null
    bio_document?: RichTextDocumentV1 | null
    teacher_credentials?: TeacherCredentialDTO[]
    created_at?: string
    updated_at?: string
}

export interface SessionTeacherAssignmentDTO extends TeacherDTO {
    effective_from: string
    effective_to: string | null
    role_id: string
    role?: { id: string; name: string; code?: string | null } | null
}

export interface TeacherCredentialDTO {
    id?: string
    teacher_id?: string
    platform: string
    username?: string
    password?: string
    url?: string
    created_at?: string
    updated_at?: string
}

export interface TeacherStatisticsDTO {
    totalTeachers: number
    linkedAccounts: number
    unlinkedAccounts: number
    completeProfiles: number
    teachersWithBirthday: number
    teachersWithGovId: number
}

type TeacherUpsertDTO = Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>

function normalizeTeacherPayload(payload: Partial<TeacherUpsertDTO>): Partial<TeacherUpsertDTO> {
    const normalized: Partial<TeacherUpsertDTO> = { ...payload }

    if (normalized.bio_document || normalized.bio !== undefined) {
        const bio = createTextEditorContent(normalized.bio_document || normalized.bio || '')
        normalized.bio = bio.plainText || null
        normalized.bio_document = bio.richText
    }

    ;(['user_id', 'phone', 'birthday', 'gov_id', 'address', 'bio'] as const).forEach((key) => {
        const value = normalized[key]
        if (value === '') {
            normalized[key] = null
        }
    })

    return normalized
}

export class TeacherService {
    static async getTeachers(
        page: number = 1,
        perPage: number = 100,
        search?: string
    ): Promise<{ data: TeacherDTO[]; count: number }> {
        const result = await apiResourceClient.list<TeacherDTO>('teachers', { page, perPage, search, sort: 'name' })
        return { data: result.data || [], count: result.meta?.total ?? result.data?.length ?? 0 }
    }

    static async getAllTeachers(): Promise<TeacherDTO[]> {
        const result = await apiResourceClient.list<TeacherDTO>('teachers', { perPage: 100, sort: 'name' })
        return result.data || []
    }

    static async getAllTeachersWithCredentials(): Promise<TeacherDTO[]> {
        const result = await apiResourceClient.list<TeacherDTO>('teachers', { perPage: 100, sort: 'name' })
        const teachers = result.data || []
        // Collections intentionally omit sensitive profile fields. Hydrate
        // the authorized item projection before edit forms can mutate rows.
        return Promise.all(teachers.map(async (teacher) => {
            if (!teacher.id) return teacher
            return (await this.getTeacherById(teacher.id))
        }))
    }

    static async getTeacherById(id: string): Promise<TeacherDTO> {
        const base = (await apiResourceClient.get<TeacherDTO>('teachers', id)).data
        const sensitive = await PageApiService.getTeacherPrivateDetails(id)
        return {
            ...base,
            ...sensitive.data.teacher,
            teacher_credentials: sensitive.data.credentials || []
        }
    }

    static async getTeacherByUserId(userId: string | null | undefined): Promise<TeacherDTO | null> {
        if (!userId) return null

        const result = await apiResourceClient.list<TeacherDTO>('teachers', { userId, perPage: 1 })
        return result.data?.[0] || null
    }

    static async createTeacher(teacher: TeacherUpsertDTO): Promise<TeacherDTO> {
        return (await apiResourceClient.create<TeacherDTO>('teachers', normalizeTeacherPayload(teacher))).data
    }

    static async updateTeacher(
        id: string,
        updates: Partial<Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>>
    ): Promise<TeacherDTO> {
        return (await apiResourceClient.update<TeacherDTO>('teachers', id, normalizeTeacherPayload(updates))).data
    }

    static async deleteTeacher(id: string): Promise<void> {
        await apiResourceClient.remove('teachers', id); return
    }

    static getTeacherStatistics(teachers: TeacherDTO[]): TeacherStatisticsDTO {
        const totalTeachers = teachers.length
        const linkedAccounts = teachers.filter(teacher => !!teacher.user_id).length
        const unlinkedAccounts = totalTeachers - linkedAccounts
        const completeProfiles = teachers.filter(teacher => Boolean(teacher.name && teacher.email)).length
        const teachersWithBirthday = teachers.filter(teacher => Boolean(teacher.birthday)).length
        const teachersWithGovId = teachers.filter(teacher => Boolean(teacher.gov_id)).length

        return {
            totalTeachers,
            linkedAccounts,
            unlinkedAccounts,
            completeProfiles,
            teachersWithBirthday,
            teachersWithGovId
        }
    }

    static async bulkDeleteTeachers(ids: string[]): Promise<void> {
        if (ids.length === 0) return
        await apiV1Client.post('/teachers/bulk-delete', { ids })
        return
    }

    static async addCredential(credential: TeacherCredentialDTO): Promise<TeacherCredentialDTO> {
        return (await apiResourceClient.create<TeacherCredentialDTO>('teacher-credentials', credential)).data
    }

    static async updateCredential(id: string, credential: Partial<TeacherCredentialDTO>): Promise<TeacherCredentialDTO> {
        return (await apiResourceClient.update<TeacherCredentialDTO>('teacher-credentials', id, credential)).data
    }

    static async deleteCredential(id: string): Promise<void> {
        await apiResourceClient.remove('teacher-credentials', id); return
    }

    // Session-teacher relationships
    static async getSessionTeachers(sessionId: string, onDate?: string): Promise<SessionTeacherAssignmentDTO[]> {
        const query = onDate ? '?on_date=' + encodeURIComponent(onDate) : ''
        const result = await apiV1Client.get<SessionTeacherAssignmentDTO[]>('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers' + query)
        return result.data || []
    }

    static async replaceTeachersForSession(
        sessionId: string,
        teachers: { teacher_id: string, role_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        await apiV1Client.put('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers', { teachers })
        return
    }

    static async assignTeachersToSession(
        sessionId: string,
        teachers: { teacher_id: string, role_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        if (teachers.length === 0) return

        await apiV1Client.post('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers', { teachers })
        return
    }

    static async assignTeacherForDate(sessionId: string, teacherId: string, date: string): Promise<void> {
        await apiV1Client.post('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers', { teachers: [{ teacher_id: teacherId, effective_from: date, effective_to: date }] })
        return
    }

    static async removeTeacherAssignment(sessionId: string, teacherId: string, effectiveFrom: string): Promise<void> {
        await apiV1Client.delete('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers?teacher_id=' + encodeURIComponent(teacherId) + '&effective_from=' + encodeURIComponent(effectiveFrom))
        return
    }

    static async clearSessionTeachers(sessionId: string): Promise<void> {
        await apiV1Client.delete('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers')
        return
    }

    static async removeTeacherFromSession(sessionId: string, teacherId: string): Promise<void> {
        await apiV1Client.delete('/class-sessions/' + encodeURIComponent(sessionId) + '/teachers/' + encodeURIComponent(teacherId))
        return
    }
}
