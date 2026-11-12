// Isolated PostgreSQL test for 1000148 source report identity. No
// application database is contacted.
// node <this-file> <path-to-pglite/dist/index.js>
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '../../server/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
const read = name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(1), token = id(2), room = id(3), course = id(4), session = id(5), teaching = id(6)
const origin = 'https://corp.orangeapple.co'
async function call(fn, operation, input) {
  await db.exec("SELECT set_config('request.jwt.claim.role','service_role',false)")
  return (await db.query(`SELECT public.${fn}($1,$2,$3,$4) AS data`, [token,'a'.repeat(64),operation,JSON.stringify(input)])).rows[0].data
}
const rpc = (operation, input) => call('web_extension_workspace', operation, input)
const evidenceRpc = (operation, input) => call('web_extension_attendance_evidence', operation, input)
const conflictsRpc = (operation, input) => call('web_extension_source_report_conflicts', operation, input)
const historyRpc = (operation, input) => call('web_extension_history', operation, input)
const rejectsWith = (promise, message, reason) => assert.rejects(promise, error => error.message === message && (!reason || JSON.parse(error.detail).reason === reason))
try {
  await db.exec(readFileSync(new URL('postgres_bootstrap.sql', import.meta.url), 'utf8'))
  await db.exec('CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;')
  for (const name of ['1000001_core_schema.sql','1000002_academics.sql','1000003_operations.sql','1000008_session_time_zones.sql','1000009_date_record_time_zones.sql','1000024_recurring_and_camp_sessions.sql']) await db.exec(read(name).replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g,''))
  await db.exec(`CREATE TABLE public.teachings(id uuid PRIMARY KEY,is_global boolean DEFAULT true);
    ALTER TABLE public.classrooms ADD COLUMN teaching_id uuid; ALTER TABLE public.courses ADD COLUMN teaching_id uuid;
    ALTER TABLE public.class_sessions ADD COLUMN teaching_id uuid;
    CREATE TABLE public.denied_permissions(permission text PRIMARY KEY);
    CREATE TABLE public.denied_enrollment_permissions(enrollment_id uuid NOT NULL,permission text NOT NULL,PRIMARY KEY(enrollment_id,permission));
    CREATE FUNCTION public.has_teaching_permission(uuid,text,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.role()='authenticated' AND auth.uid()=$1 AND NOT EXISTS(SELECT 1 FROM public.denied_permissions WHERE permission=$2) $$;
    CREATE FUNCTION public.has_api_permission(uuid,text,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT public.has_teaching_permission($1,$2,NULL,$3,$4) $$;
    CREATE FUNCTION public.is_teaching_member(uuid,uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.role()='authenticated' AND auth.uid()=$2 $$;
    CREATE FUNCTION public.can_access_classroom(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.classrooms WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,$1,NULL) $$;
    CREATE FUNCTION public.can_access_class_session(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.class_sessions WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,$1) $$;
    CREATE FUNCTION public.can_access_student(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.students WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,NULL) $$;
    CREATE FUNCTION public.can_access_enrollment(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.enrollments WHERE id=$1) AND public.has_api_permission(auth.uid(),$2,NULL,NULL) AND NOT EXISTS(SELECT 1 FROM public.denied_enrollment_permissions WHERE enrollment_id=$1 AND permission=$2) $$;
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
  await db.exec(`CREATE TABLE public.api_idempotency_keys(
    user_id uuid NOT NULL,idempotency_key text NOT NULL,method text NOT NULL,route text NOT NULL,
    response_status integer,response_body jsonb,teaching_id uuid,PRIMARY KEY(user_id,idempotency_key)
  )`)
  await db.exec(read('1000063_report_mutation_contract_and_delete_replay.sql'))
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
  await db.exec(read('1000141_import_lifecycle_effect_receipts.sql'))
  await db.exec(`INSERT INTO public.web_extension_tokens(id,user_id,extension_origin,token_hash) VALUES('${token}','${actor}','chrome-extension://${'a'.repeat(32)}','${'a'.repeat(64)}')`)
  // Pre-upgrade data with every duplicate shape the migration must resolve.
  const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  const student = id(1001), e1 = id(1011), e2 = id(1012)
  const [o1, o2, o3, o4] = [id(1021), id(1022), id(1023), id(1024)]
  const [r1, r2, r3] = [id(1031), id(1032), id(1033)]
  const h = n => id(1100 + n)
  await db.exec(`INSERT INTO public.students(id,name,user_id) VALUES('${student}','Identity student','${actor}');
    INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,user_id,start_date,status) VALUES
      ('${e1}','${student}','${course}','${room}','${session}','${actor}','2026-01-01','regular'),
      ('${e2}','${student}','${course}','${room}','${session}','${actor}','2026-01-01','regular');
    INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) VALUES
      ('${o1}','${session}','2026-09-05'),('${o2}','${session}','2026-09-12'),('${o3}','${session}','2026-09-26'),('${o4}','${session}','2026-10-03');
    INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content) VALUES
      ('${r1}','${e1}','${o1}','first'),('${r2}','${e1}','${o2}','second'),('${r3}','${e2}','${o3}','third');`)
  const history = (n, enrollment, admission, date, reportId, key, status, linked, updated, attendance = 'present') => `('${h(n)}','${actor}','${enrollment}','${date}','${origin}','${admission}',${reportId ? `'${reportId}'` : 'NULL'},'${key}','${status}',${linked ? `'${linked}'` : 'NULL'},'${attendance}','${updated}')`
  await db.exec(`INSERT INTO public.enrollment_history_reports(id,user_id,enrollment_id,report_date,source_origin,source_admission_id,source_report_id,source_key,identity_status,linked_report_id,attendance_status,updated_at) VALUES
    ${history(1, e1, '6001', '2026-09-05', '900', 'report:6001:900', 'verified', r1, '2026-09-06')},
    ${history(2, e2, '6002', '2026-09-05', '900', 'report:6002:900', 'verified', null, '2026-09-20')},
    ${history(3, e1, '6001', '2026-09-12', '901', 'report:6001:901', 'verified', r2, '2026-09-13')},
    ${history(5, e1, '6001', '2026-08-29', '902', 'report:6001:902', 'verified', null, '2026-09-01')},
    ${history(6, e1, '6001', '2026-08-29', '902', 'report:902', 'verified', null, '2026-09-02')},
    ${history(7, e1, '6001', '2026-09-19', null, 'evidence:a', 'evidence_only', null, '2026-09-19', 'present')},
    ${history(8, e1, '6001', '2026-09-19', null, 'evidence:b', 'evidence_only', null, '2026-09-19', 'absent')},
    ${history(9, e2, '6002', '2026-09-26', null, 'evidence:c', 'evidence_only', null, '2026-09-26', 'present')},
    ${history(10, e2, '6002', '2026-09-26', '903', 'report:6002:903', 'verified', r3, '2026-09-27')},
    ${history(11, e2, '6002', '2026-09-26', '904', 'report:6002:904', 'verified', r3, '2026-09-28')}`)

  // The read-only preflight reports the same decisions before the upgrade.
  const preflight = await db.exec(readFileSync(new URL('../preflight/source_report_identity_report.sql', import.meta.url), 'utf8'))
  const summary = Object.fromEntries(preflight[0].rows.map(row => [row.item, Number(row.row_count)]))
  console.log('preflight summary', JSON.stringify(summary))
  assert.deepEqual(summary, { report_ids_with_duplicates: 2, history_rows_superseded: 2, superseded_rows_linked_elsewhere: 0, evidence_only_rows_archived: 3, evidence_only_rows_with_linked_report: 0, attendance_evidence_rows_created: 2, lesson_reports_linked_by_several_report_ids: 1 })
  assert.deepEqual(preflight[1].rows.map(row => [row.source_report_id, row.decision, row.history_id]), [['900', 'kept', h(1)], ['900', 'superseded', h(2)], ['902', 'kept', h(6)], ['902', 'superseded', h(5)]])
  assert.deepEqual(preflight[2].rows.map(row => [day(row.evidence_date), Number(row.attendance_count), Number(row.present_count), Number(row.absent_count)]), [['2026-09-19', 2, 1, 1], ['2026-09-26', 1, 1, 0]])
  assert.equal(preflight[3].rows.length, 1); assert.equal(preflight[3].rows[0].occurrence_report_id, r3)

  await db.exec(read('1000148_source_report_identity.sql'))
  await db.exec('ALTER TABLE public.report_versions ADD COLUMN IF NOT EXISTS snapshot jsonb')
  await db.exec(read('1000169_multi_lesson_report_entries.sql'))
  await db.exec(read('1000170_report_occurrence_correction.sql'))
  await db.exec(read('1000171_extension_primary_lesson_sync.sql'))
  const retired = Object.fromEntries((await db.query('SELECT id,retired_as,superseded_by FROM public.enrollment_history_reports ORDER BY id')).rows.map(row => [row.id, [row.retired_as, row.superseded_by]]))
  assert.deepEqual(retired[h(2)], ['superseded', h(1)]); assert.deepEqual(retired[h(5)], ['superseded', h(6)])
  for (const n of [1, 3, 6, 10, 11]) assert.deepEqual(retired[h(n)], [null, null])
  for (const n of [7, 8, 9]) assert.equal(retired[h(n)][0], 'archived')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.enrollment_history_reports')).rows[0].n, 10, 'no history row is deleted')
  const evidence = (await db.query('SELECT enrollment_id,evidence_date::text AS date,attendance_count,present_count,absent_count,cardinality(migrated_history_ids) AS migrated FROM public.enrollment_attendance_evidence ORDER BY evidence_date')).rows
  assert.deepEqual(evidence, [{ enrollment_id: e1, date: '2026-09-19', attendance_count: 2, present_count: 1, absent_count: 1, migrated: 2 }, { enrollment_id: e2, date: '2026-09-26', attendance_count: 1, present_count: 1, absent_count: 0, migrated: 1 }])
  const backfilled = Object.fromEntries((await db.query('SELECT id,source_report_id,source_admission_id,source_synced_version FROM public.occurrence_reports')).rows.map(row => [row.id, row]))
  assert.equal(backfilled[r1].source_report_id, '900'); assert.equal(backfilled[r2].source_report_id, '901'); assert.equal(backfilled[r3].source_report_id, null, 'a lesson report claimed by two reportIds stays unbound')
  assert.equal(backfilled[r1].source_synced_version, null, 'backfilled links never claim an untouched baseline')
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.web_extension_source_links WHERE source_kind='report'")).rows[0].n, 2)
  const report = await conflictsRpc('list', {})
  console.log('conflict report summary', JSON.stringify(report.summary))
  assert.deepEqual(report.summary, { kept: 2, superseded: 2, archived_evidence: 3, occurrence_backfilled: 2, occurrence_conflict: 2, link_conflict: 0 })
  const firstPage = await conflictsRpc('list', { action: 'superseded', limit: 1 })
  assert.equal(firstPage.items.length, 1); assert.ok(firstPage.next_cursor)
  assert.equal((await conflictsRpc('list', { action: 'superseded', limit: 1, cursor: firstPage.next_cursor })).items.length, 1)
  await rejectsWith(conflictsRpc('list', { action: 'deleted' }), 'INVALID_IMPORT')

  // Global uniqueness for active history and lesson reports.
  await assert.rejects(db.query(`INSERT INTO public.enrollment_history_reports(user_id,enrollment_id,report_date,source_origin,source_admission_id,source_report_id,source_key,identity_status) VALUES('${actor}','${e2}','2026-09-05','${origin}','6002','901','report:6002:901','verified')`), /duplicate key|unique/)
  await assert.rejects(db.query(`UPDATE public.occurrence_reports SET source_origin='${origin}',source_admission_id='6002',source_report_id='900' WHERE id='${r3}'`), /duplicate key|unique/)
  await db.query(`INSERT INTO public.enrollment_history_reports(user_id,enrollment_id,report_date,source_origin,source_admission_id,source_report_id,source_key,identity_status,retired_as,retired_at,superseded_by) VALUES('${actor}','${e2}','2026-09-12','${origin}','6002','901','report:legacy:901','verified','superseded',now(),'${h(3)}')`)
  const listed = (await historyRpc('list', { enrollment_id: e1 })).items.map(item => item.id)
  assert.ok(listed.includes(h(6)) && !listed.includes(h(5)) && !listed.includes(h(7)), 'retired history is hidden from listing')
  console.log('PASS: 1000148 preflight and migration supersede duplicate reportIds, archive evidence-only rows as attendance evidence, backfill unique lesson report identity')

  // Import writes: reportId upsert, source link, re-sync overwrite rule.
  await db.exec(`INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,target_id,student_id,course_id,class_session_id) VALUES('${actor}','${origin}','admission','6001','${e1}','${student}','${course}','${session}')`)
  const job = await rpc('job', { source_origin: origin, source_class_id: '11', date_from: '2026-01-01', date_to: '2026-12-31', classroom_id: room, course_id: course, class_session_id: session })
  let round = 0
  const historyTarget = id(1201)
  const row = (content, overwrite = []) => ({ source_id: '6001:report:905', target_id: historyTarget, overwrite: ['content'], record: { kind: 'history_report', data: { enrollment_id: e1, report_date: '2026-10-03', source_origin: origin, source_admission_id: '6001', source_report_id: '905', source_key: 'report:6001:905', identity_status: 'verified', source_fields: [{ key: 'content', label: '評語', text: content }], content, external_link: `${origin}/dt_admissions/6001/reports/905/edit` } }, history_reconciliation: { key: id(1300 + round), class_occurrence_id: o4, include_fields: ['content'], overwrite, include_internal: false } })
  const sync = async rows => { round++; const batch = { job_id: job.id, key: id(1400 + round), fingerprint: String(round % 10).repeat(64), rows }; const preview = await rpc('preview', batch); return { preview, applied: await rpc('apply', batch) } }
  const lesson = async () => (await db.query('SELECT * FROM public.occurrence_reports WHERE enrollment_id=$1 AND class_occurrence_id=$2', [e1, o4])).rows[0]
  assert.equal((await rpc('capabilities', {})).source_report_identity, true)
  let result = await sync([row('v1')])
  assert.equal(result.preview.rows[0].history_reconciliation.source_sync_state, 'new')
  let saved = await lesson()
  assert.equal(saved.content, 'v1'); assert.equal(saved.source_report_id, '905'); assert.equal(saved.source_synced_version, saved.version); assert.deepEqual(saved.source_synced_fields, { content: 'v1' })
  assert.equal((await db.query("SELECT edulog_id FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='905'")).rows[0].edulog_id, saved.id)
  result = await sync([row('v2')])
  assert.equal(result.preview.rows[0].history_reconciliation.source_sync_state, 'untouched')
  assert.equal(result.preview.rows[0].history_reconciliation.changes[0].status, 'updated', 'an untouched lesson report is overwritten by the source')
  assert.equal((await lesson()).content, 'v2')
  await db.query("UPDATE public.occurrence_reports SET content='EduLog edit',version=version+1 WHERE id=$1", [saved.id])
  result = await sync([row('v3')])
  assert.equal(result.preview.rows[0].history_reconciliation.source_sync_state, 'edulog_changed')
  assert.equal(result.preview.rows[0].history_reconciliation.changes[0].status, 'preserved', 'both sides changed: EduLog is kept until the teacher chooses')
  assert.equal((await lesson()).content, 'EduLog edit')
  await db.query("UPDATE public.occurrence_reports SET content='EduLog edit 2',version=version+1 WHERE id=$1", [saved.id])
  result = await sync([row('v4', ['content'])])
  assert.equal(result.preview.rows[0].history_reconciliation.changes[0].status, 'updated', 'an explicit teacher choice applies the source')
  saved = await lesson(); assert.equal(saved.content, 'v4'); assert.equal(saved.source_synced_version, saved.version)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.occurrence_reports WHERE source_report_id='905'")).rows[0].n, 1, 're-sync never creates a second lesson report')
  const reportCount = async () => (await db.query('SELECT count(*)::int AS n FROM public.occurrence_reports')).rows[0].n
  const before = await reportCount(); await sync([row('v4')]); assert.equal(await reportCount(), before, 'a repeated import adds nothing')

  // Identity conflicts are explicit, never silent second rows.
  const copy = { ...row('other'), source_id: '6001:report:905:copy', target_id: id(1202) }
  await rejectsWith(rpc('preview', { job_id: job.id, key: id(1501), fingerprint: 'a'.repeat(64), rows: [copy] }), 'SOURCE_MAPPING_CONFLICT', 'SOURCE_REPORT_ALREADY_IMPORTED')
  const rebind = row('rebind'); rebind.history_reconciliation.class_occurrence_id = o2
  await rejectsWith(rpc('preview', { job_id: job.id, key: id(1502), fingerprint: 'b'.repeat(64), rows: [rebind] }), 'SOURCE_MAPPING_CONFLICT', 'SOURCE_REPORT_BOUND_ELSEWHERE')
  const evidenceRow = row('evidence'); evidenceRow.target_id = id(1203); evidenceRow.source_id = '6001:evidence'; delete evidenceRow.history_reconciliation
  const { source_report_id: _reportId, external_link: _link, ...evidenceData } = evidenceRow.record.data
  evidenceRow.record = { ...evidenceRow.record, data: { ...evidenceData, identity_status: 'evidence_only', source_key: 'evidence:new', report_date: '2026-10-17' } }
  await rejectsWith(rpc('preview', { job_id: job.id, key: id(1503), fingerprint: 'c'.repeat(64), rows: [evidenceRow] }), 'INVALID_IMPORT', 'REPORT_IDENTITY_REQUIRED')
  console.log('PASS: 1000148 reportId upsert, report source links, untouched overwrite, both-changed preservation, explicit identity conflicts')

  // Cross-course progress is synchronized into the matching lesson entry of
  // a shared report, and a corrected occurrence keeps that exact source link.
  const courseB = id(2001), roomB = id(2002), sessionB = id(2003), enrollmentB = id(2004)
  const lessonA = id(2005), lessonB = id(2006), occurrenceB = id(2007), correctedOccurrence = id(2008), lessonNewEntry = id(2016)
  const sharedReport = id(2009), entryA = id(2010), entryB = id(2011), historyB = id(2012)
  await db.exec(`
    INSERT INTO public.classrooms(id,name,user_id,teaching_id) VALUES('${roomB}','Course B room','${actor}','${teaching}');
    INSERT INTO public.courses(id,subject,stage,user_id,teaching_id,display_name) VALUES('${courseB}','Course B','1','${actor}','${teaching}','Course B');
    INSERT INTO public.class_sessions(id,name,classroom_id,course_ids,start_time,end_time,user_id,teaching_id) VALUES('${sessionB}','Course B class','${roomB}',ARRAY['${courseB}'::uuid],'10:00','11:00','${actor}','${teaching}');
    INSERT INTO public.lessons(id,course_id,title,sequence,user_id) VALUES
      ('${lessonA}','${course}','Course A lesson 1',1,'${actor}'),('${lessonB}','${courseB}','Course B lesson 4',4,'${actor}'),
      ('${lessonNewEntry}','${courseB}','Course B lesson 5',5,'${actor}');
    INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,user_id,start_date,status) VALUES
      ('${enrollmentB}','${student}','${courseB}','${roomB}','${sessionB}','${actor}','2026-01-01','regular');
    INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date) VALUES
      ('${occurrenceB}','${session}','2026-10-10'),('${correctedOccurrence}','${session}','2026-10-17');
    INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,attendance_status,content,lesson_entries,primary_lesson_entry_id)
    VALUES('${sharedReport}','${e1}','${occurrenceB}','${lessonA}',true,'B','present','Shared teacher comment',
      jsonb_build_array(
        jsonb_build_object('id','${entryA}','enrollment_id','${e1}','course_id','${course}','lesson_id','${lessonA}','is_completed',true,'progress_letter','B'),
        jsonb_build_object('id','${entryB}','enrollment_id','${enrollmentB}','course_id','${courseB}','lesson_id','${lessonB}','is_completed',false,'progress_letter','A')
      ),'${entryA}');
    INSERT INTO public.enrollment_history_reports(id,user_id,enrollment_id,report_date,source_origin,source_admission_id,source_report_id,source_key,identity_status,lesson_id,is_completed,progress_letter,attendance_status,updated_at)
    VALUES('${historyB}','${actor}','${enrollmentB}','2026-10-10','${origin}','6003','906','report:6003:906','verified','${lessonB}',false,'A','present',now());
    INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,target_id,student_id,course_id,class_session_id)
    VALUES('${actor}','${origin}','admission','6003','${enrollmentB}','${student}','${courseB}','${sessionB}');
  `)
  let lessonBatch = 1600
  const lessonSyncRow = (completed, progressLetter, classOccurrenceId = occurrenceB, reconfirmOccurrence = false, reportId = sharedReport) => ({
    source_id: '6003:report:906', target_id: historyB,
    record: { kind: 'history_report', data: {
      enrollment_id: enrollmentB, report_date: '2026-10-10', source_origin: origin,
      source_admission_id: '6003', source_report_id: '906', source_key: 'report:6003:906', identity_status: 'verified',
      source_fields: [
        { key: 'is_completed', label: '完成狀態', text: String(completed) },
        { key: 'progress_letter', label: '進度', text: progressLetter },
      ],
      lesson_id: lessonB, is_completed: completed, progress_letter: progressLetter,
      external_link: `${origin}/dt_admissions/6003/reports/906/edit`,
    } },
    history_reconciliation: {
      key: id(2100 + lessonBatch), class_occurrence_id: classOccurrenceId,
      report_id: reportId, reconfirm_occurrence: reconfirmOccurrence,
      lesson_entry: { enrollment_id: enrollmentB, course_id: courseB, lesson_id: lessonB, entry_id: entryB },
      include_fields: ['lesson_id', 'is_completed', 'progress_letter'], overwrite: ['is_completed', 'progress_letter'], include_internal: false,
    },
  })
  const syncLessonB = async (completed, progressLetter, classOccurrenceId = occurrenceB, reconfirmOccurrence = false, reportId = sharedReport) => {
    lessonBatch++
    const batch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [lessonSyncRow(completed, progressLetter, classOccurrenceId, reconfirmOccurrence, reportId)] }
    const preview = await rpc('preview', batch)
    const applied = await rpc('apply', batch)
    return { preview, applied }
  }
  let crossCourse = await syncLessonB(true, 'C')
  assert.equal(crossCourse.preview.rows[0].history_reconciliation.report_id, sharedReport)
  let shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  const entry = id => shared.lesson_entries.find(item => item.id === id)
  assert.deepEqual([entry(entryA).is_completed, entry(entryA).progress_letter], [true, 'B'], 'course A entry is preserved')
  assert.deepEqual([entry(entryB).is_completed, entry(entryB).progress_letter], [true, 'C'], 'course B entry is updated')
  assert.equal(shared.primary_lesson_entry_id, entryA, 'the report primary entry is preserved')
  assert.equal(shared.content, 'Shared teacher comment'); assert.equal(shared.attendance_status, 'present', 'shared report fields are preserved')
  assert.equal(shared.source_report_id, '906'); assert.equal((await db.query('SELECT linked_report_id FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].linked_report_id, sharedReport)

  crossCourse = await syncLessonB(false, 'D')
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  assert.deepEqual([entry(entryA).is_completed, entry(entryA).progress_letter], [true, 'B'], 're-sync does not overwrite the sibling course entry')
  assert.deepEqual([entry(entryB).is_completed, entry(entryB).progress_letter], [false, 'D'], 'a changed source value re-syncs the exact lesson entry')
  assert.equal(shared.primary_lesson_entry_id, entryA); assert.equal(shared.id, sharedReport); assert.equal(shared.source_report_id, '906')
  assert.equal(shared.content, 'Shared teacher comment'); assert.equal(shared.attendance_status, 'present')

  const reportIdBeforeCorrection = shared.id
  await db.exec(`SELECT set_config('request.jwt.claims',jsonb_build_object('sub','${actor}','role','authenticated')::text,false);
    SELECT set_config('request.jwt.claim.sub','${actor}',false);
    SELECT set_config('request.jwt.claim.role','authenticated',false);`)
  const correction = (await db.query('SELECT public.correct_occurrence_report($1,$2,$3) AS result',[sharedReport,correctedOccurrence,shared.version])).rows[0].result
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  assert.equal(correction.report.id, reportIdBeforeCorrection, 'the occurrence correction RPC retains report identity')
  assert.equal(shared.id, reportIdBeforeCorrection); assert.equal(shared.class_occurrence_id, correctedOccurrence)
  assert.equal(shared.source_report_id, '906'); assert.equal(shared.primary_lesson_entry_id, entryA)
  assert.deepEqual(shared.lesson_entries.map(item => item.id), [entryA, entryB], 'the correction RPC retains all lesson entries')
  assert.equal((await db.query("SELECT edulog_id FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='906'")).rows[0].edulog_id,sharedReport,'the correction RPC retains the extension source link')
  const snapshotSyncState = async () => ({
    report: (await db.query('SELECT id,enrollment_id,class_occurrence_id,version,lesson_entries,primary_lesson_entry_id,content,attendance_status,source_report_id FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0],
    history: (await db.query('SELECT id,enrollment_id,linked_report_id,source_origin,source_admission_id,source_report_id,source_key,is_completed,progress_letter FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0],
    sourceLink: (await db.query("SELECT edulog_id,target_version FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='906'")).rows[0],
  })
  const beforeUnconfirmed = await snapshotSyncState()
  const unconfirmed = { job_id: job.id, key: id(2299), fingerprint: 'f'.repeat(64), rows: [lessonSyncRow(true, 'E', correctedOccurrence, false)] }
  await rejectsWith(rpc('preview', unconfirmed), 'INVALID_REFERENCE')
  await rejectsWith(rpc('apply', unconfirmed), 'INVALID_REFERENCE')
  assert.deepEqual(await snapshotSyncState(),beforeUnconfirmed,'missing confirmation changes no history, report, entry, or source binding')

  const decoyReport = id(2013)
  await db.query('INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content) VALUES($1,$2,$3,$4)', [decoyReport,e2,correctedOccurrence,'Decoy must remain untouched'])
  const wrongReportRow = lessonSyncRow(false, 'X', correctedOccurrence, true, decoyReport)
  wrongReportRow.record.data.report_date = '2026-10-17'
  const wrongReport = { job_id: job.id, key: id(2298), fingerprint: 'e'.repeat(64), rows: [wrongReportRow] }
  await assert.rejects(rpc('preview', wrongReport), error => ['SOURCE_MAPPING_CONFLICT', 'HISTORY_ALREADY_LINKED'].includes(error.message), 'a reconfirmed request with a matching date cannot point at a decoy report')
  await assert.rejects(rpc('apply', wrongReport), error => ['SOURCE_MAPPING_CONFLICT', 'HISTORY_ALREADY_LINKED'].includes(error.message), 'apply rejects a matching-date decoy target too')
  assert.deepEqual(await snapshotSyncState(),beforeUnconfirmed,'wrong report pairing changes no history, report, entry, or source binding')
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  assert.equal(shared.class_occurrence_id, correctedOccurrence); assert.equal(shared.source_report_id, '906')
  assert.equal((await db.query('SELECT content FROM public.occurrence_reports WHERE id=$1',[decoyReport])).rows[0].content,'Decoy must remain untouched')
  assert.equal((await db.query('SELECT linked_report_id FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].linked_report_id,sharedReport)
  assert.equal((await db.query("SELECT edulog_id FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='906'")).rows[0].edulog_id,sharedReport)

  const linkedRoutes = await historyRpc('route-linked', { enrollment_id: enrollmentB, linked_report_ids: [sharedReport] })
  assert.equal(linkedRoutes.items.length, 1); assert.equal(linkedRoutes.items[0].id, correctedOccurrence)
  assert.equal(linkedRoutes.items[0].report.id, sharedReport)
  assert.ok(linkedRoutes.items[0].report.lesson_entry_labels.some(item => item.id === entryB && item.enrollment_id === enrollmentB && item.lesson_id === lessonB))

  // When the source admission maps to another enrollment, recover the old
  // binding through the permission-filtered student/source-admission list and
  // route only its exact linked history row to the new target.
  await db.query('UPDATE public.enrollment_history_reports SET enrollment_id=$1 WHERE id=$2',[e1,historyB])
  const remappedArchive = await historyRpc('list', { student_id: student, source_admission_id: '6003' })
  assert.equal(remappedArchive.items.length, 1)
  assert.equal(remappedArchive.items[0].id, historyB); assert.equal(remappedArchive.items[0].enrollment_id, e1)
  const remappedRoutes = await historyRpc('route-linked', { enrollment_id: enrollmentB, linked_report_ids: [sharedReport], linked_history_ids: [historyB] })
  assert.equal(remappedRoutes.items.length, 1); assert.equal(remappedRoutes.items[0].report.id, sharedReport)
  assert.equal(remappedRoutes.items[0].id, correctedOccurrence)
  const wrongLinkedRows = await historyRpc('route-linked', { enrollment_id: enrollmentB, linked_report_ids: [sharedReport], linked_history_ids: [h(1)] })
  assert.equal(wrongLinkedRows.items.length, 0, 'a different history row cannot authorize a report route')

  const missingRemapConfirmation = { job_id: job.id, key: id(2297), fingerprint: 'd'.repeat(64), rows: [lessonSyncRow(true,'G',correctedOccurrence,false)] }
  await assert.rejects(rpc('preview', missingRemapConfirmation), error => error.message === 'INVALID_REFERENCE', 'a changed enrollment must be explicitly reconfirmed')
  await assert.rejects(rpc('apply', missingRemapConfirmation), error => error.message === 'INVALID_REFERENCE', 'apply independently requires remap confirmation')

  const unrelatedStudent = id(2014), unrelatedEnrollment = id(2015)
  await db.query("INSERT INTO public.students(id,name,user_id) VALUES($1,'Unrelated student',$2)",[unrelatedStudent,actor])
  await db.query("INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,user_id,start_date,status) VALUES($1,$2,$3,$4,$5,$6,'2026-01-01','regular')",[unrelatedEnrollment,unrelatedStudent,courseB,roomB,sessionB,actor])
  const beforeUnrelatedTarget = await snapshotSyncState()
  const unrelatedRow = lessonSyncRow(false,'Z',correctedOccurrence,true)
  unrelatedRow.record.data.enrollment_id = unrelatedEnrollment
  unrelatedRow.record.data.report_date = '2026-10-17'
  unrelatedRow.record.data.content = 'forged shared-field update'
  unrelatedRow.history_reconciliation.include_fields = ['content']
  unrelatedRow.history_reconciliation.overwrite = ['content']
  delete unrelatedRow.history_reconciliation.lesson_entry
  const unrelatedBatch = { job_id: job.id, key: id(2296), fingerprint: 'c'.repeat(64), rows: [unrelatedRow] }
  await assert.rejects(rpc('preview', unrelatedBatch), error => error.message === 'INVALID_REFERENCE', 'a different student cannot receive shared report fields')
  await assert.rejects(rpc('apply', unrelatedBatch), error => error.message === 'INVALID_REFERENCE', 'apply rejects an unrelated target before writes')
  assert.deepEqual(await snapshotSyncState(),beforeUnrelatedTarget,'unrelated target rejection changes no history, report, entry, or source binding')

  lessonBatch++
  const remapBatch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [lessonSyncRow(true,'F',correctedOccurrence,true)] }
  await db.query('INSERT INTO public.denied_enrollment_permissions(enrollment_id,permission) VALUES($1,$2),($1,$3)',[e1,'teaching.enrollments.read','teaching.reports.read'])
  await assert.rejects(rpc('preview', remapBatch), error => error.message === 'PERMISSION_DENIED', 'preview rechecks old-enrollment read access')
  assert.deepEqual(await snapshotSyncState(),beforeUnrelatedTarget,'denied preview changes no history, report, entry, or source binding')
  await db.query('DELETE FROM public.denied_enrollment_permissions WHERE enrollment_id=$1',[e1])
  const remapPreview = await rpc('preview', remapBatch)
  assert.equal(remapPreview.rows[0].history_reconciliation.report_id, sharedReport)
  await db.query('INSERT INTO public.denied_enrollment_permissions(enrollment_id,permission) VALUES($1,$2),($1,$3)',[e1,'teaching.enrollments.read','teaching.reports.read'])
  await assert.rejects(rpc('apply', remapBatch), error => error.message === 'PERMISSION_DENIED', 'apply rechecks old-enrollment read access')
  assert.deepEqual(await snapshotSyncState(),beforeUnrelatedTarget,'denied apply leaves history, report entries, and source binding untouched')
  await db.query('DELETE FROM public.denied_enrollment_permissions WHERE enrollment_id=$1',[e1])

  await rpc('apply', remapBatch)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0]
  assert.equal(shared.id,reportIdBeforeCorrection); assert.equal(shared.class_occurrence_id,correctedOccurrence)
  assert.equal(shared.source_report_id,'906'); assert.equal(shared.primary_lesson_entry_id,entryA)
  assert.deepEqual([entry(entryA).is_completed,entry(entryA).progress_letter],[true,'B'],'remap preserves the sibling lesson')
  assert.deepEqual([entry(entryB).is_completed,entry(entryB).progress_letter],[true,'F'],'remap updates the exact target course lesson')
  assert.equal(shared.content,'Shared teacher comment'); assert.equal(shared.attendance_status,'present')
  const remappedHistory = (await db.query('SELECT enrollment_id,linked_report_id,source_origin,source_admission_id,source_report_id,source_key FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0]
  assert.deepEqual(remappedHistory,{enrollment_id:enrollmentB,linked_report_id:sharedReport,source_origin:origin,source_admission_id:'6003',source_report_id:'906',source_key:'report:6003:906'},'apply persists the confirmed target enrollment while retaining exact source binding')
  assert.equal((await db.query("SELECT edulog_id FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='906'")).rows[0].edulog_id,sharedReport)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.occurrence_reports, jsonb_array_elements(lesson_entries) item WHERE id=$1 AND item->>'enrollment_id'=$2 AND item->>'lesson_id'=$3",[sharedReport,enrollmentB,lessonB])).rows[0].n,1,'one B lesson entry remains')

  lessonBatch++
  const staleBatch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [lessonSyncRow(false, 'F', correctedOccurrence, true)] }
  const stalePreview = await rpc('preview', staleBatch)
  assert.equal(stalePreview.rows[0].history_reconciliation.report_id, sharedReport)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  const beforeStaleEntry = entry(entryB)
  await db.query('UPDATE public.occurrence_reports SET version=version+1 WHERE id=$1',[sharedReport])
  await rejectsWith(rpc('apply', staleBatch), 'PREVIEW_STALE', 'OCCURRENCE_REPORT_VERSION_CHANGED')
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  assert.deepEqual(entry(entryB), beforeStaleEntry, 'a stale shared-report version cannot partially update lesson progress')
  assert.equal(shared.source_report_id, '906'); assert.equal(shared.class_occurrence_id, correctedOccurrence)
  assert.equal((await db.query('SELECT linked_report_id,is_completed,progress_letter FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].linked_report_id,sharedReport)

  crossCourse = await syncLessonB(true, 'E', correctedOccurrence, true)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1', [sharedReport])).rows[0]
  assert.equal(shared.id, reportIdBeforeCorrection); assert.equal(shared.class_occurrence_id, correctedOccurrence)
  assert.equal(shared.source_report_id, '906'); assert.equal(shared.primary_lesson_entry_id, entryA)
  assert.deepEqual([entry(entryA).is_completed, entry(entryA).progress_letter], [true, 'B'])
  assert.deepEqual([entry(entryB).is_completed, entry(entryB).progress_letter], [true, 'E'])
  assert.equal(shared.content, 'Shared teacher comment'); assert.equal(shared.attendance_status, 'present')
  assert.equal((await db.query('SELECT linked_report_id FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].linked_report_id, sharedReport)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.web_extension_source_links WHERE source_kind='report' AND source_id='906' AND edulog_id=$1",[sharedReport])).rows[0].n,1)

  const linkedAgain = await historyRpc('route-linked', { enrollment_id: enrollmentB, linked_report_ids: [sharedReport], linked_history_ids: [historyB] })
  assert.equal(linkedAgain.items[0].id, correctedOccurrence); assert.equal(linkedAgain.items[0].report.id, sharedReport)
  console.log('PASS: 1000171 updates only the cross-course lesson entry, preserves shared report identity and fields, blocks corrected occurrence sync until confirmation, and reuses the original report link')

  // A confirmed remap may create a target lesson entry only when that exact
  // enrollment/course/lesson tuple is absent. Once created, retries and stale
  // entry-less or wrong-ID requests must not create or rebind another entry.
  await db.query('UPDATE public.enrollment_history_reports SET enrollment_id=$1 WHERE id=$2',[e1,historyB])
  const newEntryRoute = await historyRpc('route-linked', { enrollment_id: enrollmentB, linked_report_ids: [sharedReport], linked_history_ids: [historyB] })
  assert.equal(newEntryRoute.items[0].report.id, sharedReport)
  const newEntryRow = lessonSyncRow(true,'G',correctedOccurrence,true)
  newEntryRow.record.data.lesson_id = lessonNewEntry
  newEntryRow.history_reconciliation.lesson_entry = { enrollment_id: enrollmentB, course_id: courseB, lesson_id: lessonNewEntry }
  lessonBatch++
  const newEntryBatch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [newEntryRow] }
  const beforeNewEntry = await snapshotSyncState()
  const wrongEntryRow = structuredClone(newEntryRow)
  wrongEntryRow.history_reconciliation.lesson_entry.entry_id = entryA
  await assert.rejects(rpc('preview',{ ...newEntryBatch, key: id(2301), fingerprint: 'a'.repeat(64), rows: [wrongEntryRow] }),error => error.message === 'INVALID_REFERENCE','a different lesson entry cannot be rebound')
  assert.deepEqual(await snapshotSyncState(),beforeNewEntry,'wrong entry ID changes no history, report, entry, or source link')
  const newEntryPreview = await rpc('preview',newEntryBatch)
  assert.equal(newEntryPreview.rows[0].history_reconciliation.report_id,sharedReport)
  await db.query("INSERT INTO public.denied_permissions(permission) VALUES('teaching.class_sessions.read')")
  await assert.rejects(rpc('apply',newEntryBatch),error => error.message === 'PERMISSION_DENIED','apply rechecks class-session read permission after preview')
  assert.deepEqual(await snapshotSyncState(),beforeNewEntry,'revoked class-session permission leaves all rows untouched')
  await db.query("DELETE FROM public.denied_permissions WHERE permission='teaching.class_sessions.read'")
  await rpc('apply',newEntryBatch)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0]
  const createdEntries = shared.lesson_entries.filter(item => item.enrollment_id===enrollmentB && item.course_id===courseB && item.lesson_id===lessonNewEntry)
  assert.equal(createdEntries.length,1,'confirmed remap creates exactly one missing target lesson entry')
  const createdEntryId = createdEntries[0].id
  assert.deepEqual([createdEntries[0].is_completed,createdEntries[0].progress_letter],[true,'G'])
  assert.equal(shared.primary_lesson_entry_id,entryA); assert.equal(shared.id,sharedReport); assert.equal(shared.source_report_id,'906')
  assert.equal((await db.query('SELECT enrollment_id,linked_report_id,source_report_id FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].enrollment_id,enrollmentB)
  assert.equal((await db.query('SELECT linked_report_id FROM public.enrollment_history_reports WHERE id=$1',[historyB])).rows[0].linked_report_id,sharedReport)
  assert.deepEqual([entry(entryA).is_completed,entry(entryA).progress_letter],[true,'B'],'creating the new lesson entry preserves the sibling lesson')
  await rpc('apply',newEntryBatch)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0]
  assert.equal(shared.lesson_entries.filter(item => item.enrollment_id===enrollmentB && item.course_id===courseB && item.lesson_id===lessonNewEntry).length,1,'replaying the same batch does not duplicate the created entry')
  const staleEntryless = structuredClone(newEntryRow)
  lessonBatch++
  const staleEntrylessBatch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [staleEntryless] }
  await assert.rejects(rpc('preview',staleEntrylessBatch),error => error.message === 'INVALID_REFERENCE','a new batch with stale entry-less metadata cannot duplicate the entry')
  const exactEntryRow = structuredClone(newEntryRow)
  exactEntryRow.history_reconciliation.lesson_entry.entry_id = createdEntryId
  lessonBatch++
  const exactEntryBatch = { job_id: job.id, key: id(2200 + lessonBatch), fingerprint: String(lessonBatch % 10).repeat(64), rows: [exactEntryRow] }
  await rpc('preview',exactEntryBatch)
  await rpc('apply',exactEntryBatch)
  shared = (await db.query('SELECT * FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0]
  assert.equal(shared.lesson_entries.filter(item => item.enrollment_id===enrollmentB && item.course_id===courseB && item.lesson_id===lessonNewEntry).length,1,'an exact-ID resync updates the existing entry without duplication')
  assert.equal(shared.lesson_entries.find(item => item.id===createdEntryId).progress_letter,'G')
  console.log('PASS: 1000171 allows a confirmed missing-entry remap, rechecks class-session access on apply, and blocks wrong/stale entry IDs without duplicates')

  // Attendance evidence: mapped admissions only, idempotent per date and class.
  const item = { enrollment_id: e1, source_admission_id: '6001', source_class_id: '11', evidence_date: '2026-10-10', attendance_count: 1, present_count: 1, absent_count: 0 }
  assert.equal((await evidenceRpc('record', { source_origin: origin, items: [item] })).items[0].attendance_count, 1)
  assert.equal((await evidenceRpc('record', { source_origin: origin, items: [{ ...item, attendance_count: 2, absent_count: 1 }] })).items[0].attendance_count, 2)
  assert.equal((await evidenceRpc('list', { enrollment_id: e1 })).items.filter(entry => entry.evidence_date === '2026-10-10').length, 1)
  await rejectsWith(evidenceRpc('record', { source_origin: origin, items: [{ ...item, source_admission_id: '6002', enrollment_id: e2 }] }), 'SOURCE_MAPPING_CONFLICT')
  await rejectsWith(evidenceRpc('record', { source_origin: origin, items: [{ ...item, html: 'x' }] }), 'INVALID_IMPORT')
  await assert.rejects(evidenceRpc('record', { source_origin: origin, items: [{ ...item, present_count: 2 }] }), /check constraint|violates/)
  console.log('PASS: 1000148 attendance evidence is mapped, bounded and idempotent')

  // The migration is rerunnable without new decisions.
  await db.exec(read('1000148_source_report_identity.sql'))
  assert.deepEqual((await conflictsRpc('list', {})).summary, report.summary)
  assert.equal((await rpc('capabilities', {})).attendance_evidence, true)
  console.log('PASS: 1000148 rerun is idempotent')

  const beforePrimarySyncRerun = (await db.query('SELECT id,class_occurrence_id,lesson_entries,primary_lesson_entry_id,source_report_id FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0]
  await db.exec(read('1000171_extension_primary_lesson_sync.sql'))
  assert.deepEqual((await db.query('SELECT id,class_occurrence_id,lesson_entries,primary_lesson_entry_id,source_report_id FROM public.occurrence_reports WHERE id=$1',[sharedReport])).rows[0],beforePrimarySyncRerun)
  console.log('PASS: 1000171 can be reapplied without changing report identity or lesson progress')
} catch (error) { console.error(error.stack, error.detail || '', error.where || '', error.position || ''); process.exitCode = 1 }
finally { await db.close() }
