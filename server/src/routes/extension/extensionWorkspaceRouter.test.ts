import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createExtensionWorkspaceRouter, importBatch, importRow, pendingPush, importJob, memoryConfirmation, fieldMappingResolve, fieldMappingConfirm, reportDecisionResolve, reportDecisionConfirm, attendanceEvidence, sourceReportConflictsQuery } from './extensionWorkspaceRouter.js'
import { errorHandler } from '../../http/errors.js'
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
  it('bounds report skip decision resolve and revision-checked confirm batches',async()=>{
    const item={source_admission_id:'274452',source_report_id:'6558414',content_fingerprint:'a'.repeat(64),context_fingerprint:'b'.repeat(64),field_fingerprints:{content:'c'.repeat(64),is_completed:'d'.repeat(64)}}
    const body={target_instance:'http://localhost:5173',source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:[item]}
    expect(reportDecisionResolve.safeParse(body).success).toBe(true)
    expect(reportDecisionResolve.safeParse({...body,items:Array(51).fill(item)}).success).toBe(false)
    expect(reportDecisionResolve.safeParse({...body,items:[{...item,source_report_id:'../../other'}]}).success).toBe(false)
    expect(reportDecisionResolve.safeParse({...body,target_instance:'https://user:pass@example.com'}).success).toBe(false)
    expect(reportDecisionConfirm.safeParse({...body,items:[{...item,action:'skip',expected_revision:null}]}).success).toBe(true)
    expect(reportDecisionConfirm.safeParse({...body,items:[{...item,action:'delete',expected_revision:null}]}).success).toBe(false)
    const {app,rpc}=appWith({items:[{...item,status:'none'}]})
    const resolved=await request(app).post('/api/extension/v1/report-decisions/resolve').set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(resolved.status).toBe(200);expect(rpc.mock.calls[0]![0]).toBe('web_extension_report_decisions');expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'resolve',p_input:body})
    const confirmed=await request(app).post('/api/extension/v1/report-decisions/confirm').set('Authorization',`Bearer ${'a'.repeat(64)}`).send({...body,items:[{...item,action:'skip',expected_revision:null}]})
    expect(confirmed.status).toBe(200);expect(rpc.mock.calls[1]![1]).toMatchObject({p_operation:'confirm'})
  })
  it('reads and revision-checks account-wide sync preferences with a bounded field allowlist',async()=>{
    const {app,rpc}=appWith({fields:{attendance_status:false},revision:id})
    const read=await request(app).get('/api/extension/v1/sync-preferences?source_origin=https%3A%2F%2Fcorp.orangeapple.co&adapter_version=orange-apple-v1').set('Authorization','Bearer test')
    expect(read.status).toBe(200);expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'get',p_input:{source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1'}})
    const body={source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',expected_revision:id,fields:[{field_key:'attendance_status',enabled:false},{field_key:'progress_letter',enabled:true}]}
    const saved=await request(app).patch('/api/extension/v1/sync-preferences').set('Authorization','Bearer test').send(body)
    expect(saved.status).toBe(200);expect(rpc.mock.calls.at(-1)![1]).toMatchObject({p_operation:'patch',p_input:body})
    for(const invalid of [{...body,fields:[body.fields[0],body.fields[0]]},{...body,fields:[{field_key:'student_id',enabled:false}]},{...body,expected_revision:'bad'}])expect((await request(app).patch('/api/extension/v1/sync-preferences').send(invalid)).status).toBe(400)
  })
  it('exposes revision-checked work metadata with a strict privacy allowlist and bounded pagination',async()=>{
    const {app,rpc}=appWith({items:[],next_cursor:null})
    const list=await request(app).get('/api/extension/v1/work-records?limit=50').set('Authorization','Bearer test')
    expect(list.status).toBe(200);expect(rpc.mock.calls[0]![0]).toBe('web_extension_work_records');expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'list',p_input:{limit:50}})
    const meta={work_id:id,expected_revision:null,changes:{source_origin:'https://corp.orangeapple.co',source_path:'/courses/dt/4773',source_class_id:'4773',title:'Python 同步',pinned:true,server_job_id:id,submission_round:1}}
    const saved=await request(app).patch(`/api/extension/v1/work-records/${id}`).set('Authorization','Bearer test').send(meta)
    expect(saved.status).toBe(200);expect(rpc.mock.calls.at(-1)![1]).toMatchObject({p_operation:'patch',p_input:meta})
    for(const source_path of ['/courses/dt/4773/lesson_reports','/courses/dt/4773/lesson-reports','/dt_admissions/4773/reports/255723/edit']) {
      const accepted=await request(app).patch(`/api/extension/v1/work-records/${id}`).set('Authorization','Bearer test').send({...meta,expected_revision:id,changes:{source_path,source_class_id:'4773'}})
      expect(accepted.status).toBe(200)
    }
    for(const invalid of [{...meta,changes:{...meta.changes,raw_report:'must not sync'}},{...meta,changes:{...meta.changes,source_path:'/students/4'}},{...meta,changes:{...meta.changes,title:'x'.repeat(101)}},{...meta,changes:{...meta.changes,submission_round:0}},{...meta,actor_id:id}])
      expect((await request(app).patch(`/api/extension/v1/work-records/${id}`).set('Authorization','Bearer test').send(invalid)).status).toBe(400)
    expect((await request(app).get('/api/extension/v1/work-records?limit=51').set('Authorization','Bearer test')).status).toBe(400)
  })
  it('routes bounded effective dates and versioned history binding without forged actors',async()=>{
    const {app,rpc}=appWith({items:[],next_cursor:null})
    const body={enrollment_id:id,dates:['2026-10-03','2026-10-04'],limit:50}
    expect((await request(app).post('/api/extension/v1/history-reports/route').set('Authorization','Bearer test').send(body)).status).toBe(200)
    expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'route',p_input:body})
    for(const invalid of [{...body,dates:Array(51).fill('2026-10-04')},{...body,dates:['2026-02-30']},{...body,user_id:id}])expect((await request(app).post('/api/extension/v1/history-reports/route').send(invalid)).status).toBe(400)
    const binding={key:id,class_occurrence_id:id,history_version:1,overwrite:['content'],include_internal:false,include_fields:['content','attendance_status']}
    expect((await request(app).post(`/api/extension/v1/history-reports/${id}/bind/preview`).set('Authorization','Bearer test').send(binding)).status).toBe(200)
    expect(rpc.mock.calls.at(-1)![1]).toMatchObject({p_operation:'bind-preview',p_input:{...binding,history_id:id}})
    expect((await request(app).post(`/api/extension/v1/history-reports/${id}/bind/apply`).send({...binding,history_version:0})).status).toBe(400)
  })
  it('bounds history evidence, retains half stars and accepts scoped nearest pagination',async()=>{
    const data={enrollment_id:id,report_date:'2026-10-04',source_origin:'https://corp.orangeapple.co',source_admission_id:'301',source_key:'evidence:hash',identity_status:'evidence_only',source_fields:[],class_participation:4.5,source_evidence:[{source_path:'/dt_admissions/301',table:'歷史紀錄',row:1,captured_at:'2026-10-05T00:00:00Z'}]}
    const batch=(extra:object)=>({key:id,rows:[{...row,record:{kind:'history_report',data:{...data,...extra}}}]})
    expect(importBatch.safeParse(batch({})).success).toBe(true)
    expect(importBatch.safeParse(batch({class_participation:4.25})).success).toBe(false)
    expect(importBatch.safeParse(batch({source_evidence:[{...data.source_evidence[0],html:'forbidden'}]})).success).toBe(false)
    const {app,rpc}=appWith({items:[]}),cursor=`h1|${'a'.repeat(32)}|2026-10-04|${id}`
    expect((await request(app).get(`/api/extension/v1/history-reports?student_id=${id}&sort=nearest&anchor_date=2026-10-04&cursor=${encodeURIComponent(cursor)}`).set('Authorization','Bearer test')).status).toBe(200)
    expect(rpc.mock.calls[0]![1].p_input.cursor).toBe(cursor)
    expect((await request(app).get(`/api/extension/v1/history-reports?student_id=${id}&sort=nearest`)).status).toBe(400)
  })
  it('accepts history without a fabricated report identity and rejects private fields',async()=>{
    const history={...row,record:{kind:'history_report',data:{enrollment_id:id,report_date:'2026-10-04',source_origin:'https://corp.orangeapple.co',source_admission_id:'6332',source_key:'evidence:hash',identity_status:'evidence_only',source_fields:[{key:'content',label:'評語',text:''}],class_participation:0,is_completed:false}}}
    expect(importBatch.safeParse({key:id,rows:[history]}).success).toBe(true)
    expect(importBatch.safeParse({key:id,rows:[{...history,record:{...history.record,data:{...history.record.data,password:'forbidden'}}}]}).success).toBe(false)
    const {app,rpc}=appWith({items:[]})
    const response=await request(app).get(`/api/extension/v1/history-reports?student_id=${id}`).set('Authorization','Bearer test')
    expect(response.status).toBe(200);expect(rpc.mock.calls[0]![0]).toBe('web_extension_history')
    const invalid=await request(app).get('/api/extension/v1/history-reports?limit=51').set('Authorization','Bearer test')
    expect(invalid.status).toBe(400);expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('accepts supported report collection evidence paths without widening the route allowlist',()=>{
    const evidence={table:'reports',row:1,captured_at:'2026-10-05T00:00:00Z'}
    const history={source_id:'history:report-page',target_id:id,overwrite:[],record:{kind:'history_report',data:{enrollment_id:id,report_date:'2026-10-04',source_origin:'https://corp.orangeapple.co',source_admission_id:'301',source_key:'evidence:report-page',identity_status:'evidence_only',source_fields:[]}}}
    const valid=['/courses/dt/4773','/courses/dt/4773/lesson_reports','/courses/dt/4773/lesson-reports','/dt_admissions/301','/dt_admissions/301/reports/255723/edit']
    const withEvidencePath=(source_path:string)=>({...history,record:{...history.record,data:{...history.record.data,source_evidence:[{...evidence,source_path}]}}})
    for(const source_path of valid) expect(importBatch.safeParse({key:id,rows:[withEvidencePath(source_path)]}).success).toBe(true)
    for(const source_path of ['/courses/dt/4773/lesson_reports/extra','/courses/dt/4773?tab=reports','https://corp.orangeapple.co/courses/dt/4773/lesson_reports','/students/301'])
      expect(importBatch.safeParse({key:id,rows:[withEvidencePath(source_path)]}).success).toBe(false)
  })
  it('validates the optional atomic history reconciliation metadata strictly',()=>{
    const history={...row,record:{kind:'history_report',data:{enrollment_id:id,report_date:'2026-10-04',source_origin:'https://corp.orangeapple.co',source_admission_id:'6332',source_key:'evidence:hash',identity_status:'evidence_only',source_fields:[],content:'merged'}}}
    const metadata={key:id,class_occurrence_id:id,include_fields:['content'],overwrite:['content'],include_internal:false}
    expect(importRow.safeParse({...history,history_reconciliation:metadata}).success).toBe(true)
    expect(importRow.safeParse({...history,history_reconciliation:{...metadata,previewFingerprint:'secret'}}).success).toBe(false)
    expect(importRow.safeParse({...row,history_reconciliation:metadata}).success).toBe(false)
    expect(importRow.safeParse({...history,history_reconciliation:{...metadata,include_fields:['private']}}).success).toBe(false)
  })
  it('bounds and isolates field memory RPCs from identity confirmation and forged actors',async()=>{
    const item={field_key:'attendance_status',course_id:id,options_signature:JSON.stringify([['attended','出席',false]])}
    const body={source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1',items:[item]}
    expect(fieldMappingResolve.safeParse({...body,user_id:id}).success).toBe(false)
    expect(fieldMappingResolve.safeParse({...body,items:Array(51).fill(item)}).success).toBe(false)
    expect(fieldMappingResolve.safeParse({...body,items:[{...item,options_signature:'[1]'}]}).success).toBe(false)
    expect(fieldMappingResolve.safeParse({...body,source_origin:'https://other.example'}).success).toBe(false)
    expect(fieldMappingConfirm.safeParse({...body,items:[{...item,source_value:'attended',action:'confirm',expected_revision:null}]}).success).toBe(false)
    const {app,rpc}=appWith({items:[]})
    const resolved=await request(app).post('/api/extension/v1/field-mappings/resolve').set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(resolved.status).toBe(200);expect(rpc.mock.calls[0][0]).toBe('web_extension_field_mappings')
    expect(rpc.mock.calls[0][1]).toMatchObject({p_operation:'resolve',p_token_id:id,p_input:body})
    const result=await request(app).post('/api/extension/v1/field-mappings/confirm').set('Authorization',`Bearer ${'a'.repeat(64)}`).send({...body,items:[{...item,source_value:'attended',canonical_value:'present',action:'confirm',expected_revision:null}]})
    expect(result.status).toBe(200);expect(rpc.mock.calls[1][1].p_operation).toBe('confirm')
  })
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
    const modelUrl = new URL('../../../../extension/workspace-model.js', import.meta.url)
    const { splitBatches } = await import(modelUrl.href)
    const enrollment = { source_id: '277332', target_id: '00000000-0000-4000-8000-000000000002', overwrite: [], record: { kind: 'enrollment', data: { student_id: id, course_id: id, class_session_id: id, classroom_id: id, status: 'regular', start_date: '2026-01-01', time_zone: 'Asia/Taipei' } } }
    const batches = splitBatches([enrollment, row, structuredClone(enrollment)])
    expect(batches).toHaveLength(1); expect(batches[0].rows).toHaveLength(2)
    expect(importBatch.safeParse(batches[0]).success).toBe(true)
    expect(importBatch.safeParse({ ...batches[0], rows: [enrollment, row, enrollment] }).success).toBe(false)
    const { app, rpc } = appWith({ rows: [], counts: {} })
    const response = await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization', `Bearer ${'a'.repeat(64)}`).send(batches[0])
    expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledTimes(2);expect(rpc.mock.calls[1]![0]).toBe('web_extension_import_batch_manifest')
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
  it('rejects extension-local preview metadata before invoking any import RPC', async () => {
    const { app, rpc } = appWith({ rows: [], counts: {} })
    const response = await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization', `Bearer ${'a'.repeat(64)}`).send({ key: id, rows: [row], previewFingerprint: 'a'.repeat(64) })
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
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
  it('accepts bounded same-job preview dependencies and rejects duplicate or forged references', async()=>{
    const dependency={key:id,fingerprint:'a'.repeat(64)},body={key:'00000000-0000-4000-8000-000000000002',rows:[row],dependencies:[dependency]}
    expect(importBatch.safeParse(body).success).toBe(true)
    expect(importBatch.safeParse({...body,dependencies:Array(51).fill(dependency)}).success).toBe(false)
    expect(importBatch.safeParse({...body,dependencies:[dependency,dependency]}).success).toBe(false)
    expect(importBatch.safeParse({...body,dependencies:[{...dependency,fingerprint:'invalid'}]}).success).toBe(false)
    const {app,rpc}=appWith({rows:[],counts:{}})
    const response=await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'b'.repeat(64)}`).send(body)
    expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]![1].p_input).toMatchObject({dependencies:[dependency]})
    expect(rpc.mock.calls[1]![0]).toBe('web_extension_import_batch_manifest')
    expect(rpc.mock.calls[1]![1]).toMatchObject({p_action:'save',p_manifest:[],p_dependencies:[dependency]})
    expect(response.body.data.batch_fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
  it('fails safely when the server cannot verify cross-batch references', async()=>{
    const dependency={key:id,fingerprint:'a'.repeat(64)},body={key:'00000000-0000-4000-8000-000000000002',rows:[row],dependencies:[dependency]}
    const {app,rpc}=appWith({rows:[],counts:{}})
    rpc.mockResolvedValueOnce({data:{rows:[],counts:{}},error:null}).mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'Could not find the function public.web_extension_import_batch_manifest'}})
    const response=await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(response.status).toBe(503);expect(response.body.error.code).toBe('IMPORT_DEPENDENCIES_UNAVAILABLE');expect(response.body.error.message).not.toContain('1000130')
  })
  it('returns safe row-scoped diagnostics for reference failures and a generic issue for old database errors',async()=>{
    const detail=JSON.stringify({kind:'history_report',source_id:'301:report:401',field:'lesson_id',reason:'LESSON_COURSE_MISMATCH'})
    const body={key:id,rows:[{...row,record:{kind:'history_report',data:{enrollment_id:id,report_date:'2026-10-04',source_origin:'https://corp.orangeapple.co',source_admission_id:'301',source_key:'evidence:hash',identity_status:'evidence_only',source_fields:[]}}}]}
    const {app}=appWith(null,{message:'INVALID_REFERENCE',details:detail},true)
    const response=await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(response.status).toBe(422);expect(response.body.error.fields).toEqual({'rows.history_report.301:report:401.lesson_id':['LESSON_COURSE_MISMATCH']})
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE')
    const legacy=appWith(null,{message:'INVALID_REFERENCE'},true).app
    const fallback=await request(legacy).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(fallback.status).toBe(422);expect(fallback.body.error.fields).toEqual({job:['REFERENCE_CHECK_FAILED']})
  })
  it('returns bounded item-scoped diagnostics for mapping revision conflicts',async()=>{
    const key='124931',body={source_origin:'https://corp.orangeapple.co',source_class_id:'4773',items:[{kind:'student',key,target_id:id,action:'confirm',expected_revision:null,versions:{[id]:'a'.repeat(32)}}]}
    const details=JSON.stringify({kind:'student',key,field:'expected_revision',reason:'MEMORY_REVISION_CHANGED'})
    const {app}=appWith(null,{message:'VERSION_CONFLICT',details},true)
    const response=await request(app).post('/api/extension/v1/catalog/confirm').set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.fields).toEqual({[`items.student.${key}.expected_revision`]:['MEMORY_REVISION_CHANGED']})
    expect(JSON.stringify(response.body)).not.toContain('target_id')
    const old=appWith(null,{message:'VERSION_CONFLICT'},true).app
    const fallback=await request(old).post('/api/extension/v1/catalog/confirm').set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(fallback.status).toBe(409);expect(fallback.body.error.fields).toBeUndefined()
  })
  it('returns stale preview and permission errors without raw database details', async () => {
    for (const [message, status] of [['PREVIEW_STALE', 409], ['PERMISSION_DENIED', 403], ['EXTENSION_AUTH_INVALID', 401]] as const) {
      const { app } = appWith(null, { message }); const response = await request(app).get('/api/extension/v1/context').set('Authorization', `Bearer ${'a'.repeat(64)}`)
      expect(response.status).toBe(status); expect(response.body.error.code).toBe(message)
    }
  })
  it('returns bounded, request-scoped diagnostics for stale import previews', async()=>{
    const batchKey=id,body={key:batchKey,rows:[row]}
    const details=JSON.stringify({diagnostic_source:'version_check',kind:'batch',source_id:batchKey,field:'preview',reason:'REQUEST_FINGERPRINT_CHANGED',expected_version:'a'.repeat(64),actual_version:'b'.repeat(64)})
    const {app}=appWith(null,{message:'PREVIEW_STALE',details},true)
    const response=await request(app).post(`/api/extension/v1/imports/${id}/apply`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.fields).toEqual({[`batches.${batchKey}.preview`]:['REQUEST_FINGERPRINT_CHANGED']})
    expect(response.body.error.diagnostic_source).toBe('version_check')
    expect(JSON.stringify(response.body)).not.toContain('Test A')
    const unsafe=appWith(null,{message:'PREVIEW_STALE',details:JSON.stringify({kind:'student',source_id:'../../secret',field:'target_version',reason:'TARGET_VERSION_CHANGED'})},true).app
    const fallback=await request(unsafe).post(`/api/extension/v1/imports/${id}/apply`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(fallback.status).toBe(409);expect(fallback.body.error.fields).toBeUndefined()
    expect(fallback.body.error.diagnostic_source).toBeUndefined()
    const legacy=appWith(null,{message:'PREVIEW_STALE',details:JSON.stringify({kind:'student',source_id:'101',field:'target_version',reason:'TARGET_VERSION_CHANGED'})},true).app
    const legacyResponse=await request(legacy).post(`/api/extension/v1/imports/${id}/apply`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(legacyResponse.status).toBe(409);expect(legacyResponse.body.error.fields).toBeUndefined();expect(legacyResponse.body.error.diagnostic_source).toBeUndefined()
  })
  it('records bounded attendance evidence for rows without a source report identity',async()=>{
    const item={enrollment_id:id,source_admission_id:'6001',source_class_id:'4773',evidence_date:'2026-10-04',attendance_count:2,present_count:1,absent_count:1}
    const body={source_origin:'https://corp.orangeapple.co',items:[item]}
    expect(attendanceEvidence.safeParse(body).success).toBe(true)
    for(const invalid of [{...body,items:[]},{...body,items:Array(51).fill(item)},{...body,items:[{...item,present_count:2}]},{...body,items:[{...item,attendance_count:0}]},{...body,items:[{...item,source_report_id:'401'}]},{...body,items:[{...item,source_admission_id:'../1'}]},{...body,source_origin:'https://other.example'}])
      expect(attendanceEvidence.safeParse(invalid).success).toBe(false)
    const {app,rpc}=appWith({items:[item]})
    const saved=await request(app).post('/api/extension/v1/attendance-evidence').set('Authorization','Bearer test').send(body)
    expect(saved.status).toBe(200);expect(rpc.mock.calls[0]![0]).toBe('web_extension_attendance_evidence');expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'record',p_input:body})
    const listed=await request(app).get(`/api/extension/v1/attendance-evidence?enrollment_id=${id}&before_date=2026-10-05&limit=20`).set('Authorization','Bearer test')
    expect(listed.status).toBe(200);expect(rpc.mock.calls[1]![1]).toMatchObject({p_operation:'list',p_input:{enrollment_id:id,before_date:'2026-10-05',limit:20}})
    expect((await request(app).get('/api/extension/v1/attendance-evidence?enrollment_id=bad').set('Authorization','Bearer test')).status).toBe(400)
  })
  it('lists the source report conflict report with bounded filters and pagination',async()=>{
    expect(sourceReportConflictsQuery.safeParse({action:'superseded',limit:'10',cursor:id}).success).toBe(true)
    for(const invalid of [{action:'deleted'},{limit:'51'},{cursor:'../x'},{user_id:id}])expect(sourceReportConflictsQuery.safeParse(invalid).success).toBe(false)
    const {app,rpc}=appWith({summary:{kept:1,superseded:1},items:[],next_cursor:null})
    const response=await request(app).get('/api/extension/v1/source-report-conflicts?action=superseded&limit=10').set('Authorization','Bearer test')
    expect(response.status).toBe(200);expect(response.body.data.summary.superseded).toBe(1)
    expect(rpc.mock.calls[0]![0]).toBe('web_extension_source_report_conflicts');expect(rpc.mock.calls[0]![1]).toMatchObject({p_operation:'list',p_input:{action:'superseded',limit:10}})
  })
  it('names the row and reason of a source report identity conflict without raw details',async()=>{
    const body={key:id,rows:[row]}
    const details=JSON.stringify({kind:'history_report',source_id:'301:report:401',field:'source_report_id',reason:'SOURCE_REPORT_ALREADY_IMPORTED'})
    const {app}=appWith(null,{message:'SOURCE_MAPPING_CONFLICT',details},true)
    const response=await request(app).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(response.status).toBe(409);expect(response.body.error.code).toBe('SOURCE_MAPPING_CONFLICT')
    expect(response.body.error.fields).toEqual({'rows.history_report.301:report:401.source_report_id':['SOURCE_REPORT_ALREADY_IMPORTED']})
    const required=appWith(null,{message:'INVALID_IMPORT',details:JSON.stringify({kind:'history_report',source_id:'301:evidence',field:'source_report_id',reason:'REPORT_IDENTITY_REQUIRED'})},true).app
    const missing=await request(required).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(missing.status).toBe(422);expect(missing.body.error.fields).toEqual({'rows.history_report.301:evidence.source_report_id':['REPORT_IDENTITY_REQUIRED']})
    const unsafe=appWith(null,{message:'SOURCE_MAPPING_CONFLICT',details:JSON.stringify({kind:'history_report',source_id:'301',field:'source_report_id',reason:'SELECT secret'})},true).app
    const fallback=await request(unsafe).post(`/api/extension/v1/imports/${id}/preview`).set('Authorization',`Bearer ${'a'.repeat(64)}`).send(body)
    expect(fallback.status).toBe(409);expect(fallback.body.error.fields).toBeUndefined()
  })
  it('does not expose a client confirmation endpoint', async () => {
    const { app, rpc } = appWith({}); const response = await request(app).post('/api/extension/v1/report-pushes/confirm').set('Authorization', `Bearer ${'a'.repeat(64)}`).send({ status: 'confirmed' })
    expect(response.status).toBe(404); expect(rpc).not.toHaveBeenCalled()
  })
})
