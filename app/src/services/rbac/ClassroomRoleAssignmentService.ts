import type { RoleDTO } from '@/models/Rbac'
import { apiV1Client } from '@/services/api/ApiV1Client'

export interface ClassroomRoleAssignmentDTO {
    id: string
    user_id: string
    role_id: string
    scope_type: 'classroom'
    scope_id: string
    effective_from: string
    effective_to: string | null
    created_at: string
    updated_at: string
    roles?: Pick<RoleDTO, 'id' | 'code' | 'name' | 'domain' | 'is_builtin'> | null
    user?: { id: string; display_name: string | null; email: string | null } | null
}

export interface ClassroomRoleAssignmentInput {
    user_id: string
    role_id: string
    effective_from: string
    effective_to: string | null
    expected_epoch: number
}

export class ClassroomRoleAssignmentService {
    static async list(classroomId: string, page = 1, perPage = 100): Promise<{ data: ClassroomRoleAssignmentDTO[]; total: number; canListUsers: boolean }> {
        const offset = Math.max(0, (page - 1) * perPage)
        const response = await apiV1Client.get<ClassroomRoleAssignmentDTO[]>(
            `/classrooms/${encodeURIComponent(classroomId)}/role-assignments?limit=${perPage}&offset=${offset}`
        )
        return {
            data: response.data ?? [],
            total: Number(response.meta?.total ?? response.data?.length ?? 0),
            canListUsers: response.meta?.can_list_users === true,
        }
    }

    static async create(classroomId: string, input: ClassroomRoleAssignmentInput): Promise<void> {
        await apiV1Client.post(`/classrooms/${encodeURIComponent(classroomId)}/role-assignments`, input)
    }

    static async update(classroomId: string, assignmentId: string, input: ClassroomRoleAssignmentInput): Promise<void> {
        await apiV1Client.patch(`/classrooms/${encodeURIComponent(classroomId)}/role-assignments/${encodeURIComponent(assignmentId)}`, input)
    }

    static async delete(classroomId: string, assignmentId: string, expectedEpoch: number): Promise<void> {
        await apiV1Client.delete(
            `/classrooms/${encodeURIComponent(classroomId)}/role-assignments/${encodeURIComponent(assignmentId)}`,
            { expected_epoch: expectedEpoch }
        )
    }
}
