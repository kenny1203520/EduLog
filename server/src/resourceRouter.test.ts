import type { Request } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { ZodError } from 'zod'
import { collection, idempotency, parseFilters } from './resourceRouter.js'
import { resources } from './resources.js'

describe('idempotency replay contract', () => {
  it('replays the stored response body with the current request and trace ids', async () => {
    const req = {
      method: 'POST',
      requestId: 'request-new',
      traceId: 'trace-new',
      originalUrl: '/api/roles?limit=25',
      user: { id: '00000000-0000-4000-8000-000000000001' },
      header: vi.fn().mockReturnValue('stable-key'),
      adminDb: {
        rpc: vi.fn().mockResolvedValue({
          data: [{
            is_replay: true,
            response_status: 201,
            response_body: { data: { id: 'resource-1' }, meta: {}, request_id: 'request-old', trace_id: 'trace-old' },
          }],
          error: null,
        }),
      },
    } as unknown as Request

    await expect(idempotency(req, 201, null)).resolves.toEqual({
      status: 201,
      body: { data: { id: 'resource-1' }, meta: {}, request_id: 'request-new', trace_id: 'trace-new' },
    })
  })
})

describe('resource mutation validation boundary', () => {
  function request(body: unknown) {
    const from = vi.fn()
    const rpc = vi.fn()
    const adminRpc = vi.fn()
    const req = {
      method: 'POST',
      body,
      query: {},
      requestId: 'request-invalid',
      traceId: 'trace-invalid',
      originalUrl: '/api/teachings',
      user: { id: '00000000-0000-4000-8000-000000000001' },
      db: { from, rpc },
      adminDb: { rpc: adminRpc },
      header: vi.fn(),
    } as unknown as Request
    return { req, from, rpc, adminRpc }
  }

  it('rejects invalid typed payloads before authorization or idempotency', async () => {
    const { req, from, rpc, adminRpc } = request({ name: 123 })
    await expect(collection(req, {} as never, resources.teachings)).rejects.toBeInstanceOf(ZodError)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(adminRpc).not.toHaveBeenCalled()
  })

  it('rejects invalid UUID child payloads before any database call', async () => {
    const { req, from, rpc, adminRpc } = request({ course_id: 'not-a-uuid', title: 'Lesson', sequence: 1 })
    await expect(collection(req, {} as never, resources.lessons)).rejects.toBeInstanceOf(ZodError)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(adminRpc).not.toHaveBeenCalled()
  })

  it('keeps teaching member status and user filtering on the server route', () => {
    const source = readFileSync(new URL('./resourceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("status: z.string().trim().min(1).max(32).optional()")
    expect(source).toContain("user_id: z.string().uuid().optional()")
    expect(source).toContain("builder = builder.eq('status', query.status)")
    expect(source).toContain("builder = builder.eq('user_id', query.user_id)")
  })

  it('registers the single teaching member route advertised by the contract', () => {
    const source = readFileSync(new URL('./resourceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("router.get('/teachings/:teachingId/members/:userId'")
  })

  it('rejects item-only sensitive fields as collection filters', () => {
    expect(resources.students.filterable).not.toContain('gov_id')
    expect(resources.teachers.filterable).not.toContain('gov_id')
    expect(() => parseFilters(JSON.stringify([{ field: 'gov_id', operator: 'eq', value: 'secret' }]), resources.students)).toThrow('The filter is not supported')
  })

  it('fails closed when a resource omits an explicit filter allowlist', () => {
    const definition = { ...resources.students, filterable: undefined }
    expect(() => parseFilters(JSON.stringify([{ field: 'name', operator: 'eq', value: 'Alice' }]), definition)).toThrow('The filter is not supported')
  })

  it('registers explicit filter allowlists for every resource without exposing credential secrets', () => {
    for (const definition of Object.values(resources)) {
      expect(definition.filterable?.length).toBeGreaterThan(0)
      expect(definition.filterable).not.toContain('password')
      expect(definition.filterable).not.toContain('gov_id')
    }
    expect(resources.reports.filterable).toContain('class_occurrences.occurrence_date')
    expect(resources['student-credentials'].filterable).toContain('student_id')
  })

  it('exposes report version cleanup as a scoped item delete, not a mutable collection', () => {
    expect(resources['report-versions'].genericMethods).toEqual(['GET', 'DELETE'])
    expect(resources['report-versions'].writable).toEqual([])
    expect(resources['report-versions'].permissions?.delete).toBe('teaching.reports.delete')
  })
})
