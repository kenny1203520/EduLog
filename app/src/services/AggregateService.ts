import { apiV1Client } from '@/services/api/ApiV1Client'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { StudentService } from '@/services/student/StudentService'

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
    return this.withCache('user_preferences', this.DEFAULT_TTL_MS, async () =>
      (await apiV1Client.get<UserPreferencesAggregate>('/pages/me/preferences')).data,
    )
  }

  static async getReportsByEnrollmentAggregate(enrollmentId: string, page: number = 1, perPage: number = 50): Promise<{ enrollment: any, reports: any[], count: number }> {
    return this.withCache(`reports_enrollment:${enrollmentId}:p${page}:s${perPage}`, this.DEFAULT_TTL_MS, async () => {
      const offset = Math.max(0, (page - 1) * perPage)
      const query = new URLSearchParams({ limit: String(perPage), offset: String(offset), sort: '-updated_at' })
      const response = await apiV1Client.get<{ enrollment: any, reports: any[], count: number }>(`/pages/enrollments/${encodeURIComponent(enrollmentId)}/reports?${query}`)
      return { enrollment: response.data?.enrollment ?? null, reports: response.data?.reports ?? [], count: Number(response.meta?.total ?? response.data?.count ?? 0) }
    })
  }

  static async getClassroomSessionManagerAggregate(page: number = 1, perPage: number = 100, search: string = '', visibilityMode: string = 'all') {
    const query = new URLSearchParams({ limit: String(perPage), offset: String(Math.max(0, (page - 1) * perPage)), search, visibility: visibilityMode })
    return (await apiV1Client.get<any>(`/pages/classrooms/overview?${query}`)).data
  }

  static async getDashboardHome(start?: string, end?: string, forceRefresh: boolean = false) {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    const key = `dashboard:${start ?? ''}:${end ?? ''}`
    if (forceRefresh) this.clearCache(key)
    return this.withCache(key, this.DEFAULT_TTL_MS, async () => (await apiV1Client.get<any>('/pages/dashboard?' + params.toString(), forceRefresh ? { cache: 'no-store' } : undefined)).data)
  }

  static async getIncompleteReportsAggregate(daysBack: number = 90, scope: 'all' | 'my_present' | 'my_notifications' = 'all') {
    // request.cache = 'no-store'
    const params = new URLSearchParams({ days_back: String(daysBack), scope, limit: '100', offset: '0' })
    const fetchReports = async () => (await apiV1Client.get<any>('/pages/reports/incomplete?' + params.toString(), scope === 'my_notifications' ? { cache: 'no-store' } : undefined)).data
    if (scope === 'my_notifications') return fetchReports()
    const response = await apiV1Client.get<any>('/pages/reports/incomplete?' + params.toString())
    return response.data
  }

  static async getHolidaysAggregate(expandNames: boolean = true) {
    return (await apiV1Client.get<any>('/pages/holidays/overview?expand=' + String(expandNames))).data
  }

  static async getCoursesCached(page: number = 1, perPage: number = 100) {
    return this.withCache(`courses:p${page}:s${perPage}`, this.MEDIUM_TTL_MS, () => CourseCatalogService.getCourses(page, perPage))
  }

  static async getStudentsCountCached(): Promise<number> {
    return this.withCache('students:count', this.MEDIUM_TTL_MS, async () => (await StudentService.getAll(1, 1)).count || 0)
  }
}
