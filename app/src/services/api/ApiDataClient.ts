import { apiV1Client, type ApiEnvelope } from './ApiV1Client'

type QueryFilter = { field: string; operator: 'eq' | 'neq' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike' | 'contains' | 'is'; value: unknown }
type QueryResult = { data: any; error: any; count?: number | null }

const tableToResource: Record<string, string> = {
  profiles: 'users', user_preferences: 'user-preferences', user_entity_visibility_preferences: 'visibility-preferences', roles: 'roles', permissions: 'permissions', audit_events: 'audit-events', teachings: 'teachings', teaching_members: 'teaching-members', courses: 'courses', lessons: 'lessons', classrooms: 'classrooms', classroom_schedules: 'classroom-schedules', class_sessions: 'class-sessions', class_session_schedule_rules: 'class-session-schedule-rules', students: 'students', student_contacts: 'student-contacts', student_schools: 'student-schools', student_credentials: 'student-credentials', teachers: 'teachers', teacher_credentials: 'teacher-credentials', class_session_teachers: 'class-session-teachers', enrollments: 'enrollments', class_occurrences: 'occurrences', occurrence_reports: 'reports', report_versions: 'report-versions', report_templates: 'report-templates', copy_templates: 'copy-templates', student_suspensions: 'student-suspensions', holidays: 'holidays',
}
function resourceFor(table: string) { return tableToResource[table] ?? table.replaceAll('_', '-') }
function toError(error: unknown) { return error instanceof Error ? { message: error.message } : { message: String(error) } }
function stringArg(args: Record<string, unknown>, key: string) {
  return typeof args[key] === 'string' ? args[key] as string : null
}

async function invokeCanonicalRpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T; error: null } | null> {
  const occurrenceId = stringArg(args, 'p_occurrence_id')
  if (name === 'get_effective_occurrence_enrollment_ids' && occurrenceId) {
    const response = await apiV1Client.get<string[]>(`/occurrences/${encodeURIComponent(occurrenceId)}/roster`)
    return { data: response.data as T, error: null }
  }

  const enrollmentId = stringArg(args, 'p_enrollment_id')
  if (name === 'get_single_lesson_transfer_history' && enrollmentId) {
    const response = await apiV1Client.get<T>(`/enrollments/${encodeURIComponent(enrollmentId)}/transfer-history`)
    return { data: response.data, error: null }
  }
  if (name === 'get_effective_single_lesson_transfer_targets' && enrollmentId) {
    const response = await apiV1Client.get<T>(`/enrollments/${encodeURIComponent(enrollmentId)}/effective-transfer-targets`)
    return { data: response.data, error: null }
  }
  if (name === 'repair_single_lesson_transfer_report' && enrollmentId) {
    const response = await apiV1Client.post<T>(`/enrollments/${encodeURIComponent(enrollmentId)}/repair-transfer-report`, {
      target_occurrence_id: stringArg(args, 'p_target_occurrence_id'),
    })
    const data = (response.data as any)?.report_id ?? response.data
    return { data, error: null }
  }
  if (name === 'transfer_single_lesson') {
    const response = await apiV1Client.post<T>('/enrollment-transfers/single-lesson', {
      enrollment_id: stringArg(args, 'p_enrollment_id'),
      source_occurrence_id: stringArg(args, 'p_source_occurrence_id'),
      target_occurrence_id: stringArg(args, 'p_target_occurrence_id'),
      report_id: stringArg(args, 'p_report_id'),
    })
    const data = (response.data as any)?.transfer_id ?? response.data
    return { data, error: null }
  }
  if (name === 'resolve_single_lesson_transfer_conflict') {
    const response = await apiV1Client.post<T>('/enrollment-transfers/conflicts/resolve', {
      enrollment_id: stringArg(args, 'p_enrollment_id'),
      source_occurrence_id: stringArg(args, 'p_source_occurrence_id'),
      target_occurrence_id: stringArg(args, 'p_target_occurrence_id'),
      source_report_id: stringArg(args, 'p_source_report_id'),
      source_version: args.p_source_version ?? null,
      target_report_id: stringArg(args, 'p_target_report_id'),
      target_version: args.p_target_version,
      field_sources: args.p_field_sources,
    })
    const data = (response.data as any)?.transfer_id ?? response.data
    return { data, error: null }
  }
  if (name === 'cancel_single_lesson_transfer') {
    const response = await apiV1Client.post<T>('/enrollment-transfers/cancel', { transfer_id: stringArg(args, 'p_transfer_id') })
    return { data: response.data, error: null }
  }
  if (name === 'save_report_collab_snapshot') {
    const id = occurrenceId
    if (!id) return null
    const response = await apiV1Client.post<T>(`/reports/${encodeURIComponent(id)}/collaboration`, {
      snapshot_base64: stringArg(args, 'p_snapshot_base64'),
      base_report_version: args.p_base_report_version,
    })
    const data = (response.data as any)?.saved ?? response.data
    return { data, error: null }
  }
  if (name === 'save_class_session_with_schedule') {
    const session = args.p_session && typeof args.p_session === 'object' ? args.p_session as Record<string, unknown> : {}
    const rules = Array.isArray(args.p_rules) ? args.p_rules : []
    const id = stringArg(args, 'p_session_id')
    const response = id
      ? await apiV1Client.patch<T>(`/class-sessions/${encodeURIComponent(id)}`, { ...session, schedule_rules: rules })
      : await apiV1Client.post<T>('/class-sessions', { ...session, schedule_rules: rules })
    const data = (response.data as any)?.id ?? response.data
    return { data, error: null }
  }
  if (name === 'resolve_user_permission') {
    const permission = stringArg(args, 'p_permission_key')
    if (!permission) return null
    const response = await apiV1Client.get<{ allowed: boolean }>(`/rbac/capability?permission=${encodeURIComponent(permission)}`)
    return { data: { is_allowed: response.data.allowed, is_denied: !response.data.allowed } as T, error: null }
  }
  if (name === 'replace_role_permission_policies') {
    const permissionKey = stringArg(args, 'p_permission_key')
    const scopeType = stringArg(args, 'p_scope_type')
    const policies = Array.isArray(args.p_policies) ? args.p_policies : null
    if (!permissionKey || !scopeType || !policies) return null
    const permissions = await apiV1Client.get<Array<{ id: string; key: string }>>(`/permissions?search=${encodeURIComponent(permissionKey)}&limit=100&offset=0&sort=key`)
    const permission = permissions.data.find((candidate) => candidate.key === permissionKey)
    if (!permission) throw new Error('Permission was not found')
    const response = await apiV1Client.patch<T>(`/permissions/${encodeURIComponent(permission.id)}/policies`, {
      scope: { type: scopeType, id: scopeType === 'system' ? null : stringArg(args, 'p_scope_id') },
      policies,
    })
    return { data: (response.data ?? true) as T, error: null }
  }
  return null
}

