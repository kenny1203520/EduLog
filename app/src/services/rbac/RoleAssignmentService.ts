import { apiV1Client, type ApiEnvelope } from '@/services/api/ApiV1Client'

export type RoleAssignmentPage<T> = { rows: T[]; total: number; canListUsers: boolean }
export type TeachingScope = { type: 'classroom' | 'class_session'; id: string }
export type RoleAssignmentInput = {
    user_id: string
    role_id: string
    effective_from: string
    effective_to: string | null
    expected_epoch: number | null
}

function toPage<T>(response: ApiEnvelope<T[]>): RoleAssignmentPage<T> {
    const meta = (response.meta ?? {}) as { total?: number; can_list_users?: boolean }
    return { rows: response.data ?? [], total: Number(meta.total ?? 0), canListUsers: meta.can_list_users === true }
}

function pageQuery(userId: string, page: number, perPage: number, extra: Record<string, string> = {}) {
    return new URLSearchParams({ ...extra, user_id: userId, limit: String(perPage), offset: String((page - 1) * perPage) })
}

const scopeQuery = (scope: TeachingScope) => `scope_type=${scope.type}&scope_id=${encodeURIComponent(scope.id)}`

/** System and teaching role assignments, including scoped teaching assignments and exclusions. */
export class RoleAssignmentService {
    static async listSystemAssignments<T>(userId: string, page: number, perPage: number): Promise<RoleAssignmentPage<T>> {
        const params = pageQuery(userId, page, perPage)
        params.set('sort', '-effective_from')
        return toPage(await apiV1Client.get<T[]>(`/system-role-assignments?${params}`))
    }

    static async createSystemAssignment(input: RoleAssignmentInput): Promise<void> {
        await apiV1Client.post('/system-role-assignments', input)
    }

    static async deleteSystemAssignment(id: string, expectedEpoch: number | null): Promise<void> {
        await apiV1Client.delete(`/system-role-assignments/${id}`, { expected_epoch: expectedEpoch })
    }

    static async listTeachingAssignments<T>(userId: string, page: number, perPage: number): Promise<RoleAssignmentPage<T>> {
        const params = pageQuery(userId, page, perPage)
        params.set('sort', '-effective_from')
        return toPage(await apiV1Client.get<T[]>(`/teaching-role-assignments?${params}`))
    }

    static async listScopedTeachingAssignments<T>(scope: TeachingScope, userId: string, page: number, perPage: number): Promise<RoleAssignmentPage<T>> {
        const params = pageQuery(userId, page, perPage, { scope_type: scope.type, scope_id: scope.id })
        return toPage(await apiV1Client.get<T[]>(`/teaching-role-assignments/scoped?${params}`))
    }

    static async listTeachingExclusions<T>(scope: TeachingScope, userId: string, page: number, perPage: number): Promise<RoleAssignmentPage<T>> {
        const params = pageQuery(userId, page, perPage, { scope_type: scope.type, scope_id: scope.id })
        return toPage(await apiV1Client.get<T[]>(`/teaching-role-exclusions?${params}`))
    }

    static async createTeachingAssignment(input: RoleAssignmentInput): Promise<void> {
        await apiV1Client.post('/teaching-role-assignments', input)
    }

    static async createScopedTeachingAssignment(scope: TeachingScope, input: RoleAssignmentInput): Promise<void> {
        await apiV1Client.post('/teaching-role-assignments/scoped', { ...input, scope_type: scope.type, scope_id: scope.id })
    }

    static async createTeachingExclusion(scope: TeachingScope, input: RoleAssignmentInput): Promise<void> {
        await apiV1Client.post(`/teaching-role-exclusions?${scopeQuery(scope)}`, input)
    }

    static async deleteTeachingAssignment(id: string, expectedEpoch: number | null): Promise<void> {
        await apiV1Client.delete(`/teaching-role-assignments/${id}`, { expected_epoch: expectedEpoch })
    }

    static async deleteScopedTeachingAssignment(id: string, scope: TeachingScope, expectedEpoch: number | null): Promise<void> {
        await apiV1Client.delete(`/teaching-role-assignments/scoped/${id}?${scopeQuery(scope)}`, { expected_epoch: expectedEpoch })
    }

    static async deleteTeachingExclusion(id: string, scope: TeachingScope, expectedEpoch: number | null): Promise<void> {
        await apiV1Client.delete(`/teaching-role-exclusions/${id}?${scopeQuery(scope)}`, { expected_epoch: expectedEpoch })
    }
}
