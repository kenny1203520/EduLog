import { apiV1Client, type ApiEnvelope } from './ApiV1Client'

type QueryFilter = { field: string; operator: string; value: unknown }
type QueryResult = { data: any; error: any; count?: number | null }

const tableToResource: Record<string, string> = {
  profiles: 'users', user_preferences: 'user-preferences', user_entity_visibility_preferences: 'visibility-preferences', roles: 'roles', permissions: 'permissions', audit_events: 'audit-events', teachings: 'teachings', teaching_members: 'teaching-members', courses: 'courses', lessons: 'lessons', classrooms: 'classrooms', classroom_schedules: 'classroom-schedules', class_sessions: 'class-sessions', class_session_schedule_rules: 'class-session-schedule-rules', students: 'students', student_contacts: 'student-contacts', student_schools: 'student-schools', student_credentials: 'student-credentials', teachers: 'teachers', teacher_credentials: 'teacher-credentials', class_session_teachers: 'class-session-teachers', enrollments: 'enrollments', class_occurrences: 'occurrences', occurrence_reports: 'reports', report_versions: 'report-versions', report_templates: 'report-templates', copy_templates: 'copy-templates', student_suspensions: 'student-suspensions', holidays: 'holidays',
}
function resourceFor(table: string) { return tableToResource[table] ?? table.replaceAll('_', '-') }
function toError(error: unknown) { return error instanceof Error ? { message: error.message } : { message: String(error) } }

class ApiQuery implements PromiseLike<QueryResult> {
  private readonly resource: string
  private readonly filters: QueryFilter[] = []
  private sort?: string
  private limitValue?: number
  private operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: any
  private expectSingle = false
  private allowMissing = false
  constructor(table: string) { this.resource = resourceFor(table) }
  select(..._columns: unknown[]) { this.operation = 'select'; return this }
  insert(payload: unknown, ..._options: unknown[]) { this.operation = 'insert'; this.payload = payload; return this }
  update(payload: unknown, ..._options: unknown[]) { this.operation = 'update'; this.payload = payload; return this }
  upsert(payload: unknown, ..._options: unknown[]) { this.operation = 'upsert'; this.payload = payload; return this }
  delete(..._options: unknown[]) { this.operation = 'delete'; return this }
  eq(field: string, value: unknown) { this.filters.push({ field, operator: 'eq', value }); return this }
  neq(field: string, value: unknown) { this.filters.push({ field, operator: 'neq', value }); return this }
  in(field: string, value: unknown[]) { this.filters.push({ field, operator: 'in', value }); return this }
  gte(field: string, value: unknown) { this.filters.push({ field, operator: 'gte', value }); return this }
  lte(field: string, value: unknown) { this.filters.push({ field, operator: 'lte', value }); return this }
  gt(field: string, value: unknown) { this.filters.push({ field, operator: 'gt', value }); return this }
  lt(field: string, value: unknown) { this.filters.push({ field, operator: 'lt', value }); return this }
  ilike(field: string, value: unknown) { return this.eq(field, value) }
  not(field: string, operator: string, value: unknown) { this.filters.push({ field, operator: operator === 'is' ? 'neq' : operator, value }); return this }
  contains(field: string, value: unknown) { return this.eq(field, value) }
  or(..._args: unknown[]) { return this }
  filter(..._args: unknown[]) { return this }
  order(field: string, options: { ascending?: boolean; foreignTable?: string } = {}, ..._rest: unknown[]) { this.sort = `${options.ascending === false ? '-' : ''}${field}`; return this }
  limit(value: number) { this.limitValue = value; return this }
  range(from: number, to: number) { this.limitValue = Math.max(1, to - from + 1); return this }
  single() { this.expectSingle = true; this.allowMissing = false; return this }
  maybeSingle() { this.expectSingle = true; this.allowMissing = true; return this }
  private applyClientFilters(rows: any[]) { return rows.filter((row) => this.filters.every(({ field, operator, value }) => { const actual = row?.[field]; if (operator === 'eq') return actual === value; if (operator === 'neq') return actual !== value; if (operator === 'in') return Array.isArray(value) && value.includes(actual); if (operator === 'gte') return (actual as any) >= (value as any); if (operator === 'lte') return (actual as any) <= (value as any); if (operator === 'gt') return (actual as any) > (value as any); if (operator === 'lt') return (actual as any) < (value as any); return true })) }
  async execute(): Promise<QueryResult> {
    try {
      const idFilter = this.filters.find((filter) => filter.field === 'id' || (this.resource === 'user-preferences' && filter.field === 'user_id'))
      let response: ApiEnvelope<any>
      if (this.operation === 'select') {
        if (idFilter && this.filters.length === 1) response = await apiV1Client.get(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`)
        else { const query = new URLSearchParams({ limit: String(this.limitValue ?? 100), offset: '0' }); if (this.sort) query.set('sort', this.sort); if (this.filters.length) query.set('filters', JSON.stringify(this.filters)); response = await apiV1Client.get(`/${this.resource}?${query.toString()}`) }
        const rows = Array.isArray(response.data) ? this.applyClientFilters(response.data) : response.data == null ? [] : [response.data]; const data = this.expectSingle ? (rows[0] ?? null) : rows; if (this.expectSingle && data == null && !this.allowMissing) return { data: null, error: { message: 'No rows found' } }; return { data, error: null, count: rows.length }
      }
      const body = Array.isArray(this.payload) ? this.payload[0] : this.payload
      const idInFilter = this.filters.find((filter) => filter.field === 'id' && filter.operator === 'in')
      if (idInFilter && Array.isArray(idInFilter.value)) {
        const rows: unknown[] = []
        for (const id of idInFilter.value) {
          const result = this.operation === 'delete'
            ? await apiV1Client.delete(`/${this.resource}/${encodeURIComponent(String(id))}`)
            : await apiV1Client.patch(`/${this.resource}/${encodeURIComponent(String(id))}`, body)
          rows.push(result.data)
        }
        return { data: rows, error: null, count: rows.length }
      }
      if (this.operation === 'insert' || this.operation === 'upsert') response = await apiV1Client.post(`/${this.resource}`, body)
      else if (this.operation === 'update') { if (!idFilter) throw new Error('API update requires an id filter'); response = await apiV1Client.patch(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`, body) }
      else { if (!idFilter) throw new Error('API delete requires an id filter'); response = await apiV1Client.delete(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`) }
      const data = Array.isArray(this.payload) ? (response.data == null ? [] : [response.data]) : response.data; return { data, error: null, count: Array.isArray(data) ? data.length : null }
    } catch (error) { return { data: null, error: toError(error), count: null } }
  }
  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return this.execute().then(onfulfilled as any, onrejected as any) }
}

export const apiDataClient = {
  from(table: string) { return new ApiQuery(table) },
  auth: { async getUser() { try { const response = await apiV1Client.get<any>('/auth/me'); return { data: { user: response.data }, error: null } } catch (error) { return { data: { user: null }, error: toError(error) } } }, async getSession() { return { data: { session: null }, error: null } } },
  async rpc<T = any>(name: string, args: Record<string, unknown> = {}) { try { const response = await apiV1Client.post<T>(`/rpc/${encodeURIComponent(name)}`, args); return { data: response.data, error: null } } catch (error) { return { data: null, error: toError(error) } } },
}
