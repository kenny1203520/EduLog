import { supabase } from '@/lib/supabase'
import { getRuntimeConfigValue } from '@/lib/runtimeConfig'
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
  private static DEFAULT_TTL_MS = 30 * 1000 // 30 seconds
  private static MEDIUM_TTL_MS = 60 * 1000 // 60 seconds for catalog/counts

  private static getFunctionsBaseUrl(): string {
    const configuredBaseUrl = getRuntimeConfigValue('VITE_SUPABASE_FUNCTIONS_BASE_URL')
    if (configuredBaseUrl) {
      return configuredBaseUrl
    }
    const supabaseUrl = getRuntimeConfigValue('VITE_SUPABASE_URL')
    if (supabaseUrl) {
      const cleanUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl
      return `${cleanUrl}/functions/v1`
    }
    return ''
  }

  private static async withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const entry = this._cache.get(key)
    if (entry) {
      if (entry.data !== undefined && entry.expiresAt > now) {
        return entry.data as T
      }
      if (entry.promise) {
        return entry.promise as Promise<T>
      }
    }

    const p = (async () => {
      try {
        const result = await fn()
        this._cache.set(key, { expiresAt: Date.now() + ttlMs, data: result })
        return result
      } catch (e) {
        // remove promise on error so next call will retry
        this._cache.delete(key)
        throw e
      }
    })()

    this._cache.set(key, { expiresAt: Date.now() + ttlMs, promise: p })
    return p
  }

  static clearCache(key?: string) {
    if (key) this._cache.delete(key)
    else this._cache.clear()
  }

  static async getUserPreferencesAggregate(): Promise<UserPreferencesAggregate> {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const url = base ? `${base}/aggregate-user-preferences` : '/aggregate-user-preferences'

    return this.withCache(`user_prefs:${token || 'anon'}`, this.DEFAULT_TTL_MS, async () => {
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      const data = await resp.json()
      return data as UserPreferencesAggregate
    })
  }

  static async getReportsByEnrollmentAggregate(enrollmentId: string, page: number = 1, perPage: number = 50): Promise<{ enrollment: any, reports: any[], count: number }> {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const url = base ? `${base}/aggregate-student-reports?enrollment_id=${encodeURIComponent(enrollmentId)}&page=${page}&perPage=${perPage}` : `/aggregate-student-reports?enrollment_id=${encodeURIComponent(enrollmentId)}&page=${page}&perPage=${perPage}`

    const cacheKey = `reports_enrollment:${enrollmentId}:p${page}:s${perPage}`
    return this.withCache(cacheKey, this.DEFAULT_TTL_MS, async () => {
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      const data = await resp.json()
      return data as { enrollment: any, reports: any[], count: number }
    })
  }

  static async getClassroomSessionManagerAggregate(page: number = 1, perPage: number = 100, search: string = '', visibilityMode: string = 'all') {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const qs = `page=${page}&perPage=${perPage}&search=${encodeURIComponent(search)}&visibilityMode=${encodeURIComponent(visibilityMode)}`
    const url = base ? `${base}/aggregate-classroom-session-manager?${qs}` : `/aggregate-classroom-session-manager?${qs}`

    const cacheKey = `classroom_manager:p${page}:s${perPage}:q${search}:v${visibilityMode}:t${token || 'anon'}`
    return this.withCache(cacheKey, this.DEFAULT_TTL_MS, async () => {
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      const data = await resp.json()
      return data as { classrooms: any[], count: number, hiddenClassroomIds?: string[], hiddenSessionIds?: string[] }
    })
  }

  static async getDashboardHome(start?: string, end?: string, forceRefresh: boolean = false) {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const qs = []
    if (start) qs.push(`start=${encodeURIComponent(start)}`)
    if (end) qs.push(`end=${encodeURIComponent(end)}`)
    const url = base ? `${base}/dashboard${qs.length ? `?${qs.join('&')}` : ''}` : `/dashboard${qs.length ? `?${qs.join('&')}` : ''}`

    const cacheKey = `dashboard_home:${start || 'none'}:${end || 'none'}:t${token || 'anon'}`
    if (forceRefresh) {
      // Remove any cached entry and perform a fetch that forces validation
      this.clearCache(cacheKey)
      const resp = await fetch(url, { method: 'GET', headers, cache: 'no-cache' as RequestCache })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      return resp.json()
    }

    return this.withCache(cacheKey, this.DEFAULT_TTL_MS, async () => {
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      return resp.json()
    })
  }

  static async getIncompleteReportsAggregate(daysBack: number = 90, scope: 'all' | 'my_present' | 'my_notifications' = 'all') {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const qs = `daysBack=${daysBack}&scope=${encodeURIComponent(scope)}`
    const url = base ? `${base}/aggregate-incomplete-reports?${qs}` : `/aggregate-incomplete-reports?${qs}`

    const fetchReports = async () => {
      const request: RequestInit = { method: 'GET', headers }
      if (scope === 'my_notifications') request.cache = 'no-store'

      const resp = await fetch(url, request)
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      return resp.json()
    }

    // Notification visibility is authorization-sensitive and can change immediately
    // when a class role or policy is edited. Never reuse a previous decision.
    if (scope === 'my_notifications') return fetchReports()

    const cacheKey = `incomplete_reports:back${daysBack}:scope${scope}:t${token || 'anon'}`
    return this.withCache(cacheKey, this.DEFAULT_TTL_MS, fetchReports)
  }

  static async getHolidaysAggregate(expandNames: boolean = true) {
    const sessionRes = await supabase.auth.getSession()
    const token = sessionRes?.data?.session?.access_token

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const base = this.getFunctionsBaseUrl()
    const url = base ? `${base}/aggregate-holidays-manager?expand=${expandNames}` : `/aggregate-holidays-manager?expand=${expandNames}`

    const cacheKey = `holidays:expand${expandNames}:t${token || 'anon'}`
    return this.withCache(cacheKey, this.DEFAULT_TTL_MS, async () => {
      const resp = await fetch(url, { method: 'GET', headers })
      if (!resp.ok) {
        const txt = await resp.text()
        throw new Error(`AggregateService error: ${resp.status} ${txt}`)
      }
      return resp.json()
    })
  }

  // Cached wrapper for courses catalog to avoid repeated client-side supabase calls
  static async getCoursesCached(page: number = 1, perPage: number = 100) {
    const cacheKey = `courses:p${page}:s${perPage}`
    return this.withCache(cacheKey, this.MEDIUM_TTL_MS, async () => {
      return CourseCatalogService.getCourses(page, perPage)
    })
  }

  // Cached wrapper to fetch students count (returns numeric count)
  static async getStudentsCountCached(): Promise<number> {
    const cacheKey = `students:count`
    return this.withCache<number>(cacheKey, this.MEDIUM_TTL_MS, async () => {
      const res = await StudentService.getAll(1, 1)
      return (res && (res.count || 0)) as number
    })
  }
}
