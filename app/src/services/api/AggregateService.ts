import { MAX_PAGE_SIZE, normalizePageSize, PageApiService } from '@/services/api/PageApiService'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { StudentService } from '@/services/student/StudentService'

export interface UserPreferencesAggregate {
  preferences: {
    id?: string
    user_id?: string
    time_zone?: string
    editor_settings?: import('@/components/text-editor/settings').EditorUserSettings
    created_at?: string
    updated_at?: string
  } | null
  visibility: Record<string, string[]>
}

export class AggregateService {
  private static _cache: Map<string, { expiresAt: number, data?: any, promise?: Promise<any> }> = new Map()
  private static cacheInvalidationListenerInstalled = false
  // Private in-memory cache only.  It is deliberately short lived and is
  // cleared on sign-out; HTTP responses themselves remain `private, no-store`.
  private static DEFAULT_TTL_MS = 10 * 1000
  private static MEDIUM_TTL_MS = 10 * 1000

  private static async withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    this.installCacheInvalidationListener()
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

  private static installCacheInvalidationListener() {
    if (this.cacheInvalidationListenerInstalled || typeof window === 'undefined') return
    window.addEventListener('edulog:api-mutation', () => this.clearCache())
    this.cacheInvalidationListenerInstalled = true
  }

  static async getUserPreferencesAggregate(): Promise<UserPreferencesAggregate> {
    return this.withCache('user_preferences', this.DEFAULT_TTL_MS, async () =>
      (await PageApiService.getUserPreferences()).data as UserPreferencesAggregate,
    )
  }

  static async getReportsByEnrollmentAggregate(enrollmentId: string, page: number = 1, perPage: number = 50): Promise<{ enrollment: any, reports: any[], count: number }> {
    return this.withCache(`reports_enrollment:${enrollmentId}:p${page}:s${perPage}`, this.DEFAULT_TTL_MS, async () => {
      const offset = Math.max(0, (page - 1) * perPage)
      const response = await PageApiService.getEnrollmentReports(enrollmentId, { limit: perPage, offset, sort: '-updated_at' })
      return { enrollment: response.data?.enrollment ?? null, reports: response.data?.reports ?? [], count: Number(response.meta?.total ?? response.data?.count ?? 0) }
    })
  }

  static async getClassroomSessionManagerAggregate(page: number = 1, perPage: number = 100, search: string = '', visibilityMode: string = 'all') {
    const pageSize = normalizePageSize(perPage)
    const pageNumber = Math.max(1, Math.trunc(page))
    const key = `classrooms:p${pageNumber}:s${pageSize}:q${search}:v${visibilityMode}`
    return this.withCache(key, this.DEFAULT_TTL_MS, async () =>
      (await PageApiService.getClassroomsOverview({ limit: pageSize, offset: (pageNumber - 1) * pageSize, search, visibility: visibilityMode })).data,
    )
  }

  static async getAllClassroomsOverview(search: string = '', visibilityMode: string = 'all') {
    const pageSize = MAX_PAGE_SIZE
    const first = await PageApiService.getClassroomsOverview({ limit: pageSize, offset: 0, search, visibility: visibilityMode, session_limit: 1 })
    const classrooms = [...first.data.classrooms]
    const total = Number(first.meta?.total ?? first.data.count ?? classrooms.length)
    for (let offset = pageSize; offset < total; offset += pageSize) {
      const page = await PageApiService.getClassroomsOverview({ limit: pageSize, offset, search, visibility: visibilityMode, session_limit: 1 })
      classrooms.push(...page.data.classrooms)
    }
    return { ...first.data, classrooms, count: total }
  }

  static async getClassSessionsOverview(page: number = 1, perPage: number = 100, search: string = '', classroomId?: string | null, visibilityMode: string = 'all') {
    const key = `sessions:p${page}:s${perPage}:q${search}:c${classroomId ?? ''}:v${visibilityMode}`
    return this.withCache(key, this.DEFAULT_TTL_MS, async () => {
      const response = await PageApiService.getClassroomsOverview({
        limit: 1,
        offset: 0,
        visibility: visibilityMode,
        search,
        session_limit: perPage,
        session_offset: Math.max(0, (page - 1) * perPage),
        classroom_id: classroomId || undefined,
      })
      return { data: response.data.classSessions, count: response.data.sessionCount, hiddenSessionIds: response.data.hiddenSessionIds }
    })
  }

  static async getAllClassSessionsOverview(search: string = '', classroomId?: string | null, visibilityMode: string = 'all') {
    const pageSize = MAX_PAGE_SIZE
    const first = await this.getClassSessionsOverview(1, pageSize, search, classroomId, visibilityMode)
    const sessions = [...first.data]
    for (let offset = pageSize; offset < first.count; offset += pageSize) {
      const page = await this.getClassSessionsOverview(offset / pageSize + 1, pageSize, search, classroomId, visibilityMode)
      sessions.push(...page.data)
    }
    return { data: sessions, count: first.count, hiddenSessionIds: first.hiddenSessionIds }
  }

  static async getAllTeachersOverview(search: string = '') {
    const pageSize = 100
    const first = await PageApiService.getTeachersOverview({ limit: pageSize, offset: 0, search, sort: 'name' })
    const teachers = [...first.data.teachers]
    const total = Number(first.meta?.total ?? teachers.length)
    for (let offset = pageSize; offset < total; offset += pageSize) {
      const page = await PageApiService.getTeachersOverview({ limit: pageSize, offset, search, sort: 'name' })
      teachers.push(...page.data.teachers)
    }
    return teachers
  }

  static async getDashboardHome(start?: string, end?: string, forceRefresh: boolean = false) {
    const key = `dashboard:${start ?? ''}:${end ?? ''}`
    if (forceRefresh) this.clearCache(key)
    return this.withCache(key, this.DEFAULT_TTL_MS, async () => (await PageApiService.getDashboard({ start, end, cache: forceRefresh ? 'no-store' : undefined })).data)
  }

  static async getIncompleteReportsAggregate(daysBack: number = 90, scope: 'all' | 'my_present' | 'my_notifications' = 'all') {
    // request.cache = 'no-store'
    const fetchReports = async () => (await PageApiService.getIncompleteReports({ days_back: daysBack, scope, limit: 100, offset: 0, cache: scope === 'my_notifications' ? 'no-store' : undefined })).data
    if (scope === 'my_notifications') return fetchReports()
    return fetchReports()
  }

  static async getHolidaysAggregate(expandNames: boolean = true) {
    const pageSize = 100
    const first = await PageApiService.getHolidaysOverview({ expand: expandNames, limit: pageSize, offset: 0 })
    const holidays = [...first.data]
    const total = Number(first.meta?.total ?? holidays.length)
    for (let offset = pageSize; offset < total; offset += pageSize) {
      const page = await PageApiService.getHolidaysOverview({ expand: expandNames, limit: pageSize, offset })
      holidays.push(...page.data)
    }
    return holidays
  }

  static async getCoursesCached(page: number = 1, perPage: number = 100) {
    return this.withCache(`courses:p${page}:s${perPage}`, this.MEDIUM_TTL_MS, () => CourseCatalogService.getCourses(page, perPage))
  }

  static async getStudentsCountCached(): Promise<number> {
    return this.withCache('students:count', this.MEDIUM_TTL_MS, async () => (await StudentService.getAll(1, 1)).count || 0)
  }
}
