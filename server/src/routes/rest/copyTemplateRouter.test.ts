import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createCopyTemplateRouter } from './copyTemplateRouter.js'
import { listQuerySchema } from './resources.js'

const classId = '10000000-0000-4000-8000-000000000001'

function setup(allowed = true) {
  const upsert = vi.fn().mockReturnValue({
    select: () => ({ single: async () => ({ data: { id: 'template' } }) }),
  })
  const rpc = vi.fn().mockResolvedValue({ data: allowed, error: null })
  const app = express()
  app.use(express.json(), (req, _res, next) => {
    Object.assign(req, { user: { id: 'teacher' }, db: { rpc, from: () => ({ upsert }) } })
    next()
  }, createCopyTemplateRouter())
  app.use(((error, _req, res, _next) => {
    res.status(error.status ?? 400).end()
  }) satisfies express.ErrorRequestHandler)
  return { app, rpc, upsert }
}

describe('personal copy templates', () => {
  it.each(['attendance_copy', 'course_copy'])('saves a %s user default without a global permission', async type => {
    const { app, rpc, upsert } = setup(false)
    await request(app).put(`/copy-templates/${type}/user_default/user_default`).send({ template_text: 'Custom' }).expect(200)
    expect(rpc).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'teacher', scope_entity_id: 'user_default' }), expect.anything())
  })

  it.each([true, false])('checks class access before writing an attendance template (allowed: %s)', async allowed => {
    const { app, rpc, upsert } = setup(allowed)
    await request(app).put(`/copy-templates/attendance_copy/class_session/${classId}`).send({ template_text: 'Custom' }).expect(allowed ? 200 : 403)
    expect(rpc).toHaveBeenCalledWith('has_api_permission', expect.objectContaining({
      p_permission_key: 'teaching.class_sessions.read', p_class_session_id: classId,
    }))
    expect(upsert).toHaveBeenCalledTimes(allowed ? 1 : 0)
  })

  it('rejects unsupported scopes and client ownership', async () => {
    const { app, upsert } = setup()
    await request(app).put(`/copy-templates/course_copy/class_session/${classId}`).send({ template_text: 'Custom' }).expect(400)
    await request(app).put('/copy-templates/course_copy/user_default/user_default').send({ user_id: 'someone-else' }).expect(400)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('loads and saves the personal default used by already deployed clients', async () => {
    const { app, upsert } = setup()
    expect(listQuerySchema.parse({ scope_entity_id: 'user_default' }).scope_entity_id).toBe('user_default')
    const legacyScope = { template_type: 'course_copy', scope_type: 'user_default', scope_entity_id: 'user_default' }
    const path = '/copy-templates/course_copy/user_default/user_default'
    await request(app).put(path).send({ ...legacyScope, template_text: 'Custom' }).expect(200)
    await request(app).put(path).send({ ...legacyScope, scope_entity_id: classId, template_text: 'Custom' }).expect(400)
    expect(upsert).toHaveBeenCalledOnce()
  })
})
