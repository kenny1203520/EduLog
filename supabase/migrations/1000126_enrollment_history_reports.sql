BEGIN;
-- Durable teaching history is distinct from scheduled occurrence reports.
-- No placeholder occurrence, roster membership, transfer or report identity is inferred.
CREATE TABLE public.enrollment_history_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  enrollment_id uuid NOT NULL REFERENCES public.enrollments(id),
  report_date date NOT NULL,
  source_origin text NOT NULL CHECK(source_origin='https://corp.orangeapple.co'),
  source_admission_id text NOT NULL CHECK(source_admission_id ~ '^[0-9]+$'),
  source_report_id text CHECK(source_report_id ~ '^[0-9]+$'),
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 256),
  identity_status text NOT NULL CHECK(identity_status IN ('verified','evidence_only')),
  source_fields jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(source_fields)='array' AND octet_length(source_fields::text)<=64000),
  lesson_id uuid REFERENCES public.lessons(id), is_completed boolean, progress_letter text,
  attendance_status text CHECK(attendance_status IN ('present','absent','pending')),
  absence_reason text, class_participation numeric CHECK(class_participation BETWEEN 0 AND 5),
  classroom_behavior numeric CHECK(classroom_behavior BETWEEN 0 AND 5),
  content text, contact_notes text, class_notes text, external_link text,
  linked_report_id uuid REFERENCES public.occurrence_reports(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(enrollment_id,source_origin,source_admission_id,source_key)
);
CREATE INDEX enrollment_history_reports_date ON public.enrollment_history_reports(enrollment_id,report_date DESC,id);
ALTER TABLE public.enrollment_history_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_history_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.enrollment_history_reports TO authenticated;
GRANT ALL ON public.enrollment_history_reports TO service_role;
CREATE POLICY enrollment_history_read ON public.enrollment_history_reports FOR SELECT TO authenticated
  USING(public.can_access_enrollment(enrollment_id,'teaching.enrollments.read') AND public.can_access_enrollment(enrollment_id,'teaching.reports.read'));
ALTER TABLE public.web_extension_import_jobs ADD COLUMN report_session_ids uuid[];

