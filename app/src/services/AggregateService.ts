import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { StudentService } from '@/services/student/StudentService'
import { apiDataClient } from '@/services/api/ApiDataClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

export interface UserPreferencesAggregate {
  preferences: {
    id?: string
    user_id?: string
    time_zone?: string
    editor_settings?: import('@/components/common/text-editor/settings').EditorUserSettings
    created_at?: string
    updated_at?: string
  } | null
  visibility: Record<string, string[]>
}

export class AggregateService {
  private static _cache: Map<string, { expiresAt: number, data?: any, promise?: Promise<any> }> = new Map()
  private static DEFAULT_TTL_MS = 30 * 1000
  private static MEDIUM_TTL_MS = 60 * 1000

  private static async withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const entry = this._cache.get(key)
    if (entry?.data !== undefined && entry.expiresAt > now) return entry.data as T
    if (entry?.promise) return entry.promise as Promise<T>
    const promise = fn().then((data) => {
      this._cache.set(key, { expiresAt: Date.now() + ttlMs, data })
      return data
    }).catch((error) => {
      this._cache.delete(key)
      throw error
    })
    this._cache.set(key, { expiresAt: Date.now() + ttlMs, promise })
    return promise
  }

  static clearCache(key?: string) { if (key) this._cache.delete(key); else this._cache.clear() }

  static async getUserPreferencesAggregate(): Promise<UserPreferencesAggregate> {
    return this.withCache('user_preferences', this.DEFAULT_TTL_MS, async () => {
      if (getApiV1Mode() === 'mock') {
        const session = await (apiDataClient.auth as any).getSession?.()
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (session?.data?.session?.access_token) headers.Authorization = `Bearer ${session.data.session.access_token}`
        const response = await fetch('/api/aggregates/user-preferences', { headers })
        if (!response.ok) throw new Error(`AggregateService error: ${response.status} ${await response.text()}`)
        const body = await response.json()
        return body.data ?? body
      }
      const [preferences, visibility] = await Promise.all([
        apiResourceClient.get<any>('user-preferences', 'me'),
        apiResourceClient.list<any>('visibility-preferences', { perPage: 100 })
      ])
      const grouped: Record<string, string[]> = { classroom: [], class_session: [] }
      for (const row of visibility.data ?? []) (grouped[row.entity_type] ??= []).push(row.entity_id)
      return { preferences: preferences.data ?? null, visibility: grouped }
    })
  }

  static async getReportsByEnrollmentAggregate(enrollmentId: string, page: number = 1, perPage: number = 50): Promise<{ enrollment: any, reports: any[], count: number }> {
    return this.withCache(`reports_enrollment:${enrollmentId}:p${page}:s${perPage}`, this.DEFAULT_TTL_MS, async () => {
      const [enrollment, reports] = await Promise.all([
        apiResourceClient.get<any>('enrollments', enrollmentId),
        apiResourceClient.list<any>('reports', { enrollmentId, page, perPage, sort: '-updated_at' })
      ])
      return { enrollment: enrollment.data, reports: reports.data ?? [], count: reports.meta?.total ?? reports.data?.length ?? 0 }
    })
  }

  static async getClassroomSessionManagerAggregate(page: number = 1, perPage: number = 100, search: string = '', visibilityMode: string = 'all') {
    const [classrooms, visibility] = await Promise.all([
      apiResourceClient.list<any>('classrooms', { page, perPage, search, sort: 'name' }),
      apiResourceClient.list<any>('visibility-preferences', { perPage: 100 })
    ])
    const hiddenClassroomIds = new Set((visibility.data ?? []).filter((row) => row.entity_type === 'classroom' && row.is_hidden).map((row) => row.entity_id))
    const hiddenSessionIds = (visibility.data ?? []).filter((row) => row.entity_type === 'class_session' && row.is_hidden).map((row) => row.entity_id)
    const filtered = (classrooms.data ?? []).filter((row) => visibilityMode === 'all' || (visibilityMode === 'hidden' ? hiddenClassroomIds.has(row.id) : !hiddenClassroomIds.has(row.id)))
    return { classrooms: filtered, count: classrooms.meta?.total ?? filtered.length, hiddenClassroomIds: [...hiddenClassroomIds], hiddenSessionIds }
  }

  static async getDashboardHome(start?: string, end?: string, forceRefresh: boolean = false) {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    const key = `dashboard:${start ?? ''}:${end ?? ''}`
    if (forceRefresh) this.clearCache(key)
    return this.withCache(key, this.DEFAULT_TTL_MS, async () => (await apiV1Client.get<any>('/aggregates/dashboard?' + params.toString(), forceRefresh ? { cache: 'no-store' } : undefined)).data)
  }

  static async getIncompleteReportsAggregate(daysBack: number = 90, scope: 'all' | 'my_present' | 'my_notifications' = 'all') {
    // request.cache = 'no-store'
    const fetchReports = async () => (await apiV1Client.get<any>('/aggregates/incomplete-reports?daysBack=' + encodeURIComponent(String(daysBack)) + '&scope=' + encodeURIComponent(scope), scope === 'my_notifications' ? { cache: 'no-store' } : undefined)).data
    if (scope === 'my_notifications') return fetchReports()
    const response = await apiV1Client.get<any>('/aggregates/incomplete-reports?daysBack=' + encodeURIComponent(String(daysBack)) + '&scope=' + encodeURIComponent(scope))
    return response.data
  }

  static async getHolidaysAggregate(expandNames: boolean = true) {
    return (await apiV1Client.get<any>('/aggregates/holidays-manager?expand=' + String(expandNames))).data
  }

  static async getCoursesCached(page: number = 1, perPage: number = 100) {
    return this.withCache(`courses:p${page}:s${perPage}`, this.MEDIUM_TTL_MS, () => CourseCatalogService.getCourses(page, perPage))
  }

  static async getStudentsCountCached(): Promise<number> {
    return this.withCache('students:count', this.MEDIUM_TTL_MS, async () => (await StudentService.getAll(1, 1)).count || 0)
  }
}