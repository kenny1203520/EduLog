import { apiV1Client, ApiV1Error, type ApiEnvelope, type ApiV1Client } from './ApiV1Client'
import { AppError, AuthorizationError, ConflictError, NetworkError, ValidationError } from '../errors/AppError'

export type ApiCollectionMeta = {
  limit?: number
  offset?: number
  sort?: string
  total?: number
}

export type ApiCollection<T> = ApiEnvelope<T[]> & { meta?: ApiCollectionMeta | null }

export type ApiFilter = {
  field: string
  operator: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike' | 'contains' | 'is'
  value: unknown
}

export type ResourceListOptions = {
  page?: number
  perPage?: number
  search?: string
  sort?: string
  status?: string
  filters?: ApiFilter[]
  or?: string
  userId?: string
  courseId?: string
  lessonId?: string
  entityType?: string
  entityId?: string
  entityIds?: string[]
  classroomId?: string
  enrollmentId?: string
  studentId?: string
  instructorId?: string
  templateType?: string
  scopeType?: string
  scopeEntityId?: string
}

function queryString(options: ResourceListOptions = {}) {
  const params = new URLSearchParams()
  const perPage = Math.max(1, Math.min(options.perPage ?? 100, 100))
  const page = Math.max(1, options.page ?? 1)
  params.set('limit', String(perPage))
  params.set('offset', String((page - 1) * perPage))
  if (options.search?.trim()) params.set('search', options.search.trim())
  if (options.sort) params.set('sort', options.sort)
  if (options.status) params.set('status', options.status)
  if (options.filters?.length) params.set('filters', JSON.stringify(options.filters))
  if (options.or?.trim()) params.set('or', options.or.trim())
  if (options.userId) params.set('user_id', options.userId)
  if (options.courseId) params.set('course_id', options.courseId)
  if (options.lessonId) params.set('lesson_id', options.lessonId)
  if (options.entityType) params.set('entity_type', options.entityType)
  if (options.entityId) params.set('entity_id', options.entityId)
  if (options.entityIds?.length) params.set('entity_ids', options.entityIds.join(','))
  if (options.classroomId) params.set('classroom_id', options.classroomId)
  if (options.enrollmentId) params.set('enrollment_id', options.enrollmentId)
  if (options.studentId) params.set('student_id', options.studentId)
  if (options.instructorId) params.set('instructor_id', options.instructorId)
  if (options.templateType) params.set('template_type', options.templateType)
  if (options.scopeType) params.set('scope_type', options.scopeType)
  if (options.scopeEntityId) params.set('scope_entity_id', options.scopeEntityId)
  return params.toString()
}

export function mapApiError(error: unknown): Error {
  if (!(error instanceof ApiV1Error)) return error instanceof Error ? error : new NetworkError({ cause: error })
  if (error.status === 401 || error.status === 403) return new AuthorizationError({ message: error.message, cause: error })
  if (error.status === 409) return new ConflictError({ message: error.message, cause: error })
  if (error.status === 400 || error.status === 413 || error.status === 422) {
    return new ValidationError('errors.validation', { message: error.message, params: { code: error.code }, cause: error })
  }
  if (error.status >= 500 || error.status === 429) return new NetworkError({ message: error.message, cause: error })
  return new AppError('errors.unknown', { message: error.message, cause: error })
}

export class ApiResourceClient {
  private readonly client: Pick<ApiV1Client, 'get' | 'post' | 'patch' | 'delete'>

  constructor(client: Pick<ApiV1Client, 'get' | 'post' | 'patch' | 'delete'> = apiV1Client) {
    this.client = client
  }

  async list<T>(resource: string, options: ResourceListOptions = {}): Promise<ApiCollection<T>> {
    try {
      const query = queryString(options)
      return await this.client.get<T[]>(`/${resource}?${query}`) as ApiCollection<T>
    } catch (error) {
      throw mapApiError(error)
    }
  }

  async get<T>(resource: string, id: string): Promise<ApiEnvelope<T>> {
    try {
      return await this.client.get<T>(`/${resource}/${encodeURIComponent(id)}`)
    } catch (error) {
      throw mapApiError(error)
    }
  }

  async create<T>(resource: string, body: unknown): Promise<ApiEnvelope<T>> {
    try {
      return await this.client.post<T>(`/${resource}`, body)
    } catch (error) {
      throw mapApiError(error)
    }
  }

  async update<T>(resource: string, id: string, body: unknown): Promise<ApiEnvelope<T>> {
    try {
      return await this.client.patch<T>(`/${resource}/${encodeURIComponent(id)}`, body)
    } catch (error) {
      throw mapApiError(error)
    }
  }

  async remove<T>(resource: string, id: string): Promise<ApiEnvelope<T>> {
    try {
      return await this.client.delete<T>(`/${resource}/${encodeURIComponent(id)}`)
    } catch (error) {
      throw mapApiError(error)
    }
  }

}

export const apiResourceClient = new ApiResourceClient()