CREATE FUNCTION public.validate_enrollment_history(p_data jsonb,p_row jsonb,p_job public.web_extension_import_jobs,p_batch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.enrollments; existing public.enrollment_history_reports;
BEGIN
  SELECT * INTO e FROM public.enrollments WHERE id=(p_data->>'enrollment_id')::uuid;
  IF e.id IS NULL THEN
    -- New enrollments must be created earlier in this same dependency-ordered batch.
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_batch->'rows') x WHERE x->'record'->>'kind'='enrollment' AND x->>'target_id'=p_data->>'enrollment_id') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF NOT public.has_api_permission(auth.uid(),'teaching.reports.create',p_job.classroom_id,p_job.class_session_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  ELSE
    IF NOT public.can_access_enrollment(e.id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(e.id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.enrollment_history_reports WHERE id=(p_row->>'target_id')::uuid) AND NOT public.can_access_enrollment(e.id,'teaching.reports.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF p_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(p_data->>'lesson_id')::uuid AND course_id=e.course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.web_extension_mapping_memory m WHERE m.user_id=auth.uid() AND m.source_origin=p_job.source_origin AND m.kind='admission' AND m.source_key=p_data->>'source_admission_id' AND m.target_id=e.id AND m.student_id=e.student_id AND m.course_id=e.course_id AND m.class_session_id=e.class_session_id)
      AND NOT EXISTS(SELECT 1 FROM public.web_extension_source_links l WHERE l.user_id=auth.uid() AND l.source_origin=p_job.source_origin AND l.source_kind='enrollment' AND l.source_id=p_data->>'source_admission_id' AND l.edulog_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_batch->'rows') x WHERE x->'record'->>'kind'='enrollment' AND x->>'target_id'=e.id::text AND x->>'source_id'=p_data->>'source_admission_id') THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
  END IF;
  IF p_data->>'source_origin' IS DISTINCT FROM p_job.source_origin OR (p_data->>'report_date')::date NOT BETWEEN p_job.date_from AND p_job.date_to
    OR jsonb_typeof(p_data->'source_fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'source_fields')>50
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'source_fields') f WHERE f->>'key' NOT IN ('attendance_status','absence_reason','lesson_id','progress_start','progress_end','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','sourceLessonLabel','progress_letter') OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('key','label','text')))
    OR (p_data->>'identity_status'='verified' AND (p_data->>'source_report_id' IS NULL OR p_data->>'external_link' IS DISTINCT FROM 'https://corp.orangeapple.co/dt_admissions/'||(p_data->>'source_admission_id')||'/reports/'||(p_data->>'source_report_id')||'/edit')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.enrollment_id=(p_data->>'enrollment_id')::uuid AND h.source_origin=p_data->>'source_origin' AND h.source_admission_id=p_data->>'source_admission_id' AND h.source_key=p_data->>'source_key' AND h.id<>(p_row->>'target_id')::uuid) THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
  SELECT * INTO existing FROM public.enrollment_history_reports WHERE id=(p_row->>'target_id')::uuid;
  IF existing.linked_report_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(p_data) d WHERE d.key NOT IN ('source_fields') AND to_jsonb(existing)->d.key IS DISTINCT FROM d.value) THEN RAISE EXCEPTION 'HISTORY_ALREADY_LINKED'; END IF;
  IF existing.id IS NULL AND p_data->>'identity_status'='evidence_only' AND NOT COALESCE((p_row->>'reviewed_duplicate')::boolean,false)
    AND EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.enrollment_id=(p_data->>'enrollment_id')::uuid AND h.source_admission_id=p_data->>'source_admission_id' AND h.report_date=(p_data->>'report_date')::date) THEN RAISE EXCEPTION 'HISTORY_IDENTITY_AMBIGUOUS'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_enrollment_history(jsonb,jsonb,public.web_extension_import_jobs,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.web_extension_target(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_table text; v_row jsonb;
BEGIN
  v_table := CASE p_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses'
    WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments'
    WHEN 'occurrence' THEN 'class_occurrences' WHEN 'report' THEN 'occurrence_reports' WHEN 'history_report' THEN 'enrollment_history_reports' END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',v_table) INTO v_row USING p_id;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_target(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.web_extension_row_permission(p_kind text,p_id uuid,p_current jsonb,p_job public.web_extension_import_jobs,p_action text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_permission text; v_session public.class_sessions; v_teaching uuid;
BEGIN
  SELECT * INTO v_session FROM public.class_sessions WHERE id=p_job.class_session_id;
  SELECT teaching_id INTO v_teaching FROM public.classrooms WHERE id=p_job.classroom_id;
  v_permission := 'teaching.' || CASE p_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses'
    WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments'
    WHEN 'occurrence' THEN 'occurrences' WHEN 'report' THEN 'reports' WHEN 'history_report' THEN 'reports' END || '.' || p_action;
  IF v_permission IS NULL OR v_teaching IS NULL THEN RETURN false; END IF;
  IF p_current IS NOT NULL THEN
    RETURN CASE p_kind
      WHEN 'student' THEN public.can_access_student(p_id,v_permission)
      WHEN 'course' THEN public.has_teaching_permission(auth.uid(),v_permission,(p_current->>'teaching_id')::uuid,NULL,NULL)
      WHEN 'class_session' THEN p_id=p_job.class_session_id AND public.can_access_class_session(p_id,v_permission)
      WHEN 'enrollment' THEN (p_current->>'class_session_id')::uuid=p_job.class_session_id AND public.can_access_enrollment(p_id,v_permission)
      WHEN 'occurrence' THEN (p_current->>'class_session_id')::uuid=p_job.class_session_id AND public.has_teaching_permission(auth.uid(),v_permission,v_teaching,p_job.classroom_id,p_job.class_session_id)
      WHEN 'history_report' THEN public.can_access_enrollment((p_current->>'enrollment_id')::uuid,'teaching.enrollments.read') AND public.can_access_enrollment((p_current->>'enrollment_id')::uuid,v_permission)
      WHEN 'report' THEN EXISTS(SELECT 1 FROM public.class_occurrences o WHERE o.id=(p_current->>'class_occurrence_id')::uuid AND o.class_session_id=ANY(COALESCE(p_job.report_session_ids,ARRAY[p_job.class_session_id])))
        AND CASE WHEN p_action='update' THEN public.can_mutate_occurrence_report(p_id,v_permission) ELSE public.can_access_report(p_id,v_permission) END
      ELSE false END;
  END IF;
  IF p_kind='history_report' THEN RETURN true; END IF;
  RETURN public.has_teaching_permission(auth.uid(),v_permission,v_teaching,
    CASE WHEN p_kind='course' THEN NULL ELSE p_job.classroom_id END,
    CASE WHEN p_kind='course' OR v_session.id IS NULL THEN NULL ELSE v_session.id END);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_row_permission(text,uuid,jsonb,public.web_extension_import_jobs,text) FROM PUBLIC,anon,authenticated,service_role;


-- Allow confirmed existing enrollments from another class to receive a report only
-- for an effective, date-scoped single-lesson transfer into the selected session.
-- The enrollment's student/course/session relationship remains immutable.

CREATE OR REPLACE FUNCTION public.web_extension_workspace(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_job public.web_extension_import_jobs; v_batch public.web_extension_import_batches;
  v_link public.web_extension_source_links; v_row jsonb; v_data jsonb; v_current jsonb; v_patch jsonb;
  v_kind text; v_id uuid; v_field text; v_table text; v_status text; v_version text; v_versions jsonb := '{}';
  v_classifications jsonb := '{}'; v_items jsonb := '[]'; v_item jsonb; v_before jsonb; v_counts jsonb := '{}'; v_count integer; v_report public.occurrence_reports;
  v_report_session uuid; v_teaching uuid; v_allowed text[]; v_offset integer := COALESCE((p_input->>'offset')::integer,0);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  -- Both forms are set because Supabase auth helpers support legacy claims too.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation='capabilities' THEN
    RETURN jsonb_build_object('workspace_version',1,'submission_confirmation',false,'all_classes_import',false,'multi_course_import',true,'mapping_memory',true,'transferred_occurrence_import',true,'enrollment_history_reports',true,'per_occurrence_report_routing',true);
  ELSIF p_operation='context' THEN
    RETURN jsonb_build_object('user_id',v_user,'offset',v_offset,'page_size',100,
      'classrooms',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,name FROM public.classrooms WHERE public.can_access_classroom(id,'teaching.classrooms.list') ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'courses',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,subject,stage,display_name FROM public.courses WHERE public.has_teaching_permission(v_user,'teaching.courses.list',teaching_id,NULL,NULL) ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'class_sessions',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,name,classroom_id,course_ids,start_time,end_time,start_date,day_of_week FROM public.class_sessions WHERE public.can_access_class_session(id,'teaching.class_sessions.list') ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'students',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,name FROM public.students WHERE public.can_access_student(id,'teaching.students.read') ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'enrollments',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,student_id,course_id,class_session_id,start_date,status FROM public.enrollments WHERE public.can_access_enrollment(id,'teaching.enrollments.read') ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'occurrences',COALESCE((SELECT jsonb_agg(t) FROM (SELECT o.id,o.class_session_id,o.occurrence_date FROM public.class_occurrences o WHERE public.can_access_class_session(o.class_session_id,'teaching.occurrences.read') ORDER BY o.id LIMIT 100 OFFSET v_offset) t),'[]'),
      'report_targets',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,enrollment_id,class_occurrence_id FROM public.occurrence_reports WHERE public.can_access_report(id,'teaching.reports.read') ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'lessons',COALESCE((SELECT jsonb_agg(t) FROM (SELECT l.id,l.course_id,l.title,l.sequence FROM public.lessons l JOIN public.courses c ON c.id=l.course_id WHERE public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL) ORDER BY l.id LIMIT 100 OFFSET v_offset) t),'[]'),
      'source_links',COALESCE((SELECT jsonb_agg(t) FROM (SELECT source_origin,source_kind,source_id,edulog_id FROM public.web_extension_source_links WHERE user_id=v_user ORDER BY id LIMIT 100 OFFSET v_offset) t),'[]'),
      'permissions',jsonb_build_object('course_create',public.has_api_permission(v_user,'teaching.courses.create',NULL,NULL),
        'classroom_scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'class_create',public.has_api_permission(v_user,'teaching.class_sessions.create',id,NULL),'student_create',public.has_api_permission(v_user,'teaching.students.create',id,NULL),'enrollment_create',public.has_api_permission(v_user,'teaching.enrollments.create',id,NULL),'occurrence_create',public.has_api_permission(v_user,'teaching.occurrences.create',id,NULL),'report_create',public.has_api_permission(v_user,'teaching.reports.create',id,NULL))) FROM public.classrooms WHERE public.can_access_classroom(id,'teaching.classrooms.list')),'[]'),
        'session_scopes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'student_create',public.has_api_permission(v_user,'teaching.students.create',NULL,id),'enrollment_create',public.has_api_permission(v_user,'teaching.enrollments.create',NULL,id),'occurrence_create',public.has_api_permission(v_user,'teaching.occurrences.create',NULL,id),'report_create',public.has_api_permission(v_user,'teaching.reports.create',NULL,id))) FROM public.class_sessions WHERE public.can_access_class_session(id,'teaching.class_sessions.list')),'[]')));
  ELSIF p_operation='reports' THEN
    RETURN jsonb_build_object('reports',COALESCE((SELECT jsonb_agg(t) FROM (
      SELECT r.id,r.enrollment_id,r.lesson_id,r.version,r.is_completed,r.progress_letter,r.attendance_status,r.absence_reason,r.class_participation,r.classroom_behavior,
        r.content,r.contact_notes,r.class_notes,r.updated_at,s.name AS student_name,c.display_name AS course_name,o.occurrence_date,
        e.student_id,e.course_id,o.class_session_id
      FROM public.occurrence_reports r JOIN public.enrollments e ON e.id=r.enrollment_id JOIN public.students s ON s.id=e.student_id
      JOIN public.courses c ON c.id=e.course_id JOIN public.class_occurrences o ON o.id=r.class_occurrence_id
      WHERE (p_input->>'report_id' IS NULL OR r.id=(p_input->>'report_id')::uuid) AND public.can_access_report(r.id,'teaching.reports.read') ORDER BY o.occurrence_date DESC,r.id LIMIT 100 OFFSET v_offset
    ) t),'[]'));
  ELSIF p_operation='work' THEN
    RETURN jsonb_build_object('imports',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,source_origin,source_class_id,status,counts,created_at,updated_at FROM public.web_extension_import_jobs WHERE user_id=v_user ORDER BY created_at DESC LIMIT 100) t),'[]'),
      'pushes',COALESCE((SELECT jsonb_agg(t) FROM (SELECT id,report_id,source_report_url,status,report_version,created_at FROM public.web_extension_report_pushes WHERE user_id=v_user ORDER BY created_at DESC LIMIT 100) t),'[]'));
  ELSIF p_operation='map' THEN
    v_kind:=p_input->>'source_kind'; v_id:=(p_input->>'target_id')::uuid;
    IF p_input->>'source_origin'<>'https://corp.orangeapple.co' OR length(p_input->>'source_id') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_current:=public.web_extension_target(v_kind,v_id);
    IF v_current IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF NOT (CASE v_kind WHEN 'report' THEN public.can_access_report(v_id,'teaching.reports.read') WHEN 'student' THEN public.can_access_student(v_id,'teaching.students.read') WHEN 'enrollment' THEN public.can_access_enrollment(v_id,'teaching.enrollments.read') WHEN 'class_session' THEN public.can_access_class_session(v_id,'teaching.class_sessions.read') WHEN 'course' THEN public.has_teaching_permission(v_user,'teaching.courses.read',(v_current->>'teaching_id')::uuid,NULL,NULL) ELSE false END) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id)
      VALUES(v_user,p_input->>'source_origin',v_kind,p_input->>'source_id',v_id)
      ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET edulog_id=EXCLUDED.edulog_id,updated_at=now(),target_version=NULL,source_fingerprint=NULL;
    RETURN jsonb_build_object('mapped',true);
  ELSIF p_operation='pending-push' THEN
    SELECT * INTO v_report FROM public.occurrence_reports WHERE id=(p_input->>'report_id')::uuid FOR SHARE;
    IF v_report.id IS NULL OR NOT public.can_access_report(v_report.id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_report.version<>(p_input->>'report_version')::integer THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF p_input->>'source_origin'<>'https://corp.orangeapple.co' OR p_input->>'source_report_url' !~ '^https://corp\.orangeapple\.co/dt_admissions/[0-9]+/reports/[0-9]+(/edit)?$' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    SELECT to_jsonb(t) INTO v_current FROM public.web_extension_report_pushes t WHERE user_id=v_user AND idempotency_key=p_input->>'idempotency_key';
    IF v_current IS NOT NULL AND (v_current->>'report_id' IS DISTINCT FROM p_input->>'report_id' OR v_current->>'target_fingerprint' IS DISTINCT FROM p_input->>'target_fingerprint') THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    INSERT INTO public.web_extension_report_pushes(user_id,report_id,source_origin,source_report_url,status,idempotency_key,report_version,source_id,target_fingerprint)
      VALUES(v_user,v_report.id,p_input->>'source_origin',p_input->>'source_report_url','pending_confirmation',p_input->>'idempotency_key',v_report.version,p_input->>'source_id',p_input->>'target_fingerprint') ON CONFLICT(user_id,idempotency_key) DO NOTHING;
    RETURN jsonb_build_object('status','pending_confirmation');
  ELSIF p_operation='job' THEN
    IF p_input->>'source_origin'<>'https://corp.orangeapple.co' OR (p_input->>'date_from')::date>(p_input->>'date_to')::date THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF NOT public.can_access_classroom((p_input->>'classroom_id')::uuid,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    INSERT INTO public.web_extension_import_jobs(user_id,source_origin,source_class_id,date_from,date_to,classroom_id,course_id,class_session_id,course_ids,report_session_ids)
      VALUES(v_user,p_input->>'source_origin',p_input->>'source_class_id',(p_input->>'date_from')::date,(p_input->>'date_to')::date,(p_input->>'classroom_id')::uuid,COALESCE((p_input->>'course_id')::uuid,(p_input->'course_ids'->>0)::uuid),(p_input->>'class_session_id')::uuid,CASE WHEN p_input ? 'course_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_input->'course_ids')::uuid) ELSE ARRAY[(p_input->>'course_id')::uuid] END,CASE WHEN p_input ? 'report_session_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_input->'report_session_ids')::uuid) END) RETURNING * INTO v_job;
    IF cardinality(v_job.course_ids) NOT BETWEEN 1 AND 10 OR v_job.course_ids IS NULL OR array_position(v_job.course_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF EXISTS(SELECT 1 FROM public.courses c JOIN public.classrooms r ON r.id=v_job.classroom_id WHERE c.id=ANY(v_job.course_ids) AND (c.teaching_id IS DISTINCT FROM r.teaching_id OR NOT public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL))) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_job.report_session_ids IS NOT NULL AND (cardinality(v_job.report_session_ids) NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM unnest(v_job.report_session_ids) s WHERE NOT public.can_access_class_session(s,'teaching.occurrences.read'))) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    RETURN jsonb_build_object('id',v_job.id,'status',v_job.status);
  END IF;
  SELECT * INTO v_job FROM public.web_extension_import_jobs WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user FOR UPDATE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public.can_access_classroom(v_job.classroom_id,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_operation='job-status' THEN
    IF v_job.status IN ('cancelled','complete') AND v_job.status<>p_input->>'status' THEN RAISE EXCEPTION 'JOB_STOPPED'; END IF;
    IF p_input->>'status' NOT IN ('paused','applying','cancelled','complete') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    UPDATE public.web_extension_import_jobs SET status=p_input->>'status',updated_at=now() WHERE id=v_job.id;
    RETURN jsonb_build_object('status',p_input->>'status');
  END IF;
  IF p_operation NOT IN ('preview','apply') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF EXISTS(SELECT 1 FROM public.class_sessions s WHERE s.id=v_job.class_session_id AND (s.classroom_id IS DISTINCT FROM v_job.classroom_id ))
    OR EXISTS(SELECT 1 FROM public.courses c JOIN public.classrooms r ON r.id=v_job.classroom_id WHERE c.id=ANY(COALESCE(v_job.course_ids,ARRAY[v_job.course_id])) AND c.teaching_id IS DISTINCT FROM r.teaching_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
  IF v_job.status IN ('cancelled','complete','paused') THEN RAISE EXCEPTION 'JOB_STOPPED'; END IF;
  IF jsonb_typeof(p_input->'rows')<>'array' OR jsonb_array_length(p_input->'rows') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  SELECT * INTO v_batch FROM public.web_extension_import_batches WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid FOR UPDATE;
  IF v_batch.status='applied' THEN
    IF v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
      v_kind:=v_row->'record'->>'kind';v_id:=(v_row->>'target_id')::uuid;v_current:=public.web_extension_target(v_kind,v_id);
      IF NOT public.web_extension_row_permission(v_kind,v_id,v_current,v_job,'read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    END LOOP;
    RETURN v_batch.result;
  END IF;
  IF p_operation='apply' AND (v_batch.batch_key IS NULL OR v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint') THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
    v_kind:=v_row->'record'->>'kind'; v_data:=v_row->'record'->'data'; v_id:=(v_row->>'target_id')::uuid;
    v_allowed:=CASE v_kind WHEN 'student' THEN ARRAY['name','external_link'] WHEN 'course' THEN ARRAY['subject','stage','display_name']
      WHEN 'class_session' THEN ARRAY['name','classroom_id','course_ids','start_date','day_of_week','start_time','end_time','time_zone','external_link']
      WHEN 'enrollment' THEN ARRAY['student_id','course_id','class_session_id','classroom_id','status','start_date','time_zone','external_link']
      WHEN 'occurrence' THEN ARRAY['class_session_id','occurrence_date','original_start_time','original_end_time','time_zone']
      WHEN 'report' THEN ARRAY['enrollment_id','class_occurrence_id','lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'] WHEN 'history_report' THEN ARRAY['enrollment_id','report_date','source_origin','source_admission_id','source_report_id','source_key','identity_status','source_fields','lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'] END;
    IF v_allowed IS NULL OR jsonb_typeof(v_data)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_data) k WHERE NOT k=ANY(v_allowed)) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    SELECT * INTO v_link FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_job.source_origin AND source_kind=v_kind AND source_id=v_row->>'source_id' FOR UPDATE;
    IF v_link.id IS NOT NULL AND v_link.edulog_id<>v_id THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    v_current:=public.web_extension_target(v_kind,v_id); v_version:=CASE WHEN v_current IS NULL THEN 'new' ELSE COALESCE(v_current->>'version',md5(v_current::text)) END;
    IF v_current IS NULL AND (v_kind='occurrence' AND EXISTS(SELECT 1 FROM public.class_occurrences WHERE class_session_id=(v_data->>'class_session_id')::uuid AND occurrence_date=(v_data->>'occurrence_date')::date)
      OR v_kind='report' AND EXISTS(SELECT 1 FROM public.occurrence_reports WHERE enrollment_id=(v_data->>'enrollment_id')::uuid AND class_occurrence_id=(v_data->>'class_occurrence_id')::uuid)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    v_versions:=v_versions||jsonb_build_object(v_kind||':'||(v_row->>'source_id'),v_version);
    IF p_operation='apply' AND v_batch.target_versions->>(v_kind||':'||(v_row->>'source_id')) IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
    IF NOT public.web_extension_row_permission(v_kind,v_id,v_current,v_job,CASE WHEN v_current IS NULL THEN 'create' ELSE 'read' END) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    -- Never transfer an existing entity to a different scope/identity.
    IF v_current IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(v_data) d WHERE d.key IN ('student_id','course_id','class_session_id','classroom_id','course_ids','enrollment_id','class_occurrence_id','report_date','source_origin','source_admission_id','source_report_id','source_key','identity_status') AND NOT (v_kind='class_session' AND d.key='course_ids') AND v_current->d.key IS DISTINCT FROM d.value) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF v_kind='enrollment' AND NOT (v_data->>'course_id')::uuid=ANY(COALESCE(v_job.course_ids,ARRAY[v_job.course_id])) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF v_kind='course' AND NOT v_id=ANY(COALESCE(v_job.course_ids,ARRAY[v_job.course_id])) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF v_kind='class_session' THEN
      IF NOT COALESCE(v_job.course_ids,ARRAY[v_job.course_id]) <@ ARRAY(SELECT jsonb_array_elements_text(v_data->'course_ids')::uuid) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF v_current IS NOT NULL AND NOT ARRAY(SELECT jsonb_array_elements_text(v_current->'course_ids')::uuid) <@ ARRAY(SELECT jsonb_array_elements_text(v_data->'course_ids')::uuid) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_data->'course_ids') i WHERE NOT EXISTS(SELECT 1 FROM public.courses c JOIN public.classrooms r ON r.id=v_job.classroom_id WHERE c.id=i::uuid AND c.teaching_id=r.teaching_id AND public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL)) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'rows') x WHERE x->'record'->>'kind'='course' AND x->>'target_id'=i)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    END IF;
    IF v_kind='enrollment' AND v_row->>'source_identity' IS NOT NULL AND EXISTS(SELECT 1 FROM public.web_extension_mapping_memory m WHERE m.user_id=v_user AND m.source_origin=v_job.source_origin AND m.kind='admission' AND m.source_key=v_row->>'source_id' AND m.source_identity IS DISTINCT FROM v_row->>'source_identity') THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    IF v_row ? 'source_rule' AND (v_kind<>'course' OR v_row->>'source_rule' NOT LIKE 'label:%' OR v_row->>'source_id' NOT LIKE 'work:%') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF v_row ? 'source_rule' AND EXISTS(SELECT 1 FROM public.web_extension_mapping_memory m WHERE m.user_id=v_user AND m.source_origin=v_job.source_origin AND m.kind='course_rule' AND m.source_key=v_row->>'source_rule' AND m.scope_key=v_job.source_class_id AND m.target_id<>v_id) THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    v_before:='{}'; v_patch:='{}';
    FOR v_field IN SELECT jsonb_object_keys(v_data) LOOP
      v_before:=v_before||jsonb_build_object(v_field,v_current->v_field);
      IF v_current IS NULL OR (v_current->v_field IS DISTINCT FROM v_data->v_field AND (v_row->'overwrite') ? v_field) THEN v_patch:=v_patch||jsonb_build_object(v_field,v_data->v_field); END IF;
    END LOOP;
    IF v_current IS NOT NULL AND ((v_kind='enrollment' AND (v_patch-'status'-'external_link')<>'{}')
      OR (v_kind='class_session' AND (v_patch-'name'-'external_link'-'course_ids')<>'{}') OR (v_kind='occurrence' AND v_patch<>'{}')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_status:=CASE WHEN v_current IS NULL THEN 'added' WHEN v_before=v_data THEN 'unchanged' WHEN v_patch<>'{}' THEN 'updated' ELSE 'conflict' END;
    IF v_status='updated' AND NOT public.web_extension_row_permission(v_kind,v_id,v_current,v_job,'update') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_kind='history_report' THEN
      PERFORM public.validate_enrollment_history(v_data,v_row,v_job,p_input);
    END IF;
    IF v_kind='report' THEN
      SELECT class_session_id INTO v_report_session FROM public.class_occurrences WHERE id=(v_data->>'class_occurrence_id')::uuid;
      v_report_session:=COALESCE(v_report_session,v_job.class_session_id);
      IF NOT v_report_session=ANY(COALESCE(v_job.report_session_ids,ARRAY[v_job.class_session_id])) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF EXISTS(SELECT 1 FROM public.class_sessions WHERE id=v_report_session) THEN
        IF NOT public.can_access_class_session(v_report_session,'teaching.occurrences.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'rows') x WHERE x->'record'->>'kind'='class_session' AND (x->>'target_id')::uuid=v_report_session AND public.web_extension_row_permission('class_session',v_report_session,NULL,v_job,'create')) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.class_occurrences o WHERE o.id=(v_data->>'class_occurrence_id')::uuid AND o.class_session_id=v_report_session AND o.occurrence_date BETWEEN v_job.date_from AND v_job.date_to)
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'rows') x WHERE x->'record'->>'kind'='occurrence' AND (x->>'target_id')::uuid=(v_data->>'class_occurrence_id')::uuid AND x->'record'->'data'->>'class_session_id'=v_report_session::text AND (x->'record'->'data'->>'occurrence_date')::date BETWEEN v_job.date_from AND v_job.date_to) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF EXISTS(SELECT 1 FROM public.enrollments e WHERE e.id=(v_data->>'enrollment_id')::uuid) THEN
        IF NOT public.can_access_enrollment((v_data->>'enrollment_id')::uuid,'teaching.enrollments.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
        IF NOT EXISTS(
          SELECT 1 FROM public.class_occurrences o JOIN public.enrollments e ON e.id=(v_data->>'enrollment_id')::uuid
          WHERE o.id=(v_data->>'class_occurrence_id')::uuid AND o.class_session_id=v_report_session
            AND e.status='regular' AND e.start_date<=o.occurrence_date
            AND e.course_id=ANY(COALESCE(v_job.course_ids,ARRAY[v_job.course_id]))
            AND EXISTS(SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(o.id) eligible WHERE eligible.enrollment_id=e.id)
            AND (e.class_session_id=v_report_session OR EXISTS(
              SELECT 1 FROM public.single_lesson_transfers t JOIN public.class_occurrences source_occurrence ON source_occurrence.id=t.source_occurrence_id
              WHERE t.enrollment_id=e.id AND t.target_occurrence_id=o.id AND t.cancelled_at IS NULL
                AND source_occurrence.class_session_id=e.class_session_id
                AND NOT EXISTS(SELECT 1 FROM public.single_lesson_transfers onward WHERE onward.enrollment_id=e.id AND onward.source_occurrence_id=t.target_occurrence_id AND onward.cancelled_at IS NULL)
            ))
        ) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.enrollments e ON e.id=(v_data->>'enrollment_id')::uuid WHERE l.id=(v_data->>'lesson_id')::uuid AND l.course_id=e.course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      ELSE
        IF NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(p_input->'rows') x
          WHERE x->'record'->>'kind'='enrollment' AND (x->>'target_id')::uuid=(v_data->>'enrollment_id')::uuid
            AND x->'record'->'data'->>'class_session_id'=v_report_session::text
            AND (x->'record'->'data'->>'course_id')::uuid=ANY(COALESCE(v_job.course_ids,ARRAY[v_job.course_id]))
            AND x->'record'->'data'->>'status'='regular'
            AND (x->'record'->'data'->>'start_date')::date<=COALESCE((SELECT occurrence_date FROM public.class_occurrences WHERE id=(v_data->>'class_occurrence_id')::uuid),(SELECT (y->'record'->'data'->>'occurrence_date')::date FROM jsonb_array_elements(p_input->'rows') y WHERE y->'record'->>'kind'='occurrence' AND (y->>'target_id')::uuid=(v_data->>'class_occurrence_id')::uuid LIMIT 1))
            AND (v_data->>'lesson_id' IS NULL OR EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=(v_data->>'lesson_id')::uuid AND l.course_id=(x->'record'->'data'->>'course_id')::uuid))
        ) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      END IF;
    END IF;
    IF p_operation='apply' AND v_status IN ('added','updated') THEN
      SELECT teaching_id INTO v_teaching FROM public.classrooms WHERE id=v_job.classroom_id;
      IF v_kind='student' THEN
        IF v_current IS NULL THEN INSERT INTO public.students(id,name,external_link,user_id) VALUES(v_id,v_data->>'name',v_data->>'external_link',v_user);
        ELSE UPDATE public.students SET name=COALESCE(v_patch->>'name',name),external_link=COALESCE(v_patch->>'external_link',external_link) WHERE id=v_id; END IF;
      ELSIF v_kind='course' THEN
        IF v_current IS NULL THEN INSERT INTO public.courses(id,subject,stage,display_name,user_id,teaching_id) VALUES(v_id,v_data->>'subject',v_data->>'stage',v_data->>'display_name',v_user,v_teaching);
        ELSE UPDATE public.courses SET subject=COALESCE(v_patch->>'subject',subject),stage=COALESCE(v_patch->>'stage',stage),display_name=COALESCE(v_patch->>'display_name',display_name) WHERE id=v_id; END IF;
      ELSIF v_kind='class_session' THEN
        IF v_id<>v_job.class_session_id OR (v_data->>'classroom_id')::uuid<>v_job.classroom_id OR NOT v_job.course_id=ANY(ARRAY(SELECT jsonb_array_elements_text(v_data->'course_ids')::uuid)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_current IS NULL THEN
          IF NOT EXISTS(SELECT 1 FROM public.courses WHERE id=v_job.course_id AND teaching_id=v_teaching) OR (v_data->>'start_time')::time>=(v_data->>'end_time')::time THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
          INSERT INTO public.class_sessions(id,name,classroom_id,course_ids,start_date,day_of_week,start_time,end_time,time_zone,user_id,teaching_id,session_type,schedule_mode)
            VALUES(v_id,v_data->>'name',v_job.classroom_id,ARRAY(SELECT jsonb_array_elements_text(v_data->'course_ids')::uuid),(v_data->>'start_date')::date,(v_data->>'day_of_week')::integer,(v_data->>'start_time')::time,(v_data->>'end_time')::time,'Asia/Taipei',v_user,v_teaching,'regular','weekly');
          INSERT INTO public.class_session_schedule_rules(class_session_id,schedule_kind,day_of_week,start_time,end_time) VALUES(v_id,'weekly',(v_data->>'day_of_week')::integer,(v_data->>'start_time')::time,(v_data->>'end_time')::time);
        ELSE
          -- Changing schedules requires the native class-session workflow.
          IF (v_patch - 'name' - 'external_link' - 'course_ids')<>'{}' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
          UPDATE public.class_sessions SET name=COALESCE(v_patch->>'name',name),external_link=COALESCE(v_patch->>'external_link',external_link),course_ids=CASE WHEN v_patch ? 'course_ids' THEN ARRAY(SELECT jsonb_array_elements_text(v_patch->'course_ids')::uuid) ELSE course_ids END WHERE id=v_id;
        END IF;
      ELSIF v_kind='enrollment' THEN
        IF (v_data->>'class_session_id')::uuid<>v_job.class_session_id OR (v_data->>'classroom_id')::uuid<>v_job.classroom_id
          OR NOT EXISTS(SELECT 1 FROM public.class_sessions s JOIN public.courses c ON c.id=(v_data->>'course_id')::uuid WHERE s.id=v_job.class_session_id AND s.classroom_id=v_job.classroom_id AND c.id=ANY(s.course_ids) AND c.teaching_id=v_teaching)
          OR NOT public.can_access_enrollment_scope((v_data->>'student_id')::uuid,(v_data->>'course_id')::uuid,v_job.classroom_id,v_job.class_session_id,'teaching.enrollments.create') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_current IS NULL THEN INSERT INTO public.enrollments(id,student_id,course_id,class_session_id,classroom_id,status,start_date,time_zone,external_link,user_id)
          VALUES(v_id,(v_data->>'student_id')::uuid,(v_data->>'course_id')::uuid,v_job.class_session_id,v_job.classroom_id,v_data->>'status',(v_data->>'start_date')::date,'Asia/Taipei',v_data->>'external_link',v_user);
        ELSE UPDATE public.enrollments SET status=COALESCE(v_patch->>'status',status),external_link=COALESCE(v_patch->>'external_link',external_link) WHERE id=v_id; END IF;
      ELSIF v_kind='occurrence' THEN
        IF (v_data->>'class_session_id')::uuid<>v_job.class_session_id OR (v_data->>'occurrence_date')::date NOT BETWEEN v_job.date_from AND v_job.date_to THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
        IF v_current IS NULL THEN INSERT INTO public.class_occurrences(id,class_session_id,occurrence_date,original_start_time,original_end_time,time_zone,status)
          VALUES(v_id,v_job.class_session_id,(v_data->>'occurrence_date')::date,(v_data->>'original_start_time')::time,(v_data->>'original_end_time')::time,'Asia/Taipei','scheduled');
        ELSE IF v_patch<>'{}' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF; END IF;
      ELSIF v_kind='history_report' THEN
        IF v_current IS NULL THEN
          INSERT INTO public.enrollment_history_reports SELECT (jsonb_populate_record(NULL::public.enrollment_history_reports,v_data||jsonb_build_object('id',v_id,'user_id',v_user,'version',1,'created_at',now(),'updated_at',now()))).*;
        ELSE
          v_patch:=v_patch||jsonb_build_object('version',(v_current->>'version')::integer+1,'updated_at',now());
          UPDATE public.enrollment_history_reports h SET (lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,content,contact_notes,class_notes,external_link,source_fields,version,updated_at)=(SELECT x.lesson_id,x.is_completed,x.progress_letter,x.attendance_status,x.absence_reason,x.class_participation,x.classroom_behavior,x.content,x.contact_notes,x.class_notes,x.external_link,x.source_fields,x.version,x.updated_at FROM jsonb_populate_record(h,v_patch) x) WHERE h.id=v_id;
        END IF;
      ELSIF v_kind='report' THEN
        
        IF v_current IS NULL THEN
          IF NOT public.can_create_occurrence_report((v_data->>'enrollment_id')::uuid,(v_data->>'class_occurrence_id')::uuid) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
          INSERT INTO public.occurrence_reports(id,enrollment_id,class_occurrence_id,content,version,attendance_status,absence_reason)
            SELECT v_id,(v_data->>'enrollment_id')::uuid,o.id,'',1,a.attendance_status,a.absence_reason FROM public.class_occurrences o
            CROSS JOIN LATERAL public.get_effective_attendance((v_data->>'enrollment_id')::uuid,o.id,false) a WHERE o.id=(v_data->>'class_occurrence_id')::uuid;
          v_version:='1';
        END IF;
        v_patch:=v_patch-'enrollment_id'-'class_occurrence_id';
        IF v_patch ? 'content' THEN v_patch:=v_patch||jsonb_build_object('content_document',NULL); END IF;
        IF v_patch ? 'contact_notes' THEN v_patch:=v_patch||jsonb_build_object('contact_notes_document',NULL); END IF;
        IF v_patch ? 'class_notes' THEN v_patch:=v_patch||jsonb_build_object('class_notes_document',NULL); END IF;
        IF v_patch<>'{}' THEN PERFORM public.apply_occurrence_report_lifecycle(v_id,v_version::integer,v_patch,v_user,'update'); END IF;
      END IF;
    END IF;
    v_item:=jsonb_build_object('kind',v_kind,'source_id',v_row->>'source_id','target_id',v_id,'status',v_status,'before',v_before,'after',v_data);
    v_classifications:=jsonb_set(v_classifications,ARRAY[v_kind],COALESCE(v_classifications->v_kind,'{}')||jsonb_build_object(v_status,COALESCE((v_classifications->v_kind->>v_status)::integer,0)+1));
    v_items:=v_items||jsonb_build_array(v_item);
    v_count:=COALESCE((v_counts->>v_status)::integer,0)+1; v_counts:=jsonb_set(v_counts,ARRAY[v_status],to_jsonb(v_count));
    IF p_operation='apply' AND NOT (v_row ? 'source_rule') AND v_kind<>'history_report' THEN
      v_current:=public.web_extension_target(v_kind,v_id);
      INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id,source_fingerprint,target_version)
        VALUES(v_user,v_job.source_origin,v_kind,v_row->>'source_id',v_id,COALESCE(v_row->>'source_fingerprint',p_input->>'fingerprint'),COALESCE(v_current->>'version',v_current->>'updated_at'))
        ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,target_version=EXCLUDED.target_version,updated_at=now();
    END IF;
    IF p_operation='apply' AND v_row ? 'source_rule' THEN
      INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,scope_key,source_class_id,target_id)
        VALUES(v_user,v_job.source_origin,'course_rule',v_row->>'source_rule',v_job.source_class_id,v_job.source_class_id,v_id)
        ON CONFLICT(user_id,source_origin,kind,source_key,scope_key) DO UPDATE SET target_id=EXCLUDED.target_id,revision=gen_random_uuid(),updated_at=now();
    END IF;
    IF p_operation='apply' AND v_kind='enrollment' AND v_row->>'source_identity' IS NOT NULL THEN
      INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,source_class_id,source_identity,target_id,student_id,course_id,class_session_id)
        VALUES(v_user,v_job.source_origin,'admission',v_row->>'source_id',v_job.source_class_id,v_row->>'source_identity',v_id,(v_data->>'student_id')::uuid,(v_data->>'course_id')::uuid,v_job.class_session_id)
        ON CONFLICT(user_id,source_origin,kind,source_key,scope_key) DO UPDATE SET target_id=EXCLUDED.target_id,student_id=EXCLUDED.student_id,course_id=EXCLUDED.course_id,class_session_id=EXCLUDED.class_session_id,source_identity=EXCLUDED.source_identity,revision=gen_random_uuid(),updated_at=now();
    END IF;
    IF p_operation='apply' AND v_kind='class_session' THEN
      INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,source_class_id,target_id)
        VALUES(v_user,v_job.source_origin,'classroom',v_job.source_class_id,v_job.source_class_id,v_job.classroom_id)
        ON CONFLICT(user_id,source_origin,kind,source_key,scope_key) DO UPDATE SET target_id=EXCLUDED.target_id,revision=gen_random_uuid(),updated_at=now();
    END IF;
  END LOOP;
  IF p_operation='preview' THEN
    INSERT INTO public.web_extension_import_batches(job_id,batch_key,fingerprint,target_versions,status) VALUES(v_job.id,(p_input->>'key')::uuid,p_input->>'fingerprint',v_versions,'previewed')
      ON CONFLICT(job_id,batch_key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,target_versions=EXCLUDED.target_versions,status='previewed';
    UPDATE public.web_extension_import_jobs SET status='previewed',updated_at=now() WHERE id=v_job.id;
    RETURN jsonb_build_object('rows',v_items,'counts',v_counts);
  END IF;
  -- Results contain identity and counts only, never source/target field values.
  v_item:=jsonb_build_object('key',p_input->>'key','classifications',v_classifications,'counts',v_counts,'applied',jsonb_array_length(p_input->'rows'));
  UPDATE public.web_extension_import_batches SET status='applied',result=v_item WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;
  UPDATE public.web_extension_import_jobs SET status='applying',counts=jsonb_build_object('applied',COALESCE((counts->>'applied')::integer,0)+jsonb_array_length(p_input->'rows')),updated_at=now() WHERE id=v_job.id;
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.web_extension_import_info(
  p_token_id uuid, p_token_hash text, p_operation text, p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_job public.web_extension_import_jobs; v_date date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_operation <> 'info' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  SELECT * INTO v_job FROM public.web_extension_import_jobs
    WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT public.can_access_classroom(v_job.classroom_id,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_date := COALESCE((p_input->>'roster_date')::date, (now() AT TIME ZONE 'Asia/Taipei')::date);

  RETURN jsonb_build_object(
    'job', jsonb_build_object('id',v_job.id,'status',v_job.status,'source_class_id',v_job.source_class_id,
      'classroom_id',v_job.classroom_id,'class_session_id',v_job.class_session_id,
      'created_at',v_job.created_at,'updated_at',v_job.updated_at,'counts',v_job.counts),
    'batches', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',b.batch_key,'status',b.status,
      'applied',COALESCE((b.result->>'applied')::integer,0),'classifications',COALESCE(b.result->'classifications','{}'::jsonb),'counts',COALESCE(b.result->'counts','{}'::jsonb)) ORDER BY b.created_at,b.batch_key)
      FROM public.web_extension_import_batches b WHERE b.job_id=v_job.id),'[]'::jsonb),
    'roster_date',v_date,
    'roster', public.get_class_session_workspace(v_job.class_session_id,v_date)
  );