function reportPayload(payload: unknown, filters: QueryFilter[]) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const version = filters.find((filter) => filter.field === 'version' && filter.operator === 'eq')?.value
  const { version: _version, last_edited_by: _lastEditedBy, last_edited_at: _lastEditedAt, ...safePayload } = payload as Record<string, unknown>
  return typeof version === 'number' ? { ...safePayload, expected_version: version } : safePayload
}

class ApiQuery implements PromiseLike<QueryResult> {
  private readonly resource: string
  private readonly filters: QueryFilter[] = []
  private sort?: string
  private limitValue?: number
  private offsetValue = 0
  private orExpression?: string
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
  ilike(field: string, value: unknown) { this.filters.push({ field, operator: 'ilike', value }); return this }
  not(field: string, operator: string, value: unknown) { this.filters.push({ field, operator: operator === 'is' ? 'is' : operator as QueryFilter['operator'], value: operator === 'is' ? String(value) : value }); return this }
  contains(field: string, value: unknown) { this.filters.push({ field, operator: 'contains', value }); return this }
  or(expression: unknown) { if (typeof expression !== 'string') throw new Error('API or filter requires a PostgREST expression'); this.orExpression = expression; return this }
  filter(field: string, operator: string, value: unknown) { this.filters.push({ field, operator: operator as QueryFilter['operator'], value }); return this }
  order(field: string, options: { ascending?: boolean; foreignTable?: string } = {}, ..._rest: unknown[]) { this.sort = `${options.ascending === false ? '-' : ''}${field}`; return this }
  limit(value: number) { this.limitValue = value; return this }
  range(from: number, to: number) { this.offsetValue = Math.max(0, from); this.limitValue = Math.max(1, to - from + 1); return this }
  single() { this.expectSingle = true; this.allowMissing = false; return this }
  maybeSingle() { this.expectSingle = true; this.allowMissing = true; return this }
  async execute(): Promise<QueryResult> {
    try {
      const idFilter = this.filters.find((filter) => filter.field === 'id' || (this.resource === 'user-preferences' && filter.field === 'user_id'))
      let response: ApiEnvelope<any>
      if (this.operation === 'select') {
        if (this.resource === 'teaching-members') {
          const teachingId = this.filters.find((filter) => filter.field === 'teaching_id' && filter.operator === 'eq')?.value
          const userId = this.filters.find((filter) => filter.field === 'user_id' && filter.operator === 'eq')?.value
          if (typeof teachingId !== 'string') throw new Error('API teaching member query requires a teaching_id filter')
          response = typeof userId === 'string'
            ? await apiV1Client.get(`/teachings/${encodeURIComponent(teachingId)}/members/${encodeURIComponent(userId)}`)
            : await apiV1Client.get(`/teachings/${encodeURIComponent(teachingId)}/members?${(() => {
              const params = new URLSearchParams({ limit: String(this.limitValue ?? 100), offset: String(this.offsetValue) })
              if (this.sort) params.set('sort', this.sort)
              for (const filter of this.filters) {
                if (filter.field === 'teaching_id') continue
                if (filter.field === 'status' && filter.operator === 'eq' && typeof filter.value === 'string') params.set('status', filter.value)
                else if (filter.field === 'user_id' && filter.operator === 'eq' && typeof filter.value === 'string') params.set('user_id', filter.value)
                else if (filter.field === 'user_id' && filter.operator === 'ilike' && typeof filter.value === 'string') params.set('search', filter.value.replace(/^%|%$/g, ''))
                else throw new Error(`API teaching member filter is not supported: ${filter.field}`)
              }
              return params.toString()
            })()}`)
        } else if (this.resource === 'report-collab-docs') {
          const reportId = this.filters.find((filter) => filter.field === 'occurrence_report_id' && filter.operator === 'eq')?.value
          if (typeof reportId !== 'string') throw new Error('API collaboration query requires an occurrence_report_id filter')
          response = await apiV1Client.get(`/reports/${encodeURIComponent(reportId)}/collaboration`)
        } else if (idFilter && this.filters.length === 1) response = await apiV1Client.get(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`)
        else { const query = new URLSearchParams({ limit: String(this.limitValue ?? 100), offset: String(this.offsetValue) }); if (this.sort) query.set('sort', this.sort); if (this.filters.length) query.set('filters', JSON.stringify(this.filters)); if (this.orExpression) query.set('or', this.orExpression); response = await apiV1Client.get(`/${this.resource}?${query.toString()}`) }
        const rows = Array.isArray(response.data) ? response.data : response.data == null ? [] : [response.data]; const data = this.expectSingle ? (rows[0] ?? null) : rows; if (this.expectSingle && data == null && !this.allowMissing) return { data: null, error: { message: 'No rows found' } }; return { data, error: null, count: typeof response.meta?.total === 'number' ? response.meta.total : rows.length }
      }
      const payloads = Array.isArray(this.payload) ? this.payload : [this.payload]
      const body = this.resource === 'reports' ? reportPayload(payloads[0], this.filters) : payloads[0]
      if (this.resource === 'teaching-members') {
        const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {}
        const teachingId = stringArg(payload, 'teaching_id') ?? stringArg(Object.fromEntries(this.filters.map((filter) => [filter.field, filter.value])), 'teaching_id')
        const userId = stringArg(payload, 'user_id') ?? stringArg(Object.fromEntries(this.filters.map((filter) => [filter.field, filter.value])), 'user_id')
        if (!teachingId) throw new Error('API teaching member mutation requires a teaching_id')
        if (this.operation === 'insert' || this.operation === 'upsert') {
          const { teaching_id: _teachingId, ...memberPayload } = payload
          const result = await apiV1Client.post(`/teachings/${encodeURIComponent(teachingId)}/members`, memberPayload)
          return { data: result.data, error: null, count: 1 }
        }
        if (!userId) throw new Error('API teaching member mutation requires a user_id')
        const path = `/teachings/${encodeURIComponent(teachingId)}/members/${encodeURIComponent(userId)}`
        const { teaching_id: _teachingId, user_id: _userId, ...memberPayload } = payload
        const result = this.operation === 'delete' ? await apiV1Client.delete(path) : await apiV1Client.patch(path, memberPayload)
        return { data: result.data, error: null, count: 1 }
      }
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
      if (this.operation === 'insert' || this.operation === 'upsert') {
        const rows: unknown[] = []
        for (const payload of payloads) rows.push((await apiV1Client.post(`/${this.resource}`, this.resource === 'reports' ? reportPayload(payload, this.filters) : payload)).data)
        return { data: Array.isArray(this.payload) ? rows : rows[0], error: null, count: rows.length }
      }
      if (this.operation === 'update') { if (!idFilter) throw new Error('API update requires an id filter'); response = await apiV1Client.patch(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`, body) }
      else if (!idFilter) {
        const filterQuery = new URLSearchParams({ limit: '100', offset: '0', filters: JSON.stringify(this.filters) })
        const listed = await apiV1Client.get<any[]>(`/${this.resource}?${filterQuery.toString()}`)
        const ids = (Array.isArray(listed.data) ? listed.data : []).map((row) => row?.id).filter((id): id is string => typeof id === 'string')
        const rows: unknown[] = []
        for (const id of ids) rows.push((await apiV1Client.delete(`/${this.resource}/${encodeURIComponent(id)}`)).data)
        response = { data: rows, meta: {}, request_id: listed.request_id, trace_id: listed.trace_id }
      } else response = await apiV1Client.delete(`/${this.resource}/${encodeURIComponent(String(idFilter.value))}`)
      const data = response.data; return { data, error: null, count: Array.isArray(data) ? data.length : null }
    } catch (error) { return { data: null, error: toError(error), count: null } }
  }
  then<TResult1 = QueryResult, TResult2 = never>(onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> { return this.execute().then(onfulfilled as any, onrejected as any) }
}

export const apiDataClient = {
  from(table: string) { return new ApiQuery(table) },
  auth: { async getUser() { try { const response = await apiV1Client.get<any>('/auth/me'); return { data: { user: response.data }, error: null } } catch (error) { return { data: { user: null }, error: toError(error) } } }, async getSession() { return { data: { session: null }, error: null } } },
  async rpc<T = any>(name: string, args: Record<string, unknown> = {}) {
    try {
      const canonical = await invokeCanonicalRpc<T>(name, args)
      if (canonical) return canonical
      const response = await apiV1Client.post<T>(`/rpc/${encodeURIComponent(name)}`, args)
      return { data: response.data, error: null }
    } catch (error) { return { data: null, error: toError(error) } }
  },
}
