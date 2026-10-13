// Isolated PostgreSQL contract test. No application database is contacted.
// node <this-file> <path-to-pglite/dist/index.js>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../../server/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
const read = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(1), token = id(2), room = id(3), course = id(4), session = id(5), teaching = id(6)
async function rpc(operation, input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_workspace($1,$2,$3,$4) AS data', [token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
}
async function rpcManifest(jobId,batchKey,fingerprint,manifest=[],dependencies=[],action='save') {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_import_batch_manifest($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8) AS data',[token,'a'.repeat(64),jobId,batchKey,fingerprint,JSON.stringify(manifest),JSON.stringify(dependencies),action])).rows[0].data
}
async function rpcCatalog(operation, input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_catalog($1,$2,$3,$4) AS data', [token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
}
async function rpcImportInfo(input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_import_info($1,$2,$3,$4) AS data', [token,'a'.repeat(64),'info',JSON.stringify(input)])).rows[0].data
}
async function rpcFinalize(input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_finalize_import($1,$2,$3,$4) AS data', [token,'a'.repeat(64),'complete',JSON.stringify(input)])).rows[0].data
}
async function workRecordsRpc(operation,input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_work_records($1,$2,$3,$4) AS data',[token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
}
async function reportDecisionRpc(operation,input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_report_decisions($1,$2,$3,$4) AS data',[token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
}
async function rpcEnrollmentInfo(input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_enrollment_info($1,$2,$3,$4) AS data', [token,'a'.repeat(64),'enrollment-info',JSON.stringify(input)])).rows[0].data
}
try {
  await db.exec(readFileSync(new URL('postgres_bootstrap.sql', import.meta.url), 'utf8'))
  await db.exec('CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;')
  for (const name of ['1000001_core_schema.sql','1000002_academics.sql','1000003_operations.sql','1000008_session_time_zones.sql','1000009_date_record_time_zones.sql','1000024_recurring_and_camp_sessions.sql']) await db.exec(read(name).replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g,''))
  await db.exec(`CREATE TABLE public.teachings(id uuid PRIMARY KEY,is_global boolean DEFAULT true);
    ALTER TABLE public.classrooms ADD COLUMN teaching_id uuid; ALTER TABLE public.courses ADD COLUMN teaching_id uuid;
    ALTER TABLE public.class_sessions ADD COLUMN teaching_id uuid;
    CREATE TABLE public.denied_permissions(permission text PRIMARY KEY);
    CREATE FUNCTION public.has_teaching_permission(uuid,text,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.role()='authenticated' AND auth.uid()=$1 AND NOT EXISTS(SELECT 1 FROM public.denied_permissions WHERE permission=$2) $$;
    CREATE FUNCTION public.has_api_permission(uuid,text,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_teaching_permission($1,$2,NULL,$3,$4) $$;
    CREATE FUNCTION public.is_teaching_member(uuid,uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.role()='authenticated' AND auth.uid()=$2 $$;
    CREATE FUNCTION public.can_access_classroom(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.classrooms WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,$1,NULL) $$;
    CREATE FUNCTION public.can_access_class_session(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.class_sessions WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,$1) $$;
    CREATE FUNCTION public.can_access_student(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.students WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,NULL) $$;
    CREATE FUNCTION public.can_access_enrollment(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.enrollments WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,NULL) $$;
    CREATE FUNCTION public.can_access_enrollment_scope(uuid,uuid,uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_api_permission(auth.uid(),$5,$3,$4) $$;
    CREATE FUNCTION public.can_access_report(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.occurrence_reports WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,NULL) $$;
    CREATE FUNCTION public.can_create_occurrence_report(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_api_permission(auth.uid(),'teaching.reports.create',NULL,NULL) $$;
    CREATE FUNCTION public.get_effective_attendance(uuid,uuid,boolean) RETURNS TABLE(attendance_status text,absence_reason text) LANGUAGE sql AS $$ SELECT 'pending'::text,NULL::text $$;
    ALTER TABLE public.holidays ADD COLUMN kind text DEFAULT 'closure';
    ALTER TABLE public.occurrence_reports ADD COLUMN content_document jsonb,ADD COLUMN contact_notes_document jsonb,ADD COLUMN class_notes_document jsonb;
    INSERT INTO auth.users(id) VALUES('${actor}'); INSERT INTO public.teachings(id) VALUES('${teaching}');
    INSERT INTO public.classrooms(id,name,user_id,teaching_id) VALUES('${room}','Test room','${actor}','${teaching}');
    INSERT INTO public.courses(id,subject,stage,user_id,teaching_id) VALUES('${course}','Test','1','${actor}','${teaching}');
    INSERT INTO public.class_sessions(id,name,classroom_id,course_ids,start_time,end_time,user_id,teaching_id) VALUES('${session}','Test class','${room}',ARRAY['${course}'::uuid],'09:00','10:00','${actor}','${teaching}');`)
  await db.exec(read('1000062_report_lifecycle_atomicity.sql'))
  await db.exec(read('1000116_web_extension_integrations.sql'))
  await db.exec(read('1000118_web_extension_workspace.sql'))
  await db.exec(read('1000119_extension_catalog.sql'))
  await db.exec(read('1000120_extension_mapping_memory.sql'))
  await db.exec(read('1000030_single_lesson_transfers.sql').split('CREATE OR REPLACE FUNCTION')[0])
  await db.exec(read('1000030_single_lesson_transfers.sql').match(/CREATE OR REPLACE FUNCTION public\.get_effective_occurrence_enrollment_ids[\s\S]*?\$\$;/)[0])
  await db.exec(read('1000121_extension_reconciliation.sql'))
  await db.exec(`CREATE FUNCTION public.get_class_session_workspace(uuid,date) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object('session',jsonb_build_object('id',$1),'enrollments',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',e.id,'class_session_id',e.class_session_id,'status',e.status,'start_date',e.start_date))
      FROM public.enrollments e WHERE e.class_session_id=$1 AND e.start_date<=$2 AND e.status IN ('regular','completed')
    ),'[]'::jsonb),'teachers','[]'::jsonb)
  $$;`)
  await db.exec(read('1000122_extension_import_verification.sql'))
  await db.exec(read('1000123_extension_report_candidates.sql'))
  await db.exec(read('1000124_extension_field_mappings.sql'))
  await db.exec(read('1000125_extension_transferred_occurrence_import.sql'))
  await db.exec(read('1000126_enrollment_history_reports.sql'))
  await db.exec(read('1000127_extension_shared_mappings_and_sync_preferences.sql'))
  await db.exec(read('1000130_import_preview_dependencies_and_diagnostics.sql'))
  await db.exec(read('1000131_extension_work_record_metadata.sql'))
  await db.exec(read('1000132_extension_report_skip_decisions.sql'))
  await db.exec(read('1000133_extension_mapping_memory_reasons.sql'))
  await db.exec(read('1000134_atomic_history_reconciliation.sql'))
  await db.exec(read('1000135_extension_mapping_conflict_diagnostics.sql'))
  await db.exec(read('1000136_import_preview_diagnostics_and_work_rounds.sql'))
  await db.exec(read('1000137_consistent_preview_stale_diagnostics.sql'))
  await db.exec(read('1000138_paused_import_repreview.sql'))
  await db.exec(read('1000139_precise_preview_stale_diagnostics.sql'))
  await db.exec(read('1000140_report_page_source_paths.sql'))
  await db.exec(`INSERT INTO public.web_extension_tokens(id,user_id,extension_origin,token_hash) VALUES('${token}','${actor}','chrome-extension://${'a'.repeat(32)}','${'a'.repeat(64)}')`)
  const destination = { source_origin:'https://corp.orangeapple.co',source_class_id:'11',date_from:'2026-01-01',date_to:'2026-12-31',classroom_id:room,course_id:course,class_session_id:session }
  const job = await rpc('job',destination), student = id(10)
  const workMetaId=id(901),metadata=await workRecordsRpc('patch',{work_id:workMetaId,expected_revision:null,changes:{source_origin:destination.source_origin,source_path:'/courses/dt/11',source_class_id:'11',source_label:'測試班級',title:'Python 同步',target_classroom_id:room,target_class_session_id:session,server_job_id:job.id,submission_round:1,pinned:true}})
  assert.equal(metadata.item.server_job_id,job.id);assert.equal(metadata.item.title,'Python 同步');assert.equal(metadata.item.pinned,true)
  assert.equal(metadata.item.submission_rounds.length,1);assert.equal(metadata.item.submission_rounds[0].round_no,1);assert.equal(metadata.item.submission_rounds[0].job_id,job.id)
  const roundTwoJob=await rpc('job',destination)
  const roundTwo=await workRecordsRpc('patch',{work_id:workMetaId,expected_revision:metadata.item.revision,changes:{source_origin:destination.source_origin,source_class_id:'11',target_classroom_id:room,target_class_session_id:session,server_job_id:roundTwoJob.id,submission_round:2}})
  assert.deepEqual(roundTwo.item.submission_rounds.map(item=>item.round_no),[1,2])
  const metadataPage=await workRecordsRpc('list',{limit:1});assert.equal(metadataPage.items.length,1);assert.equal(metadataPage.items[0].work_id,workMetaId);assert.deepEqual(metadataPage.items[0].submission_rounds.map(item=>item.round_no),[1,2])
  await assert.rejects(workRecordsRpc('patch',{work_id:workMetaId,expected_revision:null,changes:{title:'舊版本'}}),/VERSION_CONFLICT/)
  for(const [index,source_path] of ['/courses/dt/11/lesson_reports','/courses/dt/11/lesson-reports','/dt_admissions/301/reports/401/edit'].entries()) {
    const savedPath=await workRecordsRpc('patch',{work_id:id(910+index),expected_revision:null,changes:{source_path,source_class_id:'11'}})
    assert.equal(savedPath.item.source_path,source_path,'resume metadata preserves the exact captured source route')
  }
  await assert.rejects(workRecordsRpc('patch',{work_id:id(902),expected_revision:null,changes:{source_path:'/students/11',source_class_id:'11'}}),/INVALID_IMPORT/)
  await assert.rejects(workRecordsRpc('patch',{work_id:id(903),expected_revision:null,changes:{source_path:'/courses/dt/11',source_class_id:'11',title:'x',raw_report:'private'}}),/INVALID_IMPORT/)
  await assert.rejects(workRecordsRpc('patch',{work_id:id(904),expected_revision:null,changes:{source_path:'/courses/dt/12',source_class_id:'12',server_job_id:job.id}}),/INVALID_REFERENCE/)
  const decisionBase={target_instance:'https://edulog.example',source_origin:'https://corp.orangeapple.co',adapter_version:'orange-apple-v1'}
  const decisionItem={source_admission_id:'274452',source_report_id:'6558414',content_fingerprint:'a'.repeat(64),context_fingerprint:'b'.repeat(64),field_fingerprints:{content:'c'.repeat(64),is_completed:'d'.repeat(64)}}
  assert.equal((await reportDecisionRpc('capabilities',{})).report_skip_decisions,true)
  assert.equal((await reportDecisionRpc('resolve',{...decisionBase,items:[decisionItem]})).items[0].status,'none')
  const savedDecision=(await reportDecisionRpc('confirm',{...decisionBase,items:[{...decisionItem,action:'skip',expected_revision:null}]})).items[0]
  assert.equal(savedDecision.status,'skipped')
  assert.equal((await reportDecisionRpc('resolve',{...decisionBase,items:[decisionItem]})).items[0].status,'skipped')
  const changedDecision={...decisionItem,content_fingerprint:'e'.repeat(64),field_fingerprints:{...decisionItem.field_fingerprints,content:'f'.repeat(64)}}
  const changedResult=(await reportDecisionRpc('resolve',{...decisionBase,items:[changedDecision]})).items[0]
  assert.equal(changedResult.status,'review');assert.equal(changedResult.reason,'content_changed');assert.deepEqual(changedResult.changed_fields,['content'])
  const refreshed=(await reportDecisionRpc('confirm',{...decisionBase,items:[{...changedDecision,action:'skip',expected_revision:changedResult.revision}]})).items[0]
  await db.query('UPDATE public.web_extension_report_skip_decisions SET expires_at=now()-interval \'1 second\' WHERE source_report_id=$1',['6558414'])
  const expired=(await reportDecisionRpc('resolve',{...decisionBase,items:[changedDecision]})).items[0];assert.equal(expired.status,'review');assert.equal(expired.reason,'expired')
  await assert.rejects(reportDecisionRpc('confirm',{...decisionBase,items:[{...changedDecision,action:'clear',expected_revision:savedDecision.revision}]}),/VERSION_CONFLICT/)
  await reportDecisionRpc('confirm',{...decisionBase,items:[{...changedDecision,action:'clear',expected_revision:expired.revision}]})
  assert.equal((await reportDecisionRpc('resolve',{...decisionBase,items:[changedDecision]})).items[0].status,'none')
  const internalDecision={...decisionItem,field_fingerprints:{...decisionItem.field_fingerprints,class_notes:'g'.repeat(64)}}
  const internalSaved=(await reportDecisionRpc('confirm',{...decisionBase,items:[{...internalDecision,action:'skip',expected_revision:null}]})).items[0]
  assert.equal((await reportDecisionRpc('resolve',{...decisionBase,items:[decisionItem]})).items[0].status,'skipped')
  const changedInternal={...internalDecision,field_fingerprints:{...internalDecision.field_fingerprints,class_notes:'h'.repeat(64)}}
  const internalChanged=(await reportDecisionRpc('resolve',{...decisionBase,items:[changedInternal]})).items[0]
  assert.equal(internalChanged.status,'review');assert.deepEqual(internalChanged.changed_fields,['class_notes'])
  assert.equal((await reportDecisionRpc('resolve',{...decisionBase,target_instance:'https://other.example',items:[changedDecision]})).items[0].status,'none')
  console.log('PASS: 1000131 work metadata; 1000132 skip-decision scoping, content-change detection, 30-day expiry, revision checks and clear')
  const batch = { job_id:job.id,key:id(20),fingerprint:'b'.repeat(64),rows:[{source_id:'101',target_id:student,overwrite:[],record:{kind:'student',data:{name:'Deidentified A'}}}] }
  assert.equal((await rpc('preview',batch)).rows[0].status,'added')
  await assert.rejects(rpcFinalize({job_id:job.id,expected_batch_keys:[batch.key]}),/IMPORT_BATCHES_INCOMPLETE/)
  assert.equal((await rpc('apply',batch)).applied,1)
  assert.equal((await rpc('apply',batch)).applied,1)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.students')).rows[0].n,1)
  await assert.rejects(rpc('apply',{...batch,fingerprint:'c'.repeat(64)}),/IDEMPOTENCY_CONFLICT/)
  const retry = {...batch,key:id(21),fingerprint:'c'.repeat(64),rows:[{...batch.rows[0],record:{kind:'student',data:{name:'Source changed'}}}]}
  assert.equal((await rpc('preview',retry)).rows[0].status,'conflict')
  await rpc('apply',retry)
  assert.equal((await db.query('SELECT name FROM public.students')).rows[0].name,'Deidentified A')
  const update = {...retry,key:id(22),fingerprint:'d'.repeat(64),rows:[{...retry.rows[0],overwrite:['name']}]}
  assert.equal((await rpc('preview',update)).rows[0].status,'updated')
  await assert.rejects(rpc('apply',{...update,fingerprint:'f'.repeat(64)}),error=>error.message==='PREVIEW_STALE'&&JSON.parse(error.detail).reason==='REQUEST_FINGERPRINT_CHANGED')
  await db.exec(`UPDATE public.students SET name='EduLog edited' WHERE id='${student}'`)
  await assert.rejects(rpc('apply',update),error=>error.message==='PREVIEW_STALE'&&JSON.parse(error.detail).reason==='TARGET_VERSION_CHANGED'&&JSON.parse(error.detail).source_id==='101')
  // A full 50-row batch must diagnose the row that actually changed. The
  // earlier diagnostic compared md5 preview versions to updated_at, causing
  // the first, unchanged student to be reported instead.
  const diagnosticStudents=Array.from({length:50},(_,i)=>({
    source_id:`diag-${i+1}`,
    target_id:i===0?student:id(100+i),
    overwrite:[],
    record:{kind:'student',data:{name:i===0?'EduLog edited':`Diagnostic ${i+1}`}}
  }))
  for(let i=1;i<50;i++)await db.query('INSERT INTO public.students(id,name,user_id) VALUES($1,$2,$3)',[id(100+i),`Diagnostic ${i+1}`,actor])
  const diagnosticBatch={job_id:job.id,key:id(24),fingerprint:'9'.repeat(64),rows:diagnosticStudents}
  assert.equal((await rpc('preview',diagnosticBatch)).counts.unchanged,50)
  await db.query('UPDATE public.students SET name=$1 WHERE id=$2',["Changed after preview",id(149)])
  await assert.rejects(rpc('apply',diagnosticBatch),error=>{
    if(error.message!=='PREVIEW_STALE')return false
    const detail=JSON.parse(error.detail)
    return detail.reason==='TARGET_VERSION_CHANGED'&&detail.kind==='student'&&detail.source_id==='diag-50'
  })
  // Re-preview the same immutable batch key, then apply after the teacher has
  // seen the refreshed comparison. The first 49 rows remain unchanged.
  const refreshedDiagnostic=await rpc('preview',diagnosticBatch)
  assert.equal(refreshedDiagnostic.rows.find(row=>row.source_id==='diag-50').status,'conflict')
  assert.equal((await rpc('apply',diagnosticBatch)).applied,50)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.students.update')")
  await assert.rejects(rpc('preview',update),/PERMISSION_DENIED/)
  await db.exec('DELETE FROM public.denied_permissions')
  // A failure late in a batch rolls back previous inserts and source links.
  const partial = {...batch,key:id(23),fingerprint:'e'.repeat(64),rows:[{source_id:'102',target_id:id(11),overwrite:[],record:{kind:'student',data:{name:'B'}}},{source_id:'201',target_id:id(12),overwrite:[],record:{kind:'enrollment',data:{student_id:id(11),course_id:course,classroom_id:room,class_session_id:id(99),status:'regular',start_date:'2026-01-01',time_zone:'Asia/Taipei'}}}]}
  await rpc('preview',partial); await assert.rejects(rpc('apply',partial),/INVALID_REFERENCE/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.students')).rows[0].n,50)
  const verifiedJob = await rpc('job',{...destination,source_class_id:'13'})
  const verifiedBatch = {job_id:verifiedJob.id,key:id(890),fingerprint:'7'.repeat(64),rows:[{source_id:'verified-1',target_id:id(900),overwrite:[],record:{kind:'student',data:{name:'Verified student'}}}]}
  await rpc('preview',verifiedBatch);await rpc('apply',verifiedBatch)
  const finalized = await rpcFinalize({job_id:verifiedJob.id,expected_batch_keys:[verifiedBatch.key]})
  assert.equal(finalized.verified,true);assert.equal(finalized.applied_rows,1)
  const verifiedInfo = await rpcImportInfo({job_id:verifiedJob.id,roster_date:'2026-10-03'})
  assert.equal(verifiedInfo.job.status,'complete');assert.equal(verifiedInfo.batches[0].status,'applied');assert.equal(verifiedInfo.roster.enrollments.length,0)
  const enrollment = id(30), occurrence = id(31), report = id(32)
  await db.exec(`INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,user_id) VALUES('${enrollment}','${student}','${course}','${room}','${session}','${actor}'); INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) VALUES('${occurrence}','${session}','2026-10-02'); INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content) VALUES('${report}','${enrollment}','${occurrence}','Report');`)
  const push = {report_id:report,report_version:1,source_origin:destination.source_origin,source_report_url:'https://corp.orangeapple.co/dt_admissions/301/reports/401',source_id:'401',target_fingerprint:'f'.repeat(64),idempotency_key:id(40)}
  const enrollmentInfo = await rpcEnrollmentInfo({enrollment_id:enrollment});assert.equal(enrollmentInfo.student_id,student);assert.equal(enrollmentInfo.class_session_id,session)
  assert.equal((await rpc('pending-push',push)).status,'pending_confirmation')
  await rpc('pending-push',push)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.web_extension_report_pushes')).rows[0].n,1)
  assert.equal((await db.query('SELECT external_link FROM public.occurrence_reports')).rows[0].external_link,null)
  const reports = await rpc('reports',{}); assert.equal(reports.reports[0].student_name,'EduLog edited')
  const catalogCaps = await rpcCatalog('capabilities',{}); assert.equal(catalogCaps.catalog_version,1)
  const classroomPage = await rpcCatalog('catalog',{resource:'classrooms',limit:1}); assert.equal(classroomPage.items.length,1)
  const coursePage = await rpcCatalog('catalog',{resource:'courses',classroom_id:room,limit:50}); assert.equal(coursePage.items[0].id,course)
  const studentPage = await rpcCatalog('catalog',{resource:'students',search:'EduLog edited',limit:50}); assert.equal(studentPage.items[0].name,'EduLog edited')
  const resolved = await rpcCatalog('resolve',{source_refs:[{source_kind:'student',source_id:'101'}],target_refs:[{kind:'students',id:student}]})
  assert.equal(resolved.source_links[0].target_id,student); assert.equal(resolved.targets[0].name,'EduLog edited'); assert.equal(resolved.targets[0].gov_id,undefined)
  const reportSummary = await rpcCatalog('reports',{summary:true,limit:1,date_from:'2026-10-02',date_to:'2026-10-02'})
  assert.equal(reportSummary.reports.length,1); assert.ok(reportSummary.next_cursor)
  const reportNext = await rpcCatalog('reports',{summary:true,limit:1,cursor:reportSummary.next_cursor,date_from:'2026-10-02',date_to:'2026-10-02'})
  assert.equal(reportNext.reports.length,0)
  const catalog = await rpc('context',{}); assert.equal(catalog.user_id,actor); assert.equal(catalog.students[0].gov_id,undefined)
  // All supported entity writes execute against real tables, including the
  // native lifecycle function for report text/version updates.
  const nextCourse=id(51), nextSession=id(52), nextStudent=id(53), nextEnrollment=id(54), nextOccurrence=id(55), nextReport=id(56)
  const nextJob=await rpc('job',{...destination,source_class_id:'12',course_id:nextCourse,class_session_id:nextSession})
  const nextRows=[
    ['course','901',nextCourse,{subject:'Test course',stage:'1'}],
    ['class_session','12',nextSession,{name:'New class',classroom_id:room,course_ids:[nextCourse],start_date:'2026-01-01',day_of_week:6,start_time:'09:00',end_time:'10:00',time_zone:'Asia/Taipei'}],
    ['student','111',nextStudent,{name:'New student'}],
    ['enrollment','321',nextEnrollment,{student_id:nextStudent,course_id:nextCourse,classroom_id:room,class_session_id:nextSession,status:'regular',start_date:'2026-01-01',time_zone:'Asia/Taipei'}],
    ['occurrence','12:2026-10-03',nextOccurrence,{class_session_id:nextSession,occurrence_date:'2026-10-03',original_start_time:'09:00',original_end_time:'10:00',time_zone:'Asia/Taipei'}],
    ['report','451',nextReport,{enrollment_id:nextEnrollment,class_occurrence_id:nextOccurrence,content:'Imported verified text'}],
  ].map(([kind,source_id,target_id,data])=>({source_id,target_id,overwrite:[],record:{kind,data}}))
  const nextBatch={job_id:nextJob.id,key:id(57),fingerprint:'0'.repeat(64),rows:nextRows}
  assert.equal((await rpc('preview',nextBatch)).rows.length,6)
  assert.equal((await rpc('apply',nextBatch)).applied,6)
  const imported=(await db.query('SELECT content,version FROM public.occurrence_reports WHERE id=$1',[nextReport])).rows[0]
  assert.equal(imported.content,'Imported verified text'); assert.equal(imported.version,2)
  const raw = await db.query('SELECT result FROM public.web_extension_import_batches WHERE status=\'applied\''); assert.equal(JSON.stringify(raw.rows).includes('Deidentified'),false)
  // Execute new migration contracts, not text matching of SQL source.
  assert.equal(catalogCaps.multi_course_import,true);assert.equal(catalogCaps.mapping_memory,true)
  const origin=destination.source_origin
  const resolveMemory=(source_class_id,memory_refs=[],source_refs=[],target_refs=[])=>rpcCatalog('resolve',{source_class_id,memory_refs,source_refs,target_refs})
  const targets=await resolveMemory('11',[],[],[{kind:'students',id:student},{kind:'courses',id:course},{kind:'class_sessions',id:session},{kind:'enrollments',id:enrollment}])
  const versions=Object.fromEntries(targets.targets.map(t=>[t.id,t.target_version]))
  assert.match(versions[student],/^[a-f0-9]{32}$/)
  const confirm=(items,source_class_id='11')=>rpcCatalog('memory-confirm',{source_origin:origin,source_class_id,items})
  const courseRule={kind:'course_rule',key:'label:Source course A',action:'confirm',target_id:course,expected_revision:null,versions}
  const admissionMemory={kind:'admission',key:'301',action:'confirm',target_id:enrollment,student_id:student,course_id:course,class_session_id:session,source_identity:'label:Source course A',expected_revision:null,versions}
  await confirm([courseRule,admissionMemory])
  const remembered=await resolveMemory('11',[{kind:'course_rule',key:courseRule.key},{kind:'admission',key:'301',source_identity:admissionMemory.source_identity}],[{source_kind:'enrollment',source_id:'301'}])
  assert.equal(remembered.source_links[0].source_origin,origin)
  assert.equal(remembered.memories.find(m=>m.kind==='admission').student_id,student)
  assert.equal(remembered.memories.find(m=>m.kind==='course_rule').suggestion,false)
  assert.equal((await resolveMemory('12',[{kind:'course_rule',key:courseRule.key}])).memories[0].suggestion,true)
  assert.equal((await resolveMemory('11',[{kind:'admission',key:'301',source_identity:'label:Changed course'}])).memories[0].valid,false)
  const knownSourceStudent=await resolveMemory('11',[],[{source_kind:'student',source_id:'101'}])
  const enrichedStudent={kind:'student',key:'101',action:'confirm',target_id:student,expected_revision:knownSourceStudent.source_links[0].revision,versions}
  const enrichedCourse={kind:'course',key:'code:dt-python',action:'confirm',target_id:course,expected_revision:null,versions}
  await confirm([enrichedStudent,enrichedCourse])
  const oldEnrichedIdentity=JSON.stringify([null,'label:Python'])
  await confirm([{kind:'admission',key:'enriched-1',action:'confirm',target_id:enrollment,student_id:student,course_id:course,class_session_id:session,source_identity:oldEnrichedIdentity,expected_revision:null,versions}])
  const enrichment=await resolveMemory('11',[{kind:'admission',key:'enriched-1',source_identity:JSON.stringify(['101','code:dt-python']),source_course_id:'code:dt-python',source_course_label:'Python'}])
  const enrichedMemory=enrichment.memories[0]
  assert.equal(enrichedMemory.valid,true);assert.equal(enrichedMemory.reason,'identity_enriched');assert.equal(enrichedMemory.student_id,student);assert.equal(enrichedMemory.course_id,course)
  const stableEnrichment=await resolveMemory('11',[{kind:'admission',key:'enriched-1',source_identity:JSON.stringify(['101','code:dt-python']),source_course_id:'code:dt-python',source_course_label:'Python'}])
  assert.equal(stableEnrichment.memories[0].valid,true);assert.equal(stableEnrichment.memories[0].reason,'valid')
  await assert.rejects(confirm([courseRule]),/VERSION_CONFLICT/)
  const admissionRevision=remembered.memories.find(m=>m.kind==='admission').revision
  await assert.rejects(confirm([{...admissionMemory,course_id:nextCourse,expected_revision:admissionRevision,versions:{...versions,[nextCourse]:(await resolveMemory('11',[],[],[{kind:'courses',id:nextCourse}])).targets[0].target_version}}]),/SOURCE_MAPPING_CONFLICT/)
  // Stale target versions and denied permission cannot save a mapping.
  await db.exec(`UPDATE public.students SET name='Changed after confirmation' WHERE id='${student}'`)
  await assert.rejects(confirm([{kind:'student',key:'888',action:'confirm',target_id:student,expected_revision:null,versions}]),/VERSION_CONFLICT/)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.students.read')")
  assert.equal((await resolveMemory('11',[{kind:'admission',key:'301'}])).memories[0].valid,false)
  await assert.rejects(confirm([{kind:'student',key:'888',action:'confirm',target_id:student,expected_revision:null,versions}]),/PERMISSION_DENIED/)
  await db.exec('DELETE FROM public.denied_permissions')
  const freshStudent=(await resolveMemory('11',[],[],[{kind:'students',id:student}])).targets[0]
  const freshVersions={...versions,[student]:freshStudent.target_version}
  await confirm([{...admissionMemory,expected_revision:admissionRevision,versions:freshVersions}])
  // Student IDs may exist only on an enrollment row. Resolve that source ID
  // before confirming both the admission and its already remembered student.
  await confirm([{kind:'student',key:'124931',action:'confirm',target_id:student,expected_revision:null,versions:freshVersions}])
  const enrollmentOnlyStudent=await resolveMemory('11',[{kind:'admission',key:'255723',source_identity:JSON.stringify(['124931','code:dt-js2'])}],[{source_kind:'student',source_id:'124931'}])
  const studentRevision=enrollmentOnlyStudent.source_links.find(row=>row.source_kind==='student'&&row.source_id==='124931')?.revision
  assert.ok(studentRevision,'resolve must return existing student revision for an enrollment-only source ID')
  assert.equal(enrollmentOnlyStudent.memories.length,0,'no admission memory is treated as confirmed absence')
  await confirm([
    {kind:'admission',key:'255723',action:'confirm',source_identity:JSON.stringify(['124931','code:dt-js2']),target_id:enrollment,student_id:student,course_id:course,class_session_id:session,expected_revision:null,versions:freshVersions},
    {kind:'student',key:'124931',action:'confirm',target_id:student,expected_revision:studentRevision,versions:freshVersions}
  ])
  await assert.rejects(confirm([{kind:'student',key:'124931',action:'confirm',target_id:student,expected_revision:null,versions:freshVersions}]),error=>{
    assert.match(error.message,/VERSION_CONFLICT/)
    assert.equal(JSON.parse(error.detail).field,'expected_revision')
    assert.equal(JSON.parse(error.detail).reason,'MEMORY_REVISION_CHANGED')
    return true
  })
  const updatedAdmission=(await resolveMemory('11',[{kind:'admission',key:'301'}])).memories[0]
  assert.notEqual(updatedAdmission.revision,admissionRevision)
  // Same names never resolve without a confirmed mapping or a unique canonical link.
  await db.exec(`INSERT INTO public.students(id,name,user_id) VALUES('${id(71)}','Changed after confirmation','${actor}')`)
  assert.equal((await resolveMemory('11',[],[{source_kind:'student',source_id:'unknown'}])).source_links.length,0)
  await db.exec(`UPDATE public.students SET external_link='${origin}/students/700' WHERE id='${student}'`)
  assert.equal((await resolveMemory('11',[],[{source_kind:'student',source_id:'700'}])).source_links[0].reason,'external_link')
  await db.exec(`UPDATE public.students SET external_link='${origin}/students/700' WHERE id='${id(71)}'`)
  assert.equal((await resolveMemory('11',[],[{source_kind:'student',source_id:'700'}])).source_links.length,0)
  // A late confirmation failure rolls back earlier confirmations in the same call.
  await assert.rejects(confirm([{kind:'course_rule',key:'label:rollback',action:'confirm',target_id:course,expected_revision:null,versions},{...courseRule,expected_revision:'stale'}]),/VERSION_CONFLICT/)
  assert.equal((await resolveMemory('11',[{kind:'course_rule',key:'label:rollback'}])).memories.length,0)
  // Existing classes may append explicitly approved courses, never remove courses or edit schedules.
  await db.exec(`UPDATE public.class_sessions SET start_date='2026-01-01',day_of_week=5 WHERE id='${session}'`)
  const multiJob=await rpc('job',{...destination,course_id:undefined,course_ids:[course,nextCourse]})
  const multiData={name:'Test class',classroom_id:room,course_ids:[course,nextCourse],start_date:'2026-01-01',day_of_week:5,start_time:'09:00:00',end_time:'10:00:00',time_zone:'Asia/Taipei'}
  const multiRows=[{source_id:'11',target_id:session,overwrite:['course_ids'],record:{kind:'class_session',data:multiData}},{source_id:'no-student-id',source_identity:'label:Source course B',target_id:id(72),overwrite:[],record:{kind:'enrollment',data:{student_id:student,course_id:nextCourse,classroom_id:room,class_session_id:session,status:'regular',start_date:'2026-01-01',time_zone:'Asia/Taipei'}}}]
  const multiBatch={job_id:multiJob.id,key:id(73),fingerprint:'7'.repeat(64),rows:multiRows}
  const multiPreview=await rpc('preview',multiBatch);assert.equal(multiPreview.rows[0].status,'updated')
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.class_sessions.update')")
  await assert.rejects(rpc('apply',multiBatch),/PERMISSION_DENIED/);await db.exec('DELETE FROM public.denied_permissions')
  assert.equal((await rpc('apply',multiBatch)).applied,2);assert.equal((await rpc('apply',multiBatch)).applied,2)
  assert.deepEqual((await db.query('SELECT course_ids FROM public.class_sessions WHERE id=$1',[session])).rows[0].course_ids,[course,nextCourse])
  const noStudentMemory=(await resolveMemory('11',[{kind:'admission',key:'no-student-id',source_identity:'label:Source course B'}])).memories[0]
  assert.equal(noStudentMemory.student_id,student);assert.equal(noStudentMemory.course_id,nextCourse)
  assert.equal((await resolveMemory('11',[],[{source_kind:'student',source_id:'no-student-id'}])).source_links.length,0)
  const removal={...multiBatch,key:id(74),rows:[{...multiRows[0],record:{kind:'class_session',data:{...multiData,course_ids:[nextCourse]}}}]}
  await assert.rejects(rpc('preview',removal),/INVALID_REFERENCE/)
  const changedRelation={...multiBatch,key:id(75),rows:[{...multiRows[1],record:{kind:'enrollment',data:{...multiRows[1].record.data,course_id:course}}}]}
  await assert.rejects(rpc('preview',changedRelation),/INVALID_REFERENCE/)
  const filteredReports=await rpcCatalog('reports',{enrollment_id:enrollment,limit:50});assert.equal(filteredReports.reports.length,1);assert.equal(filteredReports.reports[0].enrollment_id,enrollment)
  await confirm([{kind:'course_rule',key:courseRule.key,action:'clear',expected_revision:remembered.memories.find(m=>m.kind==='course_rule').revision}])
  assert.equal((await resolveMemory('11',[{kind:'course_rule',key:courseRule.key}])).memories.length,0)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.courses')).rows[0].n,2)
  // Label-only new courses commit a rule, never a fabricated official source link.
  const ruleCourse=id(80),ruleSession=id(81),ruleStudent=id(82),ruleEnrollment=id(83),ruleKey='label:Confirmed label-only course'
  const ruleJob=await rpc('job',{...destination,source_class_id:'13',course_id:undefined,course_ids:[course,ruleCourse],class_session_id:ruleSession})
  const ruleRows=[{source_id:`work:${ruleCourse}`,source_rule:ruleKey,target_id:ruleCourse,overwrite:[],record:{kind:'course',data:{subject:'Label course',stage:'2'}}},{source_id:'13',target_id:ruleSession,overwrite:[],record:{kind:'class_session',data:{...multiData,name:'Rule class',course_ids:[course,ruleCourse]}}},{source_id:'801',target_id:ruleStudent,overwrite:[],record:{kind:'student',data:{name:'Rule student'}}},{source_id:'803',source_identity:ruleKey,target_id:ruleEnrollment,overwrite:[],record:{kind:'enrollment',data:{...multiRows[1].record.data,student_id:ruleStudent,course_id:ruleCourse,class_session_id:ruleSession}}}]
  const ruleBatch={job_id:ruleJob.id,key:id(84),fingerprint:'8'.repeat(64),rows:ruleRows}
  await rpc('preview',ruleBatch);await rpc('apply',ruleBatch)
  assert.equal((await resolveMemory('13',[{kind:'course_rule',key:ruleKey}])).memories[0].target_id,ruleCourse)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.web_extension_source_links WHERE source_id=$1',[`work:${ruleCourse}`])).rows[0].n,0)
  // A separate credential user cannot see this user's memories.
  const otherUser=id(90),otherToken=id(91)
  await db.exec(`INSERT INTO auth.users(id) VALUES('${otherUser}'); INSERT INTO public.web_extension_tokens(id,user_id,extension_origin,token_hash) VALUES('${otherToken}','${otherUser}','chrome-extension://${'a'.repeat(32)}','${'c'.repeat(64)}')`)
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  const other=(await db.query('SELECT public.web_extension_catalog($1,$2,$3,$4) AS data',[otherToken,'c'.repeat(64),'resolve',JSON.stringify({source_refs:[{source_kind:'student',source_id:'101'}],target_refs:[],source_class_id:'13',memory_refs:[{kind:'course_rule',key:ruleKey}]})])).rows[0].data
  assert.equal(other.memories.length,0);assert.equal(other.source_links.length,0)
  console.log('PASS: 1000120 multi-course jobs, explicit class append, missing student ID admission memory, same-name safety, cross-class suggestions, stale/revoked mappings, optimistic edits/clear, immutable relationships, replay and atomic rollback')
  // Student scope finds other classes without changing any enrollment relation.
  const weekendSession=id(90),weekendEnrollment=id(91),sourceOccurrence=id(92),targetOccurrence=id(93),transfer=id(94)
  await db.exec(`INSERT INTO public.class_sessions(id,name,classroom_id,course_ids,start_date,day_of_week,start_time,end_time,user_id,teaching_id) VALUES('${weekendSession}','Test class','${room}',ARRAY['${course}'::uuid],'2026-01-01',0,'14:00','16:00','${actor}','${teaching}');
    INSERT INTO public.class_session_schedule_rules(class_session_id,schedule_kind,day_of_week,start_time,end_time) VALUES('${weekendSession}','weekly',0,'14:00','16:00'),('${weekendSession}','weekly',6,'09:00','10:00');
    INSERT INTO public.enrollments(id,student_id,course_id,class_session_id,classroom_id,start_date,status,user_id) VALUES('${weekendEnrollment}','${student}','${course}','${weekendSession}','${room}','2026-01-01','regular','${actor}');
    INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${sourceOccurrence}','${session}','2026-10-03','09:00','10:00'),('${targetOccurrence}','${weekendSession}','2026-10-04','14:00','16:00');
    INSERT INTO public.single_lesson_transfers(id,enrollment_id,source_occurrence_id,target_occurrence_id,created_by) VALUES('${transfer}','${weekendEnrollment}','${sourceOccurrence}','${targetOccurrence}','${actor}');`)
  const capabilities=await rpcCatalog('capabilities',{});assert.equal(capabilities.student_enrollment_catalog,true);assert.equal(capabilities.enrollment_reconciliation,true)
  assert.equal((await rpc('capabilities',{})).transferred_occurrence_import,true)
  const studentEnrollments=await rpcCatalog('catalog',{resource:'enrollments',student_id:student,limit:1})
  assert.equal(studentEnrollments.items.length,1);assert.ok(studentEnrollments.next_cursor)
  const nextStudentPage=await rpcCatalog('catalog',{resource:'enrollments',student_id:student,limit:1,cursor:studentEnrollments.next_cursor})
  assert.equal(nextStudentPage.items.length,1);assert.notEqual(nextStudentPage.items[0].id,studentEnrollments.items[0].id)
  const allEnrollments=await rpcCatalog('catalog',{resource:'enrollments',student_id:student})
  assert.ok(allEnrollments.items.some(e=>e.id===weekendEnrollment));assert.ok(allEnrollments.items.some(e=>e.class_session_id===session))
  const exact=await rpcCatalog('catalog',{resource:'enrollments',student_id:student,class_session_id:session,course_id:course})
  assert.ok(exact.items.every(e=>e.class_session_id===session&&e.course_id===course))
  await assert.rejects(rpcCatalog('catalog',{resource:'enrollments'}),/INVALID_IMPORT/)
  const reconciliation=await rpcCatalog('reconcile',{enrollment_id:weekendEnrollment})
  assert.equal(reconciliation.enrollment.class_session.day_of_week,0);assert.equal(reconciliation.enrollment.class_session.schedule_rules.length,2)
  assert.equal(reconciliation.transfers[0].is_effective_target,true);assert.equal(reconciliation.transfers[0].target_date,'2026-10-04')
  const finalOccurrence=id(95),secondTransfer=id(96)
  await db.exec(`INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${finalOccurrence}','${weekendSession}','2026-10-11','14:00','16:00'); INSERT INTO public.single_lesson_transfers(id,enrollment_id,source_occurrence_id,target_occurrence_id,created_by) VALUES('${secondTransfer}','${weekendEnrollment}','${targetOccurrence}','${finalOccurrence}','${actor}')`)
  const chainPage=await rpcCatalog('reconcile',{enrollment_id:weekendEnrollment,limit:1})
  assert.equal(chainPage.transfers[0].is_effective_target,false);assert.ok(chainPage.next_cursor)
  const chainNext=await rpcCatalog('reconcile',{enrollment_id:weekendEnrollment,limit:1,cursor:chainPage.next_cursor})
  assert.equal(chainNext.transfers[0].id,secondTransfer);assert.equal(chainNext.transfers[0].is_effective_target,true)
  await db.exec(`UPDATE public.single_lesson_transfers SET cancelled_at=now() WHERE id='${secondTransfer}'`)
  const cancelled=await rpcCatalog('reconcile',{enrollment_id:weekendEnrollment})
  assert.equal(cancelled.transfers.find(t=>t.id===transfer).is_effective_target,true)
  assert.equal(cancelled.transfers.find(t=>t.id===secondTransfer).is_effective_target,false)
  const resolvedWeekend=(await rpcCatalog('resolve',{source_refs:[],target_refs:[{kind:'class_sessions',id:weekendSession}]})).targets[0]
  assert.equal(resolvedWeekend.schedule_rules.length,2)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.students.read')")
  await assert.rejects(rpcCatalog('catalog',{resource:'enrollments',student_id:student}),/PERMISSION_DENIED/)
  await assert.rejects(rpcCatalog('reconcile',{enrollment_id:weekendEnrollment}),/PERMISSION_DENIED/);await db.exec('DELETE FROM public.denied_permissions')
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.occurrences.read')")
  assert.equal((await rpcCatalog('reconcile',{enrollment_id:weekendEnrollment})).transfers.length,0);await db.exec('DELETE FROM public.denied_permissions')
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.enrollments.read')")
  assert.equal((await rpcCatalog('catalog',{resource:'enrollments',student_id:student})).items.length,0)
  await assert.rejects(rpcCatalog('reconcile',{enrollment_id:weekendEnrollment}),/PERMISSION_DENIED/);await db.exec('DELETE FROM public.denied_permissions')
  assert.equal((await db.query('SELECT class_session_id FROM public.enrollments WHERE id=$1',[weekendEnrollment])).rows[0].class_session_id,weekendSession)
  // A confirmed existing enrollment may stay in its original class while a
  // report is imported into the selected class only through an effective
  // single-lesson transfer and the date-specific roster.
  const crossEnrollment=id(97),crossSourceOccurrence=id(98),crossTargetOccurrence=id(99),crossTransfer=id(100),crossReport=id(101)
  await db.exec(`INSERT INTO public.enrollments(id,student_id,course_id,class_session_id,classroom_id,start_date,status,user_id) VALUES('${crossEnrollment}','${student}','${course}','${weekendSession}','${room}','2026-01-01','regular','${actor}');
    INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${crossSourceOccurrence}','${weekendSession}','2026-10-05','14:00','16:00'),('${crossTargetOccurrence}','${session}','2026-10-05','09:00','10:00');
    INSERT INTO public.single_lesson_transfers(id,enrollment_id,source_occurrence_id,target_occurrence_id,created_by) VALUES('${crossTransfer}','${crossEnrollment}','${crossSourceOccurrence}','${crossTargetOccurrence}','${actor}');`)
  const crossTargetRefs=await resolveMemory('11',[],[],[{kind:'students',id:student},{kind:'courses',id:course},{kind:'class_sessions',id:weekendSession},{kind:'enrollments',id:crossEnrollment}])
  const crossVersions=Object.fromEntries(crossTargetRefs.targets.map(t=>[t.id,t.target_version]))
  await confirm([{kind:'admission',key:'cross-class-admission',action:'confirm',target_id:crossEnrollment,student_id:student,course_id:course,class_session_id:weekendSession,source_identity:'corp-admission:cross-class',expected_revision:null,versions:crossVersions}])
  const crossMemory=(await resolveMemory('11',[{kind:'admission',key:'cross-class-admission',source_identity:'corp-admission:cross-class'}])).memories[0]
  assert.equal(crossMemory.valid,true);assert.equal(crossMemory.class_session_id,weekendSession)
  const crossBatch={job_id:job.id,key:id(102),fingerprint:'d'.repeat(64),rows:[{source_id:'cross-report-1',target_id:crossReport,overwrite:[],record:{kind:'report',data:{enrollment_id:crossEnrollment,class_occurrence_id:crossTargetOccurrence,attendance_status:'present'}}}]}
  await rpc('preview',crossBatch);await rpc('apply',crossBatch)
  assert.equal((await db.query('SELECT class_session_id FROM public.enrollments WHERE id=$1',[crossEnrollment])).rows[0].class_session_id,weekendSession,'report import does not rewrite the enrollment class')
  assert.equal((await db.query('SELECT class_occurrence_id FROM public.occurrence_reports WHERE id=$1',[crossReport])).rows[0].class_occurrence_id,crossTargetOccurrence)
  const invalidNoTransfer={...crossBatch,key:id(103),fingerprint:'f'.repeat(64),rows:[{...crossBatch.rows[0],source_id:'cross-report-no-transfer',target_id:id(104)}]}
  await db.exec(`INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${id(105)}','${session}','2026-10-07','09:00','10:00')`)
  await assert.rejects(rpc('preview',{...invalidNoTransfer,rows:[{...invalidNoTransfer.rows[0],record:{kind:'report',data:{enrollment_id:crossEnrollment,class_occurrence_id:id(105),attendance_status:'present'}}}]}),/INVALID_REFERENCE/,'cross-class report without a matching transfer must be rejected')
  await db.exec(`UPDATE public.single_lesson_transfers SET cancelled_at=now() WHERE id='${crossTransfer}'; INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${id(106)}','${session}','2026-10-08','09:00','10:00')`)
  await assert.rejects(rpc('preview',{...invalidNoTransfer,key:id(107),rows:[{...invalidNoTransfer.rows[0],target_id:id(108),record:{kind:'report',data:{enrollment_id:crossEnrollment,class_occurrence_id:id(106),attendance_status:'present'}}}]}),/INVALID_REFERENCE/,'cancelled transfer must be rejected')
  const chainedSource=id(113),chainedTarget=id(112),chainedFinal=id(114)
  await db.exec(`INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${chainedSource}','${weekendSession}','2026-10-09','14:00','16:00'),('${chainedTarget}','${session}','2026-10-09','09:00','10:00'),('${chainedFinal}','${session}','2026-10-10','09:00','10:00');
    INSERT INTO public.single_lesson_transfers(id,enrollment_id,source_occurrence_id,target_occurrence_id,created_by) VALUES('${id(109)}','${crossEnrollment}','${chainedSource}','${chainedTarget}','${actor}'),('${id(115)}','${crossEnrollment}','${chainedTarget}','${chainedFinal}','${actor}');`)
  await assert.rejects(rpc('preview',{...invalidNoTransfer,key:id(116),rows:[{...invalidNoTransfer.rows[0],target_id:id(117),record:{kind:'report',data:{enrollment_id:crossEnrollment,class_occurrence_id:chainedTarget,attendance_status:'present'}}}]}),/INVALID_REFERENCE/,'a superseded transfer target must be rejected')
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.enrollments.read')")
  await assert.rejects(rpc('preview',{...invalidNoTransfer,key:id(110),rows:[{...invalidNoTransfer.rows[0],target_id:id(111),record:{kind:'report',data:{enrollment_id:crossEnrollment,class_occurrence_id:chainedFinal,attendance_status:'present'}}}]}),/PERMISSION_DENIED/)
  await db.exec('DELETE FROM public.denied_permissions')
  console.log('PASS: 1000125 explicit cross-class admission memory, immutable enrollment relation and effective transferred occurrence report import')
  console.log('PASS: 1000121 student-scoped paging, read-only reconciliation, transfer visibility, weekend schedules and actor authorization')
  assert.equal((await rpcCatalog('capabilities',{})).nearest_report_candidates,true)
  // Include old dates beyond the newest 50: sorting must happen in PostgreSQL.
  const anchor='2024-06-15', nearestInput={student_id:student,course_id:course,sort:'nearest',anchor_date:anchor,limit:3}
  await db.exec(`INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${session}',DATE '2024-06-14'+n FROM generate_series(0,60) n;
    INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content) SELECT ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${enrollment}',('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Historical sample' FROM generate_series(0,60) n;`)
  const near=await rpcCatalog('reports',nearestInput)
  assert.deepEqual(near.reports.map(r=>r.occurrence_date),['2024-06-15','2024-06-14','2024-06-16'])
  assert.deepEqual(near.reports.map(r=>r.date_difference),[0,-1,1]);assert.ok(near.next_cursor)
  assert.ok(near.reports.every(r=>r.class_name==='Test class'))
  const nextNear=await rpcCatalog('reports',{...nearestInput,cursor:near.next_cursor})
  assert.equal(nextNear.reports[0].occurrence_date,'2024-06-17');assert.ok(nextNear.reports.every(r=>!near.reports.some(a=>a.id===r.id)))
  await assert.rejects(rpcCatalog('reports',{...nearestInput,anchor_date:'2024-06-16',cursor:near.next_cursor}),/INVALID_IMPORT/)
  await assert.rejects(rpcCatalog('reports',{...nearestInput,course_id:nextCourse,cursor:near.next_cursor}),/INVALID_IMPORT/)
  const seen=new Set();let pageCursor=null
  do {const page=await rpcCatalog('reports',{...nearestInput,limit:50,cursor:pageCursor});for(const r of page.reports){assert.ok(!seen.has(r.id));seen.add(r.id)}pageCursor=page.next_cursor} while(pageCursor)
  assert.ok(seen.size>50)
  const otherCourse=await rpcCatalog('reports',{student_id:student,exclude_course_id:course,sort:'nearest',anchor_date:anchor});assert.ok(otherCourse.reports.every(r=>r.course_id!==course))
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.reports.read')")
  assert.equal((await rpcCatalog('reports',nearestInput)).reports.length,0);await db.exec('DELETE FROM public.denied_permissions')
  console.log('PASS: 1000123 nearest ordering before pagination, past-first ties, filter-bound cursors, >50 reports, permission checks and capability')
  async function fieldRpc(operation,items=[],credential=token,hash='a'.repeat(64)) {
    await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
    return (await db.query('SELECT public.web_extension_field_mappings($1,$2,$3,$4) AS data',[credential,hash,operation,JSON.stringify({source_origin:origin,adapter_version:'orange-apple-v1',items})])).rows[0].data
  }
  assert.equal((await fieldRpc('capabilities')).field_mapping_memory,true)
  const field={field_key:'attendance_status',course_id:course,options_signature:JSON.stringify([['attended','出席',false],['away','未出席',false]])}
  const savedRule=(await fieldRpc('confirm',[{...field,source_value:'attended',canonical_value:'present',action:'confirm',expected_revision:null}])).items[0]
  assert.equal(savedRule.canonical_value,'present');assert.ok(savedRule.revision);assert.equal(savedRule.user_id,undefined)
  assert.equal((await fieldRpc('resolve',[field])).items[0].valid,true)
  const deviceToken=id(180)
  await db.exec(`INSERT INTO public.web_extension_tokens(id,user_id,extension_origin,token_hash) VALUES('${deviceToken}','${actor}','chrome-extension://${'d'.repeat(32)}','${'d'.repeat(64)}')`)
  assert.equal((await fieldRpc('resolve',[field],deviceToken,'d'.repeat(64))).items[0].revision,savedRule.revision,'same account on another device reuses the confirmed rule')
  assert.equal((await fieldRpc('resolve',[field],otherToken,'c'.repeat(64))).items.length,0)
  assert.equal((await fieldRpc('resolve',[{...field,course_id:nextCourse}])).items.length,0)
  const changedOptions={...field,options_signature:JSON.stringify([['attended','來源選項已改變',false]])}
  const stale=(await fieldRpc('resolve',[changedOptions])).items[0];assert.equal(stale.valid,false);assert.equal(stale.revision,savedRule.revision)
  await assert.rejects(fieldRpc('confirm',[{...field,source_value:'attended',canonical_value:'absent',action:'confirm',expected_revision:null}]),/VERSION_CONFLICT/)
  const boolField={field_key:'is_completed',course_id:course,options_signature:JSON.stringify([['no','未完成',false]])}
  const halfField={field_key:'class_participation',course_id:course,options_signature:JSON.stringify([['9','4.5 星',false],['0','0 星',false]])}
  await fieldRpc('confirm',[{...boolField,source_value:'no',canonical_value:false,action:'confirm',expected_revision:null},{...halfField,source_value:'9',canonical_value:4.5,action:'confirm',expected_revision:null},{...halfField,source_value:'0',canonical_value:0,action:'confirm',expected_revision:null}])
  assert.equal((await fieldRpc('resolve',[boolField])).items[0].canonical_value,false)
  assert.deepEqual((await fieldRpc('resolve',[halfField])).items.map(r=>r.canonical_value),[0,4.5])
  await assert.rejects(fieldRpc('confirm',[{...halfField,source_value:'9',canonical_value:4.3,action:'confirm',expected_revision:(await fieldRpc('resolve',[halfField])).items[1].revision}]),/INVALID_IMPORT/)
  await assert.rejects(fieldRpc('confirm',[{...field,source_value:'away',canonical_value:'absent',action:'confirm',expected_revision:null},{...boolField,source_value:'no',canonical_value:true,action:'confirm',expected_revision:null}]),/VERSION_CONFLICT/)
  assert.equal((await fieldRpc('resolve',[field])).items.length,1,'late conflict rolls back earlier insertion')
  await assert.rejects(fieldRpc('resolve',[{...field,options_signature:'[1]'}]),/INVALID_IMPORT/)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.courses.read')")
  await assert.rejects(fieldRpc('resolve',[field]),/PERMISSION_DENIED/);await db.exec('DELETE FROM public.denied_permissions')
  await fieldRpc('confirm',[{...changedOptions,source_value:'attended',action:'clear',expected_revision:savedRule.revision}])
  assert.equal((await fieldRpc('resolve',[field])).items.length,0)
  console.log('PASS: 1000124 executable migration; cross-device/account/course isolation, stale options, half stars/false/zero, revisions, clear, permissions and atomic rollback')
  assert.equal((await fieldRpc('capabilities')).global_progress_mapping,true)
  assert.equal((await fieldRpc('capabilities')).history_binding_field_mask,true)
  const sharedField={field_key:'progress_start',options_signature:JSON.stringify([['A','A',false],['B','B',false]])}
  const sharedRule=(await fieldRpc('confirm',[{...sharedField,source_value:'A',canonical_value:'A',action:'confirm',expected_revision:null}])).items[0]
  assert.equal((await fieldRpc('resolve',[sharedField])).items[0].revision,sharedRule.revision)
  assert.equal((await fieldRpc('resolve',[{...sharedField,course_id:nextCourse}])).items[0].revision,sharedRule.revision,'shared progress mapping applies across courses')
  async function syncPreferenceRpc(operation,input,credential=token,hash='a'.repeat(64)) {
    await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
    return (await db.query('SELECT public.web_extension_sync_preferences($1,$2,$3,$4) AS data',[credential,hash,operation,JSON.stringify(input)])).rows[0].data
  }
  const preferenceContext={source_origin:origin,adapter_version:'orange-apple-v1'}
  assert.deepEqual((await syncPreferenceRpc('get',preferenceContext)).fields,{})
  const preferences=await syncPreferenceRpc('patch',{...preferenceContext,expected_revision:null,fields:[{field_key:'content',enabled:false},{field_key:'class_notes',enabled:true}]})
  assert.deepEqual(preferences.fields,{content:false,class_notes:true});assert.ok(preferences.revision)
  assert.deepEqual((await syncPreferenceRpc('get',preferenceContext)).fields,preferences.fields)
  await assert.rejects(syncPreferenceRpc('patch',{...preferenceContext,expected_revision:null,fields:[{field_key:'content',enabled:true}]}),/VERSION_CONFLICT/)
  await assert.rejects(syncPreferenceRpc('patch',{...preferenceContext,expected_revision:preferences.revision,fields:[{field_key:'student_id',enabled:false}]}),/INVALID_IMPORT/)
  assert.equal((await syncPreferenceRpc('capabilities',preferenceContext)).sync_field_preferences,true)
  console.log('PASS: 1000127 shared A-Z mappings and revision-checked sync preferences')
  async function historyRpc(operation,input) {
    await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
    return (await db.query('SELECT public.web_extension_history($1,$2,$3,$4) data',[token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
  }
  await db.exec(`INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,target_id,student_id,course_id,class_session_id) VALUES('${actor}','${origin}','admission','6332','${enrollment}','${student}','${course}','${session}')`)
  const historical=id(201),historyJob=await rpc('job',{...destination,date_from:'2024-01-01',report_session_ids:[session,weekendSession]})
  const historyData={enrollment_id:enrollment,report_date:'2024-06-15',source_origin:origin,source_admission_id:'6332',source_key:'evidence:sample',identity_status:'evidence_only',source_evidence:[
    {source_path:'/courses/dt/11',table:'reports',row:1,captured_at:'2026-10-05T00:00:00Z'},
    {source_path:'/courses/dt/11/lesson_reports',table:'reports',row:1,captured_at:'2026-10-05T00:00:00Z'},
    {source_path:'/courses/dt/11/lesson-reports',table:'reports',row:1,captured_at:'2026-10-05T00:00:00Z'},
    {source_path:'/dt_admissions/6332/reports/401/edit',table:'reports',row:1,captured_at:'2026-10-05T00:00:00Z'},
  ],source_fields:[{key:'content',label:'評語',text:''}],content:'',is_completed:false,class_participation:0,classroom_behavior:4.5}
  const historyBatch={job_id:historyJob.id,key:id(202),fingerprint:'1'.repeat(64),rows:[{source_id:'history:evidence:sample',target_id:historical,overwrite:[],record:{kind:'history_report',data:historyData}}]}
  assert.equal((await rpc('preview',historyBatch)).rows[0].status,'added')
  const historyResult=await rpc('apply',historyBatch);assert.equal(historyResult.classifications.history_report.added,1)
  assert.deepEqual(await rpc('apply',historyBatch),historyResult)
  const archive=await historyRpc('detail',{id:historical});assert.equal(archive.class_participation,0);assert.equal(archive.is_completed,false);assert.equal(archive.classroom_behavior,4.5)
  assert.deepEqual(archive.source_evidence.map(item=>item.source_path),historyData.source_evidence.map(item=>item.source_path),'history evidence keeps every exact source route')
  assert.equal((await historyRpc('list',{student_id:student})).items.length,1)
  const ambiguity={...historyBatch,key:id(203),fingerprint:'2'.repeat(64),rows:[{...historyBatch.rows[0],target_id:id(204),source_id:'history:different',record:{kind:'history_report',data:{...historyData,source_key:'evidence:different',content:'Changed'}}}]}
  await assert.rejects(rpc('preview',ambiguity),/HISTORY_IDENTITY_AMBIGUOUS/)
  await db.query("UPDATE public.enrollments SET start_date='2024-01-01',status='regular' WHERE id=$1",[enrollment])
  const candidates=await historyRpc('candidates',{history_id:historical});assert.ok(candidates.items.some(o=>o.occurrence_date==='2024-06-15'))
  const binding={history_id:historical,class_occurrence_id:candidates.items[0].id,history_version:1,key:id(205),overwrite:[],include_internal:false}
  await historyRpc('bind-preview',binding)
  const bound=await historyRpc('bind-apply',binding);assert.equal(bound.status,'linked');assert.deepEqual(await historyRpc('bind-apply',binding),bound)
  assert.equal((await historyRpc('list',{enrollment_id:enrollment,unlinked_only:true})).items.length,0)
  await assert.rejects(historyRpc('bind-preview',{...binding,key:id(206)}),/VERSION_CONFLICT/)
  const linkedReport=(await historyRpc('detail',{id:historical})).linked_report_id
  const reconcileRow={...historyBatch.rows[0],overwrite:['content'],record:{...historyBatch.rows[0].record,data:{...historyData,content:'merged source line',source_fields:[{key:'content',label:'Comment',text:'merged source line'}]}},history_reconciliation:{key:id(247),class_occurrence_id:binding.class_occurrence_id,include_fields:['content'],overwrite:['content'],include_internal:false}}
  const reconcileBatch={...historyBatch,key:id(246),fingerprint:'8'.repeat(64),rows:[reconcileRow]}
  const reconcilePreview=await rpc('preview',reconcileBatch);assert.equal(reconcilePreview.rows[0].history_reconciliation.changes[0].status,'updated')
  // An unchanged new-history row precedes the row whose linked lesson report
  // changes. The diagnostic must come from the actual check, not a post-rollback
  // scan that can incorrectly name the first row.
  const untouchedOccurrence=id(212),untouchedHistory=id(213)
  await db.query('INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) VALUES($1,$2,$3)',[untouchedOccurrence,session,'2024-12-30'])
  const firstHistoryRow={...historyBatch.rows[0],source_id:'history:evidence:untouched-first',target_id:untouchedHistory,record:{...historyBatch.rows[0].record,data:{...historyData,report_date:'2024-12-30',source_key:'evidence:untouched-first'}},history_reconciliation:{key:id(214),class_occurrence_id:untouchedOccurrence,include_fields:[],overwrite:[],include_internal:false}}
  const changedOccurrenceRow={...reconcileRow,history_reconciliation:{...reconcileRow.history_reconciliation,key:id(215)}}
  const preciseDiagnosticBatch={...historyBatch,key:id(216),fingerprint:'6'.repeat(64),rows:[firstHistoryRow,changedOccurrenceRow]}
  await rpc('preview',preciseDiagnosticBatch)
  await db.query('UPDATE public.occurrence_reports SET version=version+1 WHERE id=$1',[linkedReport])
  await assert.rejects(rpc('apply',preciseDiagnosticBatch),error=>{
    if(error.message!=='PREVIEW_STALE')return false
    const detail=JSON.parse(error.detail)
    return detail.diagnostic_source==='version_check'&&detail.reason==='OCCURRENCE_REPORT_VERSION_CHANGED'&&detail.source_id===reconcileRow.source_id&&detail.source_id!==firstHistoryRow.source_id
  })
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.enrollment_history_reports WHERE id=$1',[untouchedHistory])).rows[0].n,0,'the failed mixed batch rolls back its earlier history insert')
  // Restore the occurrence payload expected by the existing successful path.
  await rpc('preview',reconcileBatch)
  const reconciled=await rpc('apply',reconcileBatch);assert.equal(reconciled.history_reconciliations[0].status,'linked')
  let sameContent=(await db.query('SELECT h.content AS history_content,r.content AS report_content FROM public.enrollment_history_reports h JOIN public.occurrence_reports r ON r.id=h.linked_report_id WHERE h.id=$1',[historical])).rows[0]
  assert.equal(sameContent.history_content,'merged source line');assert.equal(sameContent.report_content,'merged source line')
  const rollbackBatch={...reconcileBatch,key:id(248),fingerprint:'9'.repeat(64),rows:[{...reconcileRow,record:{...reconcileRow.record,data:{...reconcileRow.record.data,content:'must roll back'}}}]}
  await rpc('preview',rollbackBatch)
  await db.exec(`CREATE FUNCTION public.test_history_reconciliation_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_RECONCILIATION_ROLLBACK'; END $$;
    CREATE TRIGGER test_history_reconciliation_rollback BEFORE UPDATE ON public.occurrence_reports FOR EACH ROW WHEN (NEW.id='${linkedReport}'::uuid) EXECUTE FUNCTION public.test_history_reconciliation_rollback()`)
  await assert.rejects(rpc('apply',rollbackBatch),/TEST_RECONCILIATION_ROLLBACK/)
  sameContent=(await db.query('SELECT h.content AS history_content,r.content AS report_content FROM public.enrollment_history_reports h JOIN public.occurrence_reports r ON r.id=h.linked_report_id WHERE h.id=$1',[historical])).rows[0]
  assert.equal(sameContent.history_content,'merged source line');assert.equal(sameContent.report_content,'merged source line')
  await db.exec('DROP TRIGGER test_history_reconciliation_rollback ON public.occurrence_reports; DROP FUNCTION public.test_history_reconciliation_rollback()')
  console.log('PASS: 1000134 previewed history/occurrence reconciliation, exact target versions, atomic update and rollback')
  const excludedHistory=id(208),excludedData={...historyData,report_date:'2024-06-18',source_key:'evidence:excluded',content:'Must remain history only'}
  const excludedBatch={...historyBatch,key:id(209),fingerprint:'4'.repeat(64),rows:[{source_id:'history:evidence:excluded',target_id:excludedHistory,overwrite:[],record:{kind:'history_report',data:excludedData}}]}
  await rpc('preview',excludedBatch);await rpc('apply',excludedBatch)
  const excludedCandidates=await historyRpc('candidates',{history_id:excludedHistory})
  const excludeBinding={history_id:excludedHistory,class_occurrence_id:excludedCandidates.items[0].id,history_version:1,key:id(210),overwrite:[],include_internal:false,include_fields:[]}
  const excludedPreview=await historyRpc('bind-preview',excludeBinding);assert.deepEqual(excludedPreview.patch,{})
  const excludedApply=await historyRpc('bind-apply',excludeBinding);assert.equal(excludedApply.status,'skipped')
  assert.equal((await db.query('SELECT linked_report_id FROM public.enrollment_history_reports WHERE id=$1',[excludedHistory])).rows[0].linked_report_id,null,'all fields skipped must not bind or create a report')
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.reports.read')")
  await assert.rejects(historyRpc('detail',{id:historical}),/PERMISSION_DENIED/);assert.equal((await historyRpc('list',{student_id:student})).items.length,0)
  await db.exec('DELETE FROM public.denied_permissions')
  const protectedData={...historyData,source_key:'evidence:unsafe',source_fields:[{key:'password',label:'password',text:'blocked'}]}
  const invalidEvidence={...historyData,source_key:'evidence:invalid-path',source_evidence:[{...historyData.source_evidence[1],source_path:'/courses/dt/11/lesson_reports/extra'}]}
  await assert.rejects(rpc('preview',{...historyBatch,key:id(214),fingerprint:'2'.repeat(64),rows:[{...historyBatch.rows[0],target_id:id(215),record:{kind:'history_report',data:invalidEvidence}}]}),/INVALID_IMPORT/)
  await assert.rejects(rpc('preview',{...historyBatch,key:id(207),fingerprint:'3'.repeat(64),rows:[{...historyBatch.rows[0],target_id:id(211),record:{kind:'history_report',data:protectedData}}]}),/INVALID_IMPORT/)
  // Effective routing reads the transferred day, never rewrites enrollment.
  const route=await historyRpc('route',{enrollment_id:weekendEnrollment,dates:['2026-10-03','2026-10-04']})
  assert.ok(route.items.some(o=>o.id===targetOccurrence&&o.occurrence_date==='2026-10-04'))
  assert.equal((await db.query('SELECT class_session_id FROM public.enrollments WHERE id=$1',[weekendEnrollment])).rows[0].class_session_id,weekendSession)
  const supersededRoute=await historyRpc('route',{enrollment_id:crossEnrollment,dates:['2026-10-09','2026-10-10']})
  assert.ok(!supersededRoute.items.some(o=>o.id===chainedTarget));assert.ok(supersededRoute.items.some(o=>o.id===chainedFinal))
  const supersededRoster=await rpcImportInfo({job_id:job.id,roster_date:'2026-10-09'})
  assert.ok(!supersededRoster.roster.enrollments.some(e=>e.id===crossEnrollment),'a superseded incoming transfer is absent from the date roster')
  const finalRoster=await rpcImportInfo({job_id:job.id,roster_date:'2026-10-10'})
  assert.ok(finalRoster.roster.enrollments.some(e=>e.id===crossEnrollment),'the final effective transfer remains in its actual lesson date roster')
  // Same-batch evidence ambiguity is rejected before any history is saved.
  const ambiguousRows=[1,2].map(n=>({source_id:`history:ambiguous-${n}`,target_id:id(220+n),overwrite:[],record:{kind:'history_report',data:{...historyData,report_date:'2024-06-17',source_key:`evidence:ambiguous-${n}`}}}))
  await assert.rejects(rpc('preview',{...historyBatch,key:id(220),rows:ambiguousRows}),/HISTORY_IDENTITY_AMBIGUOUS/)
  // Server-side nearest ordering and filter-bound cursors include >50 archives.
  await db.query(`INSERT INTO public.enrollment_history_reports(user_id,enrollment_id,report_date,source_origin,source_admission_id,source_key,identity_status) SELECT $1,$2,DATE '2024-06-14'+n,$3,'6332','evidence:paged-'||n,'evidence_only' FROM generate_series(0,60) n`,[actor,enrollment,origin])
  const nearestHistory={enrollment_id:enrollment,unlinked_only:true,sort:'nearest',anchor_date:'2024-06-15',limit:3}
  const page=await historyRpc('list',nearestHistory);assert.deepEqual(page.items.map(h=>h.report_date),['2024-06-15','2024-06-14','2024-06-16'])
  const next=await historyRpc('list',{...nearestHistory,cursor:page.next_cursor});assert.equal(next.items[0].report_date,'2024-06-17')
  await assert.rejects(historyRpc('list',{...nearestHistory,anchor_date:'2024-06-16',cursor:page.next_cursor}),/INVALID_CURSOR/)
  const archivedIds=new Set();let archiveCursor
  do{const p=await historyRpc('list',{...nearestHistory,limit:50,cursor:archiveCursor});for(const h of p.items){assert.ok(!archivedIds.has(h.id));archivedIds.add(h.id)}archiveCursor=p.next_cursor}while(archiveCursor)
  assert.equal(archivedIds.size,62)
  // Version/lifecycle failures leave both the archive link and report unchanged.
  const rollbackHistory=(await historyRpc('list',{...nearestHistory,limit:50})).items.find(h=>h.report_date==='2024-06-16')
  const rollbackOccurrence=(await historyRpc('candidates',{history_id:rollbackHistory.id})).items[0]
  const rollbackBind={history_id:rollbackHistory.id,class_occurrence_id:rollbackOccurrence.id,history_version:1,key:id(230),overwrite:[],include_internal:false}
  await historyRpc('bind-preview',rollbackBind)
  await db.query('UPDATE public.occurrence_reports SET version=version+1 WHERE class_occurrence_id=$1 AND enrollment_id=$2',[rollbackOccurrence.id,enrollment])
  await assert.rejects(historyRpc('bind-apply',rollbackBind),/PREVIEW_STALE/)
  assert.equal((await historyRpc('detail',{id:rollbackHistory.id})).linked_report_id,null)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.reports.update')")
  await assert.rejects(historyRpc('bind-preview',{...rollbackBind,key:id(231)}),/PERMISSION_DENIED/)
  await db.exec('DELETE FROM public.denied_permissions')
  // The source day may be outside the requested target interval (10/03 -> 10/04).
  const saturday=id(240),sunday=id(241),octoberArchive=id(244)
  await db.exec(`INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time) VALUES('${saturday}','${weekendSession}','2026-10-03','14:00','16:00'),('${sunday}','${session}','2026-10-04','09:00','10:00');
    INSERT INTO public.single_lesson_transfers(id,enrollment_id,source_occurrence_id,target_occurrence_id,created_by) VALUES('${id(242)}','${crossEnrollment}','${saturday}','${sunday}','${actor}');
    INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,target_id,student_id,course_id,class_session_id) VALUES('${actor}','${origin}','admission','6333','${crossEnrollment}','${student}','${course}','${weekendSession}')`)
  const octoberData={...historyData,enrollment_id:crossEnrollment,source_admission_id:'6333',source_key:'evidence:october',report_date:'2026-10-04',attendance_status:'present',content:'Transfer lesson'}
  const octoberBatch={...historyBatch,key:id(243),fingerprint:'6'.repeat(64),rows:[{source_id:'history:october',target_id:octoberArchive,overwrite:[],record:{kind:'history_report',data:octoberData}}]}
  await rpc('preview',octoberBatch);await rpc('apply',octoberBatch)
  const octoberRoute=await historyRpc('route',{enrollment_id:crossEnrollment,dates:['2026-10-03','2026-10-04']});assert.ok(octoberRoute.items.some(o=>o.id===sunday));assert.ok(!octoberRoute.items.some(o=>o.id===saturday))
  const octoberBind={history_id:octoberArchive,class_occurrence_id:sunday,history_version:1,key:id(245),overwrite:[],include_internal:false}
  await historyRpc('bind-preview',octoberBind)
  await db.exec(`CREATE FUNCTION public.test_history_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ROLLBACK'; END $$;
    CREATE TRIGGER test_history_rollback BEFORE UPDATE ON public.enrollment_history_reports FOR EACH ROW WHEN (NEW.id='${octoberArchive}'::uuid) EXECUTE FUNCTION public.test_history_rollback();`)
  await assert.rejects(historyRpc('bind-apply',octoberBind),/TEST_ROLLBACK/)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.occurrence_reports WHERE enrollment_id=$1 AND class_occurrence_id=$2',[crossEnrollment,sunday])).rows[0].n,0)
  assert.equal((await historyRpc('detail',{id:octoberArchive})).linked_report_id,null)
  await db.exec('DROP TRIGGER test_history_rollback ON public.enrollment_history_reports; DROP FUNCTION public.test_history_rollback()')
  assert.equal((await historyRpc('bind-apply',octoberBind)).classification,'added')
  assert.equal((await db.query('SELECT class_session_id FROM public.enrollments WHERE id=$1',[crossEnrollment])).rows[0].class_session_id,weekendSession)
  const narrowJob=await rpc('job',{...destination,date_from:'2026-10-04',date_to:'2026-10-04',class_session_id:weekendSession})
  const narrowBatch={job_id:narrowJob.id,key:id(209),fingerprint:'4'.repeat(64),rows:[{source_id:'target-date-report',target_id:id(210),overwrite:[],record:{kind:'report',data:{enrollment_id:weekendEnrollment,class_occurrence_id:targetOccurrence,attendance_status:'present'}}}]}
  await rpc('preview',narrowBatch);await rpc('apply',narrowBatch)
  // Enrollment references created in a prior preview batch are verified through
  // a same-job manifest, then required to be applied before dependent history.
  const dependencyJob=await rpc('job',{...destination,source_class_id:'dependency-test'})
  const dependentEnrollment=id(881), dependentHistory=id(882), parentKey=id(883), childKey=id(884)
  const parent={job_id:dependencyJob.id,key:parentKey,fingerprint:'1'.repeat(64),rows:[{source_id:'1881',target_id:dependentEnrollment,overwrite:[],record:{kind:'enrollment',data:{student_id:student,course_id:course,classroom_id:room,class_session_id:session,status:'regular',start_date:'2026-01-01',time_zone:'Asia/Taipei'}}}]}
  await rpc('preview',parent)
  const parentManifest=[{source_id:'1881',target_id:dependentEnrollment,course_id:course}]
  await rpcManifest(dependencyJob.id,parentKey,parent.fingerprint,parentManifest)
  const dependency={key:parentKey,fingerprint:parent.fingerprint}
  const child={job_id:dependencyJob.id,key:childKey,fingerprint:'2'.repeat(64),dependencies:[dependency],rows:[{source_id:'1881:report:1991',target_id:dependentHistory,overwrite:[],record:{kind:'history_report',data:{enrollment_id:dependentEnrollment,report_date:'2026-10-04',source_origin:destination.source_origin,source_admission_id:'1881',source_key:'report:1991',identity_status:'evidence_only',source_fields:[]}}}]}
  assert.equal((await rpc('preview',child)).rows[0].status,'added')
  await rpcManifest(dependencyJob.id,childKey,child.fingerprint,[],[dependency])
  await assert.rejects(rpcManifest(dependencyJob.id,childKey,child.fingerprint,[],[dependency],'apply-check'),/IMPORT_DEPENDENCY_PENDING/)
  await rpc('apply',parent)
  assert.equal((await rpcManifest(dependencyJob.id,childKey,child.fingerprint,[],[dependency],'apply-check')).status,'ready')
  assert.equal((await rpc('apply',child)).applied,1)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.enrollment_history_reports WHERE id=$1',[dependentHistory])).rows[0].n,1)
  await assert.rejects(rpcManifest(dependencyJob.id,childKey,child.fingerprint,[],[{key:parentKey,fingerprint:'f'.repeat(64)}],'apply-check'),/IMPORT_DEPENDENCY_INVALID/)
  await assert.rejects(rpcManifest(id(999),childKey,child.fingerprint,[],[dependency],'apply-check'),/NOT_FOUND/)
  console.log('PASS: 1000126 durable evidence-only history, false/zero/half stars, source whitelist, ambiguity, classifications, versioned binding/replay, permissions and narrow transfer date')
  await rpc('job-status',{job_id:job.id,status:'paused'})
  await rpc('preview',update)
  assert.equal((await rpcImportInfo({job_id:job.id})).job.status,'paused','previewing a paused job must keep it paused')
  await rpc('preview',update)
  assert.equal((await rpcImportInfo({job_id:job.id})).job.status,'paused','repeated recovery previews must keep the pause')
  await assert.rejects(rpc('apply',update),/JOB_STOPPED/,'a paused job cannot write directly')
  await rpc('job-status',{job_id:job.id,status:'applying'})
  assert.equal((await rpc('apply',update)).applied,1,'explicitly resuming the job permits the reviewed apply')
  const cancelledJob=await rpc('job',{...destination,source_class_id:'cancelled-repreview'})
  await rpc('job-status',{job_id:cancelledJob.id,status:'cancelled'})
  await assert.rejects(rpc('preview',{...update,job_id:cancelledJob.id,key:id(9991)}),/JOB_STOPPED/,'cancelled jobs remain terminal')
  const completeJob=await rpc('job',{...destination,source_class_id:'complete-repreview'})
  await rpc('job-status',{job_id:completeJob.id,status:'complete'})
  await assert.rejects(rpc('preview',{...update,job_id:completeJob.id,key:id(9992)}),/JOB_STOPPED/,'completed jobs remain terminal')
  await db.exec(`UPDATE public.web_extension_tokens SET revoked_at=now() WHERE id='${token}'`)
  await assert.rejects(rpc('context',{}),/EXTENSION_AUTH_INVALID/)
  await assert.rejects(fieldRpc('resolve',[field]),/EXTENSION_AUTH_INVALID/)
  await db.exec("SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(db.query('SELECT public.web_extension_workspace($1,$2,$3,$4)',[token,'a'.repeat(64),'context','{}']),/permission denied/)
  await assert.rejects(db.query('SELECT public.web_extension_field_mappings($1,$2,$3,$4)',[token,'a'.repeat(64),'resolve','{}']),/permission denied/)
  console.log('PASS: workspace/catalog migrations; scoped keyset reads; resolve authorization; actor boundary; create/replay/conflict/versions; atomic rollback; pending pushes; private projections; paused/revoked/restricted roles')
} catch (error) { console.error(error.message, error.where || '', error.position || ''); process.exitCode = 1 }
finally { await db.close() }