END $$;


CREATE TABLE public.enrollment_history_bindings (
 user_id uuid NOT NULL REFERENCES auth.users(id), operation_key uuid NOT NULL,
 fingerprint text NOT NULL, preview jsonb NOT NULL, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,operation_key)
);
ALTER TABLE public.enrollment_history_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.enrollment_history_bindings FROM PUBLIC,anon,authenticated,service_role;

-- Authenticated main-site and limited-extension callers share this permission boundary.
CREATE FUNCTION public.enrollment_history_access(p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE h public.enrollment_history_reports; o public.class_occurrences; r public.occurrence_reports;
 b public.enrollment_history_bindings; v_items jsonb:='[]'; v_rows jsonb:='[]'; v_patch jsonb; v_conflicts jsonb;
 v_row jsonb; v_context jsonb; v_id uuid; v_limit integer:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
 v_cursor date; v_cursor_id uuid; v_fingerprint text; v_report uuid; v_version integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF p_operation IN ('list','detail') THEN
   IF p_operation='detail' THEN
     SELECT * INTO h FROM public.enrollment_history_reports WHERE id=(p_input->>'id')::uuid;
     IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
     IF NOT public.can_access_enrollment(h.enrollment_id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(h.enrollment_id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
     RETURN to_jsonb(h)-'user_id';
   END IF;
   IF p_input->>'enrollment_id' IS NULL AND p_input->>'student_id' IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
   IF p_input->>'cursor' IS NOT NULL THEN
     v_cursor:=split_part(p_input->>'cursor','|',1)::date; v_cursor_id:=split_part(p_input->>'cursor','|',2)::uuid;
   END IF;
   SELECT COALESCE(jsonb_agg(x.row ORDER BY x.report_date DESC,x.id DESC),'[]') INTO v_items FROM (
     SELECT h.id,h.report_date,(to_jsonb(h)-'user_id')||jsonb_build_object('kind','history_report','template_only',true,'student_id',e.student_id,'student_name',s.name,'course_id',e.course_id,'course_name',COALESCE(c.display_name,c.subject),'class_name',cs.name) row
     FROM public.enrollment_history_reports h JOIN public.enrollments e ON e.id=h.enrollment_id JOIN public.students s ON s.id=e.student_id JOIN public.courses c ON c.id=e.course_id JOIN public.class_sessions cs ON cs.id=e.class_session_id
     WHERE (p_input->>'enrollment_id' IS NULL OR h.enrollment_id=(p_input->>'enrollment_id')::uuid)
       AND (p_input->>'student_id' IS NULL OR e.student_id=(p_input->>'student_id')::uuid)
       AND (p_input->>'course_id' IS NULL OR e.course_id=(p_input->>'course_id')::uuid)
       AND (NOT COALESCE((p_input->>'unlinked_only')::boolean,false) OR h.linked_report_id IS NULL)
       AND (p_input->>'source_admission_id' IS NULL OR h.source_admission_id=p_input->>'source_admission_id')
       AND (p_input->>'date_from' IS NULL OR h.report_date>=(p_input->>'date_from')::date)
       AND (p_input->>'date_to' IS NULL OR h.report_date<=(p_input->>'date_to')::date)
       AND (v_cursor IS NULL OR (h.report_date,h.id)<(v_cursor,v_cursor_id))
       AND public.can_access_enrollment(e.id,'teaching.enrollments.read') AND public.can_access_enrollment(e.id,'teaching.reports.read')
       AND public.can_access_student(e.student_id,'teaching.students.read') AND public.can_access_class_session(cs.id,'teaching.class_sessions.read')
     ORDER BY h.report_date DESC,h.id DESC LIMIT v_limit+1
   ) x;
   RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-(v_limit) ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN (v_items->(v_limit-1)->>'report_date')||'|'||(v_items->(v_limit-1)->>'id') END);
 END IF;
 SELECT * INTO h FROM public.enrollment_history_reports WHERE id=(p_input->>'history_id')::uuid FOR UPDATE;
 IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT public.can_access_enrollment(h.enrollment_id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(h.enrollment_id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF p_operation='candidates' THEN
   SELECT COALESCE(jsonb_agg(x.row ORDER BY x.id),'[]') INTO v_items FROM (
    SELECT o.id,jsonb_build_object('id',o.id,'class_session_id',o.class_session_id,'occurrence_date',o.occurrence_date,'class_name',s.name,'start_time',o.original_start_time,'end_time',o.original_end_time) row
    FROM public.class_occurrences o JOIN public.class_sessions s ON s.id=o.class_session_id
    WHERE o.occurrence_date=h.report_date AND o.status<>'cancelled' AND public.can_access_class_session(s.id,'teaching.occurrences.read')
      AND EXISTS(SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(o.id) e WHERE e.enrollment_id=h.enrollment_id)
      AND (p_input->>'cursor' IS NULL OR o.id>(p_input->>'cursor')::uuid)
    ORDER BY o.id LIMIT v_limit+1
   ) x;
   RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
 END IF;
 IF p_operation NOT IN ('bind-preview','bind-apply') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
 -- Replay checks precede mutable version checks. A lost response can safely be recovered.
 v_fingerprint:=md5(p_input::text);
 SELECT * INTO b FROM public.enrollment_history_bindings WHERE user_id=auth.uid() AND operation_key=(p_input->>'key')::uuid FOR UPDATE;
 IF b.operation_key IS NOT NULL AND b.fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 IF b.result IS NOT NULL THEN RETURN b.result; END IF;
 SELECT * INTO o FROM public.class_occurrences WHERE id=(p_input->>'class_occurrence_id')::uuid FOR UPDATE;
 IF o.id IS NULL OR o.occurrence_date<>h.report_date OR o.status='cancelled'
   OR NOT EXISTS(SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(o.id) e WHERE e.enrollment_id=h.enrollment_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
 IF NOT public.can_access_class_session(o.class_session_id,'teaching.occurrences.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF h.version<>(p_input->>'history_version')::integer THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 SELECT * INTO r FROM public.occurrence_reports WHERE enrollment_id=h.enrollment_id AND class_occurrence_id=o.id FOR UPDATE;
 IF h.linked_report_id IS NOT NULL AND h.linked_report_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'HISTORY_ALREADY_LINKED'; END IF;
 IF r.id IS NULL THEN
   IF NOT public.can_create_occurrence_report(h.enrollment_id,o.id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 ELSE
   IF NOT public.can_access_report(r.id,'teaching.reports.read') OR NOT public.can_mutate_occurrence_report(r.id,'teaching.reports.update') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 END IF;
 v_patch:='{}';v_conflicts:='[]';
 FOR v_row IN SELECT jsonb_build_object('key',k,'value',to_jsonb(h)->k) FROM unnest(ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']) k LOOP
   IF v_row->'value'<>'null'::jsonb AND (r.id IS NULL OR to_jsonb(r)->(v_row->>'key') IS DISTINCT FROM v_row->'value') THEN
     IF r.id IS NOT NULL AND to_jsonb(r)->(v_row->>'key')<>'null'::jsonb AND to_jsonb(r)->>(v_row->>'key')<>'' THEN
       v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('field',v_row->>'key','before',to_jsonb(r)->(v_row->>'key'),'after',v_row->'value'));
       IF NOT COALESCE(p_input->'overwrite','[]') ? (v_row->>'key') THEN CONTINUE; END IF;
     END IF;
     IF v_row->>'key'='class_notes' AND NOT COALESCE((p_input->>'include_internal')::boolean,false) THEN CONTINUE; END IF;
     v_patch:=v_patch||jsonb_build_object(v_row->>'key',v_row->'value');
   END IF;
 END LOOP;
 v_context:=jsonb_build_object('history_version',h.version,'report_id',r.id,'report_version',r.version,'occurrence',to_jsonb(o),'enrollment',public.web_extension_target('enrollment',h.enrollment_id),'patch',v_patch,'conflicts',v_conflicts);
 IF p_operation='bind-preview' THEN
   INSERT INTO public.enrollment_history_bindings(user_id,operation_key,fingerprint,preview) VALUES(auth.uid(),(p_input->>'key')::uuid,v_fingerprint,v_context)
    ON CONFLICT(user_id,operation_key) DO UPDATE SET preview=EXCLUDED.preview;
   RETURN v_context;
 END IF;
 IF b.operation_key IS NULL OR b.preview IS DISTINCT FROM v_context THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
 IF r.id IS NULL THEN
   INSERT INTO public.occurrence_reports(enrollment_id,class_occurrence_id,content,version) VALUES(h.enrollment_id,o.id,'',1) RETURNING * INTO r;
 END IF;
 IF v_patch ? 'content' THEN v_patch:=v_patch||jsonb_build_object('content_document',NULL); END IF;
 IF v_patch ? 'contact_notes' THEN v_patch:=v_patch||jsonb_build_object('contact_notes_document',NULL); END IF;
 IF v_patch ? 'class_notes' THEN v_patch:=v_patch||jsonb_build_object('class_notes_document',NULL); END IF;
 IF v_patch<>'{}' THEN PERFORM public.apply_occurrence_report_lifecycle(r.id,r.version,v_patch,auth.uid(),'update'); END IF;
 UPDATE public.enrollment_history_reports SET linked_report_id=r.id,version=version+1,updated_at=now() WHERE id=h.id;
 v_context:=jsonb_build_object('history_id',h.id,'report_id',r.id,'status','linked','preserved_fields',v_conflicts);
 UPDATE public.enrollment_history_bindings SET result=v_context WHERE user_id=auth.uid() AND operation_key=(p_input->>'key')::uuid;
 RETURN v_context;
END $$;
REVOKE ALL ON FUNCTION public.enrollment_history_access(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enrollment_history_access(text,jsonb) TO authenticated;

CREATE FUNCTION public.web_extension_history(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
 SELECT user_id INTO v_user FROM public.web_extension_tokens WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',v_user::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 RETURN public.enrollment_history_access(p_operation,p_input);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_history(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_history(uuid,text,text,jsonb) TO service_role;

COMMIT;
