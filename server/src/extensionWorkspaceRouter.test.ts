import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createExtensionWorkspaceRouter, importBatch, pendingPush, importJob, memoryConfirmation } from './extensionWorkspaceRouter.js'
const id = '00000000-0000-4000-8000-000000000001'
const row = { source_id: '101', target_id: id, overwrite: [], record: { kind: 'student', data: { name: 'Test A' } } }
function appWith(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error }), app = express(); app.use(express.json())
  app.use((req, _res, next) => { req.extensionPrincipal = { userId: id, tokenId: id, extensionOrigin: `chrome-extension://${'a'.repeat(32)}`, connection: {} as never }; next() })
  app.use('/api/extension/v1', createExtensionWorkspaceRouter({ rpc } as unknown as SupabaseClient))
  app.use((error: { status?: number; code?: string; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 400).json({ error: { code: error.code, message: error.message } }))
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
  it('rejects oversized, duplicate, sensitive or forged actor payloads', () => {
    expect(importBatch.safeParse({ key: id, rows: Array.from({ length: 51 }, () => row) }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [row, row] }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [{ ...row, record: { kind: 'student', data: { name: 'A', phone: 'sensitive' } } }] }).success).toBe(false)
    expect(importBatch.safeParse({ key: id, rows: [row], user_id: id }).success).toBe(false)
    expect(pendingPush.safeParse({ status: 'confirmed' }).success).toBe(false)
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
