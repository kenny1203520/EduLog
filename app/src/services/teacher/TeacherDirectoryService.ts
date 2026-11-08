import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { apiV1Client } from '@/services/api/ApiV1Client'

export type TeacherStatusFilter = 'active' | 'archived' | 'all'
export type TeacherSortField = 'name' | 'created_at' | 'class_count'

/** One row of the teacher directory. Email and phone are null without contact-detail access. */
export interface TeacherDirectoryItem {
    id: string
    user_id: string | null
    name: string
    bio?: string | null
    bio_document?: RichTextDocumentV1 | null
    email?: string | null
    phone?: string | null
    /** Current and upcoming class sessions. */
    class_count: number
    archived_at: string | null
    created_at?: string
    updated_at?: string
}

export interface TeacherDirectoryStatistics {
    totalTeachers: number
    linkedAccounts: number
    unlinkedAccounts: number
    unassignedTeachers: number
    archivedTeachers: number
}

export interface TeacherDirectoryPage {
    items: TeacherDirectoryItem[]
    statistics: TeacherDirectoryStatistics
    total: number
}

export interface TeacherDirectoryQuery {
    page: number
    perPage: number
    search: string
    sort: TeacherSortField
    descending: boolean
    status: TeacherStatusFilter
}

/** A class assignment of one teacher, as the caller may see it. */
export interface TeacherAssignmentDTO {
    class_session_id: string
    class_session_name: string
    classroom_id: string | null
    classroom_name: string | null
    classroom_color: string | null
    role_id: string
    role_code: string | null
    role_name: string
    effective_from: string
    effective_to: string | null
    is_current: boolean
    /** The caller may add or remove teachers in this class session. */
    can_manage: boolean
}

const EMPTY_STATISTICS: TeacherDirectoryStatistics = { totalTeachers: 0, linkedAccounts: 0, unlinkedAccounts: 0, unassignedTeachers: 0, archivedTeachers: 0 }

export class TeacherDirectoryService {
    /** Reads one page of the teacher directory (scoped by the server to what the caller may see). */
    static async getPage(query: TeacherDirectoryQuery): Promise<TeacherDirectoryPage> {
        const params = new URLSearchParams({
            limit: String(query.perPage),
            offset: String((query.page - 1) * query.perPage),
            sort: `${query.descending ? '-' : ''}${query.sort}`,
            status: query.status,
        })
        if (query.search.trim()) params.set('search', query.search.trim())
        const response = await apiV1Client.get<{ teachers: TeacherDirectoryItem[]; statistics: Partial<TeacherDirectoryStatistics> }>(`/pages/teachers/overview?${params}`)
        return {
            items: response.data?.teachers ?? [],
            statistics: { ...EMPTY_STATISTICS, ...(response.data?.statistics ?? {}) },
            total: Number(response.meta?.total ?? response.data?.teachers?.length ?? 0),
        }
    }

    /** Reads the class assignments of a teacher. */
    static async getAssignments(teacherId: string): Promise<TeacherAssignmentDTO[]> {
        return (await apiV1Client.get<TeacherAssignmentDTO[]>(`/pages/teachers/${encodeURIComponent(teacherId)}/assignments`)).data ?? []
    }

    /** Archives or restores a teacher. Archiving fails with TEACHER_HAS_ACTIVE_ASSIGNMENTS while classes remain. */
    static async setArchived(teacherId: string, archived: boolean): Promise<void> {
        await apiV1Client.patch(`/teachers/${encodeURIComponent(teacherId)}/archive`, { archived })
    }
}
