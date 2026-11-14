import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createOccurrenceRouter, provisionReports } from './occurrenceRouter.js'
import { expectPriorAttendedReportScope, routeSource } from '../../test/routeSource.js'

const testOccurrenceId = '10000000-0000-4000-8000-000000000001'
const testSessionId = '10000000-0000-4000-8000-000000000002'
const otherSessionId = '10000000-0000-4000-8000-000000000003'

const globalMemberClassTeacher = {
  userId: 'global-member-plus-class-teacher',
  platformListPermission: false,
  classSessionListPermissionIds: [testSessionId],
}
const globalMemberOnly = {
  userId: 'global-member-only',
  platformListPermission: false,
  classSessionListPermissionIds: [],
}
const platformOccurrenceLister = {
  userId: 'platform-occurrence-lister',
  platformListPermission: true,
  classSessionListPermissionIds: [],
}

describe('occurrence API contract', () => {
  it('enforces scoped permission, holiday and teacher-leave guards', () => {
    const source = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("p_permission_key: `teaching.occurrences.${action}`")
    expect(source).toContain('HOLIDAY_OCCURRENCE')
    expect(source).toContain('set_occurrence_teacher_attendance')
    expect(source).toContain('idempotency(req')
  })
})

describe('occurrence list scope authorization', () => {
  it('allows a global member who has occurrence-list permission only as teacher of the requested session', async () => {
    const result = await listOccurrenceRequest({ session_ids: testSessionId }, globalMemberClassTeacher)

    expect(result.status).toBe(200)
    expect(result.permissionScopes).toEqual([testSessionId])
    expect(result.permissionScopes).not.toContain(null)
    expect(result.permissionCalls).toEqual([{
      permissionKey: 'teaching.occurrences.list',
      scope: testSessionId,
    }])
    expect(result.sessionFilter).toEqual([testSessionId])
  })

  it('deduplicates class session IDs before checking access and querying rows', async () => {
    const repeatedSessionIds = Array(101).fill(testSessionId).join(',')
    const result = await listOccurrenceRequest({ session_ids: repeatedSessionIds }, globalMemberClassTeacher)

    expect(result.status).toBe(200)
    expect(result.permissionScopes).toEqual([testSessionId])
    expect(result.sessionFilter).toEqual([testSessionId])
  })

  it('caps distinct-session permission checks at 100 before querying', async () => {
    const sessionIds = Array.from({ length: 101 }, (_, index) => (
      `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    )).join(',')
    const result = await listOccurrenceRequest({ session_ids: sessionIds }, globalMemberOnly)

    expect(result.status).toBe(400)
    expect(result.error).toMatchObject({ code: 'INVALID_QUERY' })
    expect(result.permissionCalls).toEqual([])
    expect(result.queryStarted).toBe(false)
  })

  it('denies a global member without class-teacher occurrence-list permission', async () => {
    const result = await listOccurrenceRequest({ session_ids: testSessionId }, globalMemberOnly)

    expect(result.status).toBe(403)
    expect(result.error).toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(result.permissionScopes).toEqual([testSessionId])
    expect(result.queryStarted).toBe(false)
  })

  it('rejects the whole request when any requested class is unauthorized', async () => {
    const result = await listOccurrenceRequest({ session_ids: `${testSessionId},${otherSessionId}` }, globalMemberClassTeacher)

    expect(result.status).toBe(403)
    expect(result.permissionScopes).toEqual([testSessionId, otherSessionId])
    expect(result.queryStarted).toBe(false)
  })

  it('rejects repeated IDs when the raw session_ids value exceeds 4000 characters', async () => {
    // This bounds URL input size even when de-duplication would leave one permission check.
    const repeatedSessionIds = Array(111).fill(testSessionId).join(',')
    const result = await listOccurrenceRequest({ session_ids: repeatedSessionIds }, globalMemberClassTeacher)

    expect(result.error).toMatchObject({ name: 'ZodError' })
    expect(result.permissionCalls).toEqual([])
    expect(result.queryStarted).toBe(false)
  })

  it.each([
    '',
    `${testSessionId},`,
    `${testSessionId},not-a-uuid`,
  ])('rejects malformed session_ids %s before querying', async (sessionIds) => {
    const result = await listOccurrenceRequest({ session_ids: sessionIds }, globalMemberClassTeacher)

    expect(result.status).toBe(400)
    expect(result.error).toMatchObject({ code: 'INVALID_QUERY' })
    expect(result.permissionScopes).toEqual([])
    expect(result.queryStarted).toBe(false)
  })

  it('keeps the single class_session_id authorization path scoped', async () => {
    const result = await listOccurrenceRequest({ class_session_id: testSessionId }, globalMemberClassTeacher)

    expect(result.status).toBe(200)
    expect(result.permissionScopes).toEqual([testSessionId])
    expect(result.singleSessionFilter).toBe(testSessionId)
  })

  it('keeps an unfiltered list restricted to platform permission', async () => {
    const result = await listOccurrenceRequest({}, platformOccurrenceLister)

    expect(result.status).toBe(200)
    expect(result.permissionScopes).toEqual([null])
    expect(result.sessionFilter).toBeUndefined()
  })
})

async function listOccurrenceRequest(
  query: Record<string, string>,
  grants: {
    userId: string
    platformListPermission: boolean
    classSessionListPermissionIds: string[]
  } = globalMemberOnly,
) {
  const permissionCalls: Array<{ permissionKey: string; scope: string | null }> = []
  let sessionFilter: string[] | undefined
  let singleSessionFilter: string | undefined
  let queryStarted = false
  const database = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'has_api_permission') throw new Error(`Unexpected RPC ${name}`)
      const scope = args.p_class_session_id as string | null
      const permissionKey = args.p_permission_key as string
      permissionCalls.push({ permissionKey, scope })
      return {
        data: permissionKey === 'teaching.occurrences.list' && (
          scope === null
            ? grants.platformListPermission
            : grants.classSessionListPermissionIds.includes(scope)
        ),
        error: null,
      }
    },
    from: (table: string) => {
      if (table !== 'class_occurrences') throw new Error(`Unexpected table ${table}`)
      queryStarted = true
      const builder: any = {
        select: () => builder,
        in: (column: string, values: string[]) => {
          if (column === 'class_session_id') sessionFilter = values
          return builder
        },
        eq: (column: string, value: string) => {
          if (column === 'class_session_id') singleSessionFilter = value
          return builder
        },
        gte: () => builder,
        lte: () => builder,
        order: () => builder,
        range: async () => ({ data: [], count: 0, error: null }),
      }
      return builder
    },
  }
  const request: any = {
    query,
    db: database,
    user: { id: grants.userId },
    requestId: 'request-1',
    traceId: 'trace-1',
  }
  const route = createOccurrenceRouter().stack.find((layer: any) => layer.route?.path === '/occurrences')
  const handler = route?.route?.stack[0]?.handle
  if (!handler) throw new Error('Occurrence list route was not registered')

  const response = await new Promise<{ status: number; error?: unknown }>((resolve) => {
    const res: any = {
      statusCode: 200,
      status(status: number) { this.statusCode = status; return this },
      json() { resolve({ status: this.statusCode }) },
    }
    handler(request, res, (error: any) => resolve({ status: error?.status ?? 500, error }))
  })

  return {
    ...response,
    permissionCalls,
    permissionScopes: permissionCalls.map((call) => call.scope),
    sessionFilter,
    singleSessionFilter,
    queryStarted,
  }
}

describe('class report completion summary', () => {
  it('counts total and completed reports per lesson', async () => {
    const { summarizeReportCompletion } = await import('./occurrenceRouter.js')
    expect(summarizeReportCompletion([
      { id: 'a', occurrence_date: '2026-10-03', occurrence_reports: [{ is_completed: true }, { is_completed: false }, { is_completed: null }] },
      { id: 'b', occurrence_date: '2026-10-10', occurrence_reports: null },
    ])).toEqual([
      { occurrence_id: 'a', occurrence_date: '2026-10-03', total: 3, completed: 1 },
      { occurrence_id: 'b', occurrence_date: '2026-10-10', total: 0, completed: 0 },
    ])
  })
})

function reportProvisionRequest(provisionableIds: string[], persistedReports: Array<Record<string, unknown>>, allowList = true) {
  const rpcCalls: string[] = []
  const database = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push(name)
      if (name === 'has_api_permission') return { data: args?.p_permission_key === 'teaching.reports.list' ? allowList : true, error: null }
      if (name === 'provision_class_reports') return { data: ['active', 'completed', 'makeup'].map(enrollment_id => ({
        enrollment_id, provisioned: provisionableIds.includes(enrollment_id)
      })), error: null }
      return { data: null, error: null }
    },
    from: (table: string) => {
      let selected = ''
      const chain: any = {
        select: (fields: string) => { selected = fields; return chain },
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () => ({ data: { id: testOccurrenceId, class_session_id: '10000000-0000-4000-8000-000000000002', occurrence_date: '2026-09-13' }, error: null }),
        then: (resolve: (value: any) => unknown, reject: (reason?: unknown) => unknown) => {
          const data = table === 'occurrence_reports' && selected === 'enrollment_id'
            ? provisionableIds.slice(0, 1).map(enrollment_id => ({ enrollment_id }))
            : table === 'occurrence_reports' ? persistedReports : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        }
      }
      return chain
    }
  }
  const adminRpcCalls: string[] = []
  const req: any = {
    params: { occurrenceId: testOccurrenceId }, method: 'POST', originalUrl: `/api/occurrences/${testOccurrenceId}/reports`,
    requestId: 'request-1', traceId: 'trace-1', user: { id: 'user-1' }, db: database,
    header: () => 'idempotency-key-123',
    adminDb: { rpc: async (name: string) => { adminRpcCalls.push(name); return { data: name === 'reserve_api_idempotency' ? [{ is_replay: false }] : null, error: null } } }
  }
  const response: any = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this },
    json(body: any) { this.body = body; return this }
  }
  return { req, response, rpcCalls, adminRpcCalls }
}

describe('occurrence report provisioning response', () => {
  it('returns saved active, completed, and makeup reports after provisioning only active enrollments', async () => {
    const reports = [
      { id: 'report-active', enrollment_id: 'active', class_occurrence_id: testOccurrenceId, attendance_status: 'pending', version: 1 },
      { id: 'report-completed', enrollment_id: 'completed', class_occurrence_id: testOccurrenceId, attendance_status: 'present', version: 3 },
      { id: 'report-makeup', enrollment_id: 'makeup', class_occurrence_id: testOccurrenceId, attendance_status: 'present', version: 2 }
    ]
    const { req, response, rpcCalls } = reportProvisionRequest(['active'], reports)

    await provisionReports(req, response)

    expect(response.statusCode).toBe(201)
    expect(response.body.data.map((report: any) => report.id)).toEqual(['report-active', 'report-completed', 'report-makeup'])
    expect(rpcCalls.filter(call => call === 'provision_class_reports')).toHaveLength(1)
    expect(response.body.meta.provisioned).toBe(1)
  })

  it('returns existing reports when no enrollment is eligible for placeholder creation', async () => {
    const reports = [{ id: 'report-completed', enrollment_id: 'completed', class_occurrence_id: testOccurrenceId, attendance_status: 'present', version: 3 }]
    const { req, response, rpcCalls } = reportProvisionRequest([], reports)

    await provisionReports(req, response)

    expect(response.body.data).toEqual(reports)
    expect(rpcCalls).toContain('provision_class_reports')
    expect(response.body.meta.provisioned).toBe(0)
  })

  it('checks report-list access before provisioning any report', async () => {
    const { req, response, rpcCalls } = reportProvisionRequest(['active'], [], false)

    await expect(provisionReports(req, response)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })

    expect(rpcCalls).not.toContain('provision_class_reports')
  })
})

describe('occurrence progress gap summary contract', () => {
  it('scopes batch gap summaries to the authorized effective roster and prior attended reports', () => {
    const source = routeSource('occurrenceRouter.ts')
    expect(source).toContain("router.get('/occurrences/:id/report-progress-gaps'")
    expect(source).toContain("rpc('get_effective_occurrence_enrollment_ids'")
    expectPriorAttendedReportScope(source)
    expect(source).toContain('selectedLessonByEnrollment.get(enrollmentId)')
    expect(source).not.toContain("select('enrollment_id,lesson_id,class_occurrences!inner(occurrence_date),content")
  })
})

describe('occurrence roster route', () => {
  it('reads the effective roster through the occurrence-scoped permission check', () => {
    const source = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function roster('), source.indexOf('export function createOccurrenceRouter'))
    expect(source).toContain("router.get('/occurrences/:id/roster', wrap(roster))")
    expect(handler).toContain("assertOccurrencePermission(req, id, 'read')")
    expect(handler).toContain("rpc('get_effective_occurrence_enrollment_ids'")
  })
})
