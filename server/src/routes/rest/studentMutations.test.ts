import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createResourceRouter } from './resourceRouter.js'
import { errorHandler } from '../../http/errors.js'

const studentId = 'ffe5b8ab-4657-4977-b6c9-3320da82046f'
const contactId = '00000000-0000-4000-8000-000000000002'

// Exercise the real schemas, authorization and error middleware, mocking only
// the database boundary for the payloads submitted by the student forms.
function fixture(resource: 'students' | 'student-contacts', deniedPermission?: string) {
  const existing = { id: resource === 'students' ? studentId : contactId, student_id: studentId, name: 'Student' }
  const query = {
    select: vi.fn(() => query), eq: vi.fn(() => query),
    insert: vi.fn(() => query), update: vi.fn(() => query),
    single: vi.fn(async () => ({ data: existing, error: null })),
    maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
  }
  const db = {
    from: vi.fn(() => query),
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({ data: args.p_permission_key !== deniedPermission, error: null })),
  }
  const adminRpc = vi.fn(async () => ({ data: [{ is_replay: false }], error: null }))
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    Object.assign(req, {
      user: { id: '00000000-0000-4000-8000-000000000001' },
      db, adminDb: { rpc: adminRpc }, requestId: 'request-student', traceId: 'trace-student',
      log: { warn: vi.fn(), error: vi.fn() },
    })
    next()
  })
  app.use('/api', createResourceRouter())
  app.use(errorHandler)
  return { app, db, query, adminRpc }
}

describe.each(['students', 'student-contacts'] as const)('%s optional email mutations', (resource) => {
  const id = resource === 'students' ? studentId : contactId
  for (const method of ['post', 'patch'] as const) {
    const url = `/api/${resource}${method === 'patch' ? `/${id}` : ''}`
    const base = method === 'post'
      ? { name: 'Student', ...(resource === 'student-contacts' ? { student_id: studentId } : {}) }
      : { name: 'Updated student' }

    it.each([
      ['', null], [' \t ', null], [null, null],
      ['parent@example.test', 'parent@example.test'], [' parent@example.test ', 'parent@example.test'],
    ])(`${method} normalizes email %j`, async (email, expected) => {
      const { app, db, query } = fixture(resource)
      const res = await request(app)[method](url).set('Idempotency-Key', 'student-email-test').send({ ...base, email, phone: '0912345678' })
      expect(res.status).toBe(method === 'post' ? 201 : 200)
      if (resource === 'students' && method === 'patch') {
        expect(db.rpc).toHaveBeenCalledWith('update_student_sensitive', {
          p_student_id: studentId, p_patch: { email: expected, phone: '0912345678' },
        })
      } else {
        expect(method === 'post' ? query.insert : query.update).toHaveBeenCalledWith(expect.objectContaining({ email: expected, phone: '0912345678' }))
      }
    })

    it(`${method} preserves omission of email`, async () => {
      const { app, db, query } = fixture(resource)
      const res = await request(app)[method](url).set('Idempotency-Key', 'student-email-test').send(base)
      expect(res.status).toBe(method === 'post' ? 201 : 200)
      expect(method === 'post' ? query.insert : query.update).toHaveBeenCalledWith(base)
      expect(db.rpc.mock.calls.some(([name]) => name === 'update_student_sensitive')).toBe(false)
    })

    it.each(['invalid-email', 123])(`${method} rejects invalid email %j before database access`, async (email) => {
      const { app, db, adminRpc } = fixture(resource)
      const res = await request(app)[method](url).set('Idempotency-Key', 'student-email-test').send({ ...base, email })
      expect(res.status).toBe(422)
      expect(res.body.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { email: expect.any(Array) }, request_id: 'request-student', trace_id: 'trace-student' })
      expect(db.from).not.toHaveBeenCalled()
      expect(db.rpc).not.toHaveBeenCalled()
      expect(adminRpc).not.toHaveBeenCalled()
    })
  }

  it('still requires sensitive update permission to clear an email', async () => {
    const { app, db, query } = fixture(resource, 'teaching.students.update_sensitive')
    const res = await request(app).patch(`/api/${resource}/${id}`).set('Idempotency-Key', 'student-email-test').send({ email: '' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PERMISSION_DENIED')
    expect(query.update).not.toHaveBeenCalled()
    expect(db.rpc.mock.calls.some(([name]) => name === 'update_student_sensitive')).toBe(false)
  })
})
