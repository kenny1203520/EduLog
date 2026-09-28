import { describe, expect, it } from 'vitest'
import { auditRequest, safeUuid } from './audit.js'

describe('audit resource identifiers', () => {
  it('only accepts real UUIDs and never promotes route verbs to resource ids', () => {
    expect(safeUuid('00000000-0000-4000-8000-000000000010')).toBe('00000000-0000-4000-8000-000000000010')
    expect(safeUuid('generate')).toBeNull()
    expect(safeUuid('transfer-history')).toBeNull()
    expect(safeUuid(undefined)).toBeNull()
  })

  it('writes a safe, complete authorization-denial audit event', async () => {
    let inserted: Record<string, any> | undefined
    const req: any = {
      method: 'PATCH', path: '/api/reports/00000000-0000-4000-8000-000000000010',
      route: { path: '/api/reports/:id' }, requestId: 'request-1', traceId: 'trace-1', startedAt: performance.now() - 4,
      user: { id: '00000000-0000-4000-8000-000000000011' }, auditContext: {
        domain: 'teaching', resource: 'reports', resourceId: '00000000-0000-4000-8000-000000000010',
        teachingId: '00000000-0000-4000-8000-000000000012', scopeId: '00000000-0000-4000-8000-000000000013',
        scopeType: 'class_occurrence', permission: 'teaching.reports.update', action: 'update', authorizationStage: 'report_scope_permission', authorizationResult: 'denied', errorCode: 'PERMISSION_DENIED',
      }, log: { error() {} }, adminDb: { from() { return { insert(value: Record<string, any>) { inserted = value; return Promise.resolve({ error: null }) } } } },
    }
    await auditRequest(req, 403)
    expect(inserted).toBeDefined()
    const event = inserted!
    expect(event).toMatchObject({ actor_user_id: req.user.id, action: 'update', domain: 'teaching', resource: 'reports', resource_id: req.auditContext.resourceId, scope_id: req.auditContext.scopeId, request_id: 'request-1', outcome: 'denied' })
    expect(event.metadata).toMatchObject({ user_id: req.user.id, teaching_id: req.auditContext.teachingId, resource_id: req.auditContext.resourceId, scope_type: 'class_occurrence', scope_id: req.auditContext.scopeId, permission: 'teaching.reports.update', authorization_stage: 'report_scope_permission', authorization_result: 'denied', error_code: 'PERMISSION_DENIED', route: '/api/reports/:id', method: 'PATCH', status: 403, request_id: 'request-1', trace_id: 'trace-1', outcome: 'denied' })
    expect(event.metadata).not.toHaveProperty('body')
  })

  it('isolates audit exporter failure from the request path', async () => {
    const errors: unknown[] = []
    const req: any = {
      method: 'POST', path: '/api/roles', requestId: 'request-2', traceId: 'trace-2', startedAt: performance.now(),
      user: { id: '00000000-0000-4000-8000-000000000011' }, auditContext: { domain: 'system', resource: 'roles', action: 'create', permission: 'system.roles.manage', errorCode: 'DB_CONFLICT' },
      log: { error(value: unknown) { errors.push(value) } }, adminDb: { from() { throw new Error('export down') } },
    }
    await expect(auditRequest(req, 409)).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
  })
})
