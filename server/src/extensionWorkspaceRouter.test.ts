import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createExtensionWorkspaceRouter, importBatch, pendingPush, importJob, memoryConfirmation } from './extensionWorkspaceRouter.js'
import { errorHandler } from './errors.js'
const id = '00000000-0000-4000-8000-000000000001'
const row = { source_id: '101', target_id: id, overwrite: [], record: { kind: 'student', data: { name: 'Test A' } } }
function appWith(data: unknown, error: unknown = null, productionErrors = false) {
  const rpc = vi.fn().mockResolvedValue({ data, error }), app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.extensionPrincipal = { userId: id, tokenId: id, extensionOrigin: `chrome-extension://${'a'.repeat(32)}`, connection: {} as never }; next() })
  app.use('/api/extension/v1', createExtensionWorkspaceRouter({ rpc } as unknown as SupabaseClient))
  if (productionErrors) app.use(errorHandler)
  else app.use((error: { status?: number; code?: string; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 400).json({ error: { code: error.code, message: error.message } }))
  return { app, rpc }
}
describe('workspace API contract', () => {
  it('provides bounded readonly reconciliation without a transfer mutation route', async()=>{
    const {app,rpc}=appWith({enrollment:{id},transfers:[],next_cursor:null})
    const res=await request(app).get(`/api/extension/v1/enrollments/${id}/reconciliation?limit=50`).set('Authorization',`Bearer ${'a'.repeat(64)}`)
    expect(res.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe('web_extension_catalog');expect(rpc.mock.calls[0][1]).toMatchObject({p_operation:'reconcile',p_input:{enrollment_id:id,limit:50}})
    expect((await request(app).get(`/api/extension/v1/enrollments/${id}/reconciliation?limit=51`)).status).toBe(400)
    expect((await request(app).post(`/api/extension/v1/enrollments/${id}/transfers/class`).send({})).status).toBe(404)
    expect((await request(app).get('/api/extension/v1/catalog?resource=enrollments&student_id='+id).set('Authorization',`Bearer ${'a'.repeat(64)}`)).status).toBe(200)
  })
  it('supports per-admission courses, legacy jobs and bounded explicit memory confirmation', async()=>{
    const base={source_origin:'https://corp.orangeapple.co',source_class_id:'11',date_from:'2026-01-01',date_to:'2026-12-31',classroom_id:id,class_session_id:id}
    expect(importJob.safeParse({...base,course_ids:[id]}).success).toBe(true)
    expect(importJob.safeParse({...base,course_id:id}).success).toBe(true)
    expect(importJob.safeParse({...base,course_ids:[id,id]}).success).toBe(false)
    expect(importJob.safeParse(base).success).toBe(false)
    const body={source_origin:base.source_origin,source_class_id:'11',items:[{kind:'admission',key:'301',action:'confirm',student_id:id,course_id:id,class_session_id:id,expected_revision:null,versions:{[id]:'a'.repeat(32)}}]}
    expect(memoryConfirmation.safeParse({...body,user_id:id}).success).toBe(false)
    expect(memoryConfirmation.safeParse({...body,items:Array(51).fill(body.items[0])}).success).toBe(false)
    const {app,rpc}=appWith({items:[]});const res=await request(app).post('/api/extension/v1/catalog/confirm').set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(res.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe('web_extension_catalog');expect(rpc.mock.calls[0][1].p_operation).toBe('memory-confirm')
  })
  it('exposes verified import checkpoints and only finalizes with a unique batch key list', async()=>{
    const {app,rpc}=appWith({job:{id,status:'complete'},batches:[],roster_date:'2026-10-03',roster:{enrollments:[]}})
    const info=await request(app).get(`/api/extension/v1/imports/${id}?roster_date=2026-10-03`).set('Authorization',`Bearer ${'a'.repeat(64)}`)
    expect(info.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe('web_extension_import_info');expect(rpc.mock.calls[0][1].p_input).toEqual({job_id:id,roster_date:'2026-10-03'})
    const complete=await request(app).post(`/api/extension/v1/imports/${id}/complete`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send({expected_batch_keys:[id]})
    expect(complete.status).toBe(200);expect(rpc.mock.calls[1][0]).toBe('web_extension_finalize_import');expect(rpc.mock.calls[1][1].p_input).toEqual({job_id:id,expected_batch_keys:[id]})
    expect((await request(app).post(`/api/extension/v1/imports/${id}/complete`).send({expected_batch_keys:[id,id]})).status).toBe(400)
    expect((await request(app).patch(`/api/extension/v1/imports/${id}`).send({status:'complete'})).status).toBe(400)
  })
  it('rejects oversized, duplicate, sensitive or forged actor payloads', () => {
    expect(importBatch.safeParse({ key: id, rows: Array.from({ length: 51 }, () => row) }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [row, row] }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [{ ...row, record: { kind: 'student', data: { name: 'A', phone: 'sensitive' } } }] }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [row], user_id: id }).success).toBe(false)
    expect(pendingPush.safeParse({ status: 'confirmed' }).success).toBe(false)
  })
  it('accepts extension-built reversed dependencies and still rejects duplicate source identities', async () => {
    const modelUrl = new URL('../../extension/workspace-model.js', import.meta.url)
    const { splitBatches } = await import(modelUrl.href)
    const enrollment = { source_id: '277332', target_id: '00000000-0000-4000-8000-000000000002', overwrite: [], record: { kind: 'enrollment', data: { student_id: id, course_id: id, class_session_id: id, classroom_id: id, status: 'regular', start_date: '2026-01-01', time_zone: 'Asia/Taipei' } } }
    const batches = splitBatches([enrollment, row, structuredClone(enrollment)])
    expect(batches).toHaveLength(1); expect(batches[0].rows).toHaveLength(2)
    expect(importBatch.safeParse(batches[0]).success).toBe(true)
    expect(importBatch.safeParse({ ...batches[0], rows: [enrollment, row, enrollment] }).success).toBe(false)
    const { app, rpc } = appWith({ rows: [], counts: {} })
    const response = await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization', `Bearer ${'a'.repeat(64)}`).send(batches[0])
    expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledTimes(1)
    const strict = appWith({}, null, true)
    const duplicate = await request(strict.app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization', `Bearer ${'a'.repeat(64)}`).send({ ...batches[0], rows: [enrollment, row, enrollment] })
    expect(duplicate.status).toBe(422);expect(duplicate.body.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { request: ['Duplicate source IDs'] } });expect(strict.rpc).not.toHaveBeenCalled()
  })
  it('derives credential proof and fingerprints on the server, and invokes only the trusted RPC', async () => {
    const { app, rpc } = appWith({ rows: [], counts: {} })
    const response = await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization', `Bearer ${'a'.repeat(64)}`).send({ key: id, rows: [row] })
    expect(response.status).toBe(200)
    expect(rpc.mock.calls[0][0]).toBe('web_extension_workspace')
    expect(rpc.mock.calls[0][1].p_token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(rpc.mock.calls[0][1].p_input.rows[0].source_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(rpc.mock.calls[0][1].p_input.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
  it('uses report content semantics, not lesson completion as completeness', async () => {
    const { app } = appWith({ reports: [{ id, content: '', is_completed: true, lesson_id: id, progress_letter: '', class_participation: 5, classroom_behavior: 5 }] })
    const response = await request(app).get('/api/extension/v1/reports').set('Authorization', `Bearer ${'a'.repeat(64)}`)
    expect(response.body.data.reports[0].completeness.isMissing).toBe(true)
    expect(response.body.data.reports[0].completeness.missingContent).toBe(true)
  })
  it('routes scoped catalog queries through migration 1000119 with bounded pagination', async () => {
    const { app, rpc } = appWith({ items: [{ id, name: 'Room' }], next_cursor: null })
    const response = await request(app).get('/api/extension/v1/catalog?resource=classrooms&limit=50&search=Room').set('Authorization', `Bearer ${'a'.repeat(64)}`)
    expect(response.status).toBe(200)
    expect(rpc.mock.calls[0][0]).toBe('web_extension_catalog')
    expect(rpc.mock.calls[0][1].p_operation).toBe('catalog')
    expect(rpc.mock.calls[0][1].p_input).toMatchObject({ resource: 'classrooms', limit: 50, search: 'Room' })
    const invalid = await request(app).get('/api/extension/v1/catalog?resource=classrooms&limit=51').set('Authorization', `Bearer ${'a'.repeat(64)}`)
    expect(invalid.status).toBe(400)
  })
  it('uses summary paging and strips report text from listing responses', async () => {
    const { app, rpc } = appWith({ reports: [{ id, content: 'private report text', contact_notes: 'private note', updated_at: '2026-10-01' }], next_cursor: null })
    const response = await request(app).get('/api/extension/v1/reports?summary=true&limit=10&search=Student').set('Authorization', `Bearer ${'a'.repeat(64)}`)
    expect(rpc.mock.calls[0][0]).toBe('web_extension_catalog')
    expect(rpc.mock.calls[0][1].p_operation).toBe('reports')
    expect(rpc.mock.calls[0][1].p_input).toMatchObject({ summary: true, limit: 10, search: 'Student' })
    expect(response.body.data.reports[0]).not.toHaveProperty('content')
    expect(response.body.data.reports[0]).not.toHaveProperty('contact_notes')
  })
  it('accepts nearest report filters and a scoped cursor, requiring a valid anchor',async()=>{
    const {app,rpc}=appWith({reports:[],next_cursor:null}),cursor=`n1|${'a'.repeat(32)}|2|0|2024-06-13|${id}`
    const response=await request(app).get(`/api/extension/v1/reports?summary=true&sort=nearest&anchor_date=2024-06-15&student_id=${id}&exclude_course_id=${id}&cursor=${encodeURIComponent(cursor)}`).set('Authorization',`Bearer ${'a'.repeat(64)}`)
    expect(response.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe('web_extension_catalog');expect(rpc.mock.calls[0][1].p_input).toMatchObject({sort:'nearest',anchor_date:'2024-06-15',exclude_course_id:id,student_id:id,cursor})
    expect((await request(app).get('/api/extension/v1/reports?sort=nearest').set('Authorization',`Bearer ${'a'.repeat(64)}`)).status).toBe(400)
    expect((await request(app).get('/api/extension/v1/reports?sort=nearest&anchor_date=2023-02-29').set('Authorization',`Bearer ${'a'.repeat(64)}`)).status).toBe(400)
    expect((await request(app).get(`/api/extension/v1/reports?sort=nearest&anchor_date=2024-06-15&limit=51`).set('Authorization',`Bearer ${'a'.repeat(64)}`)).status).toBe(400)
  })
  it('returns stale preview and permission errors without raw database details', async () => {
    for (const [message, status] of [['PREVIEW_STALE', 409], ['PERMISSION_DENIED', 403], ['EXTENSION_AUTH_INVALID', 401]] as const) {
      const { app } = appWith(null, { message }); const response = await request(app).get('/api/extension/v1/context').set('Authorization', `Bearer ${'a'.repeat(64)}`)
      expect(response.status).toBe(status); expect(response.body.error.code).toBe(message)
    }
  })
  it('does not expose a client confirmation endpoint', async () => {
    const { app, rpc } = appWith({}); const response = await request(app).post('/api/extension/v1/report-pushes/confirm').set('Authorization', `Bearer ${'a'.repeat(64)}`).send({ status: 'confirmed' })
    expect(response.status).toBe(404); expect(rpc).not.toHaveBeenCalled()
  })
})
