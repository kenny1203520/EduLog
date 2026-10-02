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
async function rpcCatalog(operation, input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query('SELECT public.web_extension_catalog($1,$2,$3,$4) AS data', [token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
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
  await db.exec(`INSERT INTO public.web_extension_tokens(id,user_id,extension_origin,token_hash) VALUES('${token}','${actor}','chrome-extension://${'a'.repeat(32)}','${'a'.repeat(64)}')`)
  const destination = { source_origin:'https://corp.orangeapple.co',source_class_id:'11',date_from:'2026-01-01',date_to:'2026-12-31',classroom_id:room,course_id:course,class_session_id:session }
  const job = await rpc('job',destination), student = id(10)
  const batch = { job_id:job.id,key:id(20),fingerprint:'b'.repeat(64),rows:[{source_id:'101',target_id:student,overwrite:[],record:{kind:'student',data:{name:'Deidentified A'}}}] }
  assert.equal((await rpc('preview',batch)).rows[0].status,'added')
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
  await db.exec(`UPDATE public.students SET name='EduLog edited' WHERE id='${student}'`)
  await assert.rejects(rpc('apply',update),/PREVIEW_STALE/)
  await db.exec("INSERT INTO public.denied_permissions VALUES('teaching.students.update')")
  await assert.rejects(rpc('preview',update),/PERMISSION_DENIED/)
  await db.exec('DELETE FROM public.denied_permissions')
  // A failure late in a batch rolls back previous inserts and source links.
  const partial = {...batch,key:id(23),fingerprint:'e'.repeat(64),rows:[{source_id:'102',target_id:id(11),overwrite:[],record:{kind:'student',data:{name:'B'}}},{source_id:'201',target_id:id(12),overwrite:[],record:{kind:'enrollment',data:{student_id:id(11),course_id:course,classroom_id:room,class_session_id:id(99),status:'regular',start_date:'2026-01-01',time_zone:'Asia/Taipei'}}}]}
  await rpc('preview',partial); await assert.rejects(rpc('apply',partial),/INVALID_REFERENCE/)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.students')).rows[0].n,1)
  const enrollment = id(30), occurrence = id(31), report = id(32)
  await db.exec(`INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,user_id) VALUES('${enrollment}','${student}','${course}','${room}','${session}','${actor}'); INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) VALUES('${occurrence}','${session}','2026-10-02'); INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content) VALUES('${report}','${enrollment}','${occurrence}','Report');`)
  const push = {report_id:report,report_version:1,source_origin:destination.source_origin,source_report_url:'https://corp.orangeapple.co/dt_admissions/301/reports/401',source_id:'401',target_fingerprint:'f'.repeat(64),idempotency_key:id(40)}
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
  await rpc('job-status',{job_id:job.id,status:'paused'}); await assert.rejects(rpc('preview',update),/JOB_STOPPED/)
  await db.exec(`UPDATE public.web_extension_tokens SET revoked_at=now() WHERE id='${token}'`)
  await assert.rejects(rpc('context',{}),/EXTENSION_AUTH_INVALID/)
  await db.exec("SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(db.query('SELECT public.web_extension_workspace($1,$2,$3,$4)',[token,'a'.repeat(64),'context','{}']),/permission denied/)
  console.log('PASS: workspace/catalog migrations; scoped keyset reads; resolve authorization; actor boundary; create/replay/conflict/versions; atomic rollback; pending pushes; private projections; paused/revoked/restricted roles')
} catch (error) { console.error(error.message, error.where || '', error.position || ''); process.exitCode = 1 }
finally { await db.close() }
