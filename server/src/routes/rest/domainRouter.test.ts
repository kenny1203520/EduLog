import { describe, expect, it } from 'vitest'
import { provisionReports } from './domainRouter.js'
import { readFileSync } from 'node:fs'

const testOccurrenceId = '10000000-0000-4000-8000-000000000001'

describe('occurrence report provisioning contract', () => {
  it('provisions only eligible reports but reads the complete authorized occurrence roster', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')
    const provisioningHandler = source.slice(source.indexOf('async function provisionReports'), source.indexOf('async function progressSummaryReports'))

    expect(provisioningHandler).toContain("rpc('get_provisionable_occurrence_enrollment_ids'")
    expect(provisioningHandler).toContain("rpc('provision_occurrence_reports'")
    expect(provisioningHandler).toContain("rpc('get_effective_occurrence_enrollment_ids'")
    expect(provisioningHandler).toContain("permission(req, 'teaching.reports.list'")
    expect(provisioningHandler).toContain("select(reportFields).eq('class_occurrence_id', occurrenceId)")
    expect(provisioningHandler).toContain('const enrollmentIds = [...new Set(')
    expect(provisioningHandler).toContain('let missingCount = 0')
    expect(provisioningHandler).not.toContain('if (!enrollmentIds.length) { const body = envelope(req, [])')
  })

  it('exposes a report-progress context limited to the authorized enrollment and earlier attended summaries', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')

    expect(source).toContain("router.get('/enrollments/:id/report-progress-context'")
    expect(source).toContain("permission(req, 'teaching.reports.list', occurrence.data.class_session_id)")
    expect(source).toContain(".eq('attendance_status', 'present')")
    expect(source).toContain(".lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date)")
    expect(source).toContain(".neq('id', query.report_id)")
    expect(source).toContain('latest_prior_report: latestPriorReport')
    expect(source).not.toContain("select('id,lesson_id,is_completed,progress_letter,attendance_status,class_occurrences!inner(occurrence_date),content")
  })
})

function reportProvisionRequest(provisionableIds: string[], persistedReports: Array<Record<string, unknown>>, allowList = true) {
  const rpcCalls: string[] = []
  const database = {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push(name)
      if (name === 'has_api_permission') return { data: args?.p_permission_key === 'teaching.reports.list' ? allowList : true, error: null }
      if (name === 'get_effective_occurrence_enrollment_ids') return { data: [
        { enrollment_id: 'active' }, { enrollment_id: 'completed' }, { enrollment_id: 'makeup' }
      ], error: null }
      if (name === 'get_provisionable_occurrence_enrollment_ids') return { data: provisionableIds.map(enrollment_id => ({ enrollment_id })), error: null }
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
    expect(rpcCalls).toContain('get_effective_occurrence_enrollment_ids')
    expect(rpcCalls).toContain('provision_occurrence_reports')
  })

  it('returns existing reports when no enrollment is eligible for placeholder creation', async () => {
    const reports = [{ id: 'report-completed', enrollment_id: 'completed', class_occurrence_id: testOccurrenceId, attendance_status: 'present', version: 3 }]
    const { req, response, rpcCalls } = reportProvisionRequest([], reports)

    await provisionReports(req, response)

    expect(response.body.data).toEqual(reports)
    expect(rpcCalls).not.toContain('provision_occurrence_reports')
  })

  it('checks report-list access before provisioning any report', async () => {
    const { req, response, rpcCalls } = reportProvisionRequest(['active'], [], false)

    await expect(provisionReports(req, response)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })

    expect(rpcCalls).not.toContain('get_effective_occurrence_enrollment_ids')
    expect(rpcCalls).not.toContain('provision_occurrence_reports')
  })
})

describe('occurrence progress gap summary contract', () => {
  it('scopes batch gap summaries to the authorized effective roster and prior attended reports', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')

    expect(source).toContain("router.get('/occurrences/:id/report-progress-gaps'")
    expect(source).toContain("permission(req, 'teaching.reports.list', occurrence.data.class_session_id)")
    expect(source).toContain("rpc('get_effective_occurrence_enrollment_ids'")
    expect(source).toContain(".eq('attendance_status', 'present')")
    expect(source).toContain(".lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date)")
    expect(source).toContain('selectedLessonByEnrollment.get(enrollmentId)')
    expect(source).not.toContain("select('enrollment_id,lesson_id,class_occurrences!inner(occurrence_date),content")
  })
})

describe('class transfer contract', () => {
  it('moves the enrollment through the date-effective RPC instead of a direct update', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function transferClass'), source.indexOf('async function bulkDeleteTeachers'))
    expect(handler).toContain("rpc('transfer_enrollment_class'")
    expect(handler).toContain('p_effective_date: input.transfer_date')
    expect(handler).toContain('retained_reports')
    expect(handler).not.toContain(".from('enrollments').update(")
  })
})
