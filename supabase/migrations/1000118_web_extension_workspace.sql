-- Trusted integration boundary. Only metadata/checkpoints are persisted;
-- validated source payloads exist solely in the calling transaction.
BEGIN;
ALTER TABLE public.web_extension_import_jobs DROP CONSTRAINT web_extension_import_jobs_status_check;
ALTER TABLE public.web_extension_import_jobs ADD CONSTRAINT web_extension_import_jobs_status_check CHECK(status IN ('pending','previewed','applying','paused','complete','failed','cancelled'));
ALTER TABLE public.web_extension_import_jobs ADD COLUMN source_class_id text, ADD COLUMN classroom_id uuid, ADD COLUMN course_id uuid, ADD COLUMN class_session_id uuid;
ALTER TABLE public.web_extension_source_links ADD COLUMN target_version text;
ALTER TABLE public.web_extension_report_pushes ADD COLUMN report_version integer, ADD COLUMN source_id text, ADD COLUMN target_fingerprint text;
CREATE TABLE public.web_extension_import_batches (
  job_id uuid NOT NULL REFERENCES public.web_extension_import_jobs(id) ON DELETE CASCADE,
  batch_key uuid NOT NULL, fingerprint text NOT NULL, target_versions jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('previewed','applied')),
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,batch_key)
);
ALTER TABLE public.web_extension_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_extension_import_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.web_extension_import_batches TO service_role;

-- Not granted to any client role. The outer RPC has already switched JWT claims
-- from service_role to the credential's user before invoking permission helpers.
CREATE FUNCTION public.web_extension_target(p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_table text; v_row jsonb;
BEGIN
  v_table := CASE p_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses'
    WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments'
    WHEN 'occurrence' THEN 'class_occurrences' WHEN 'report' THEN 'occurrence_reports' END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',v_table) INTO v_row USING p_id;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_target(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_row_permission(p_kind text,p_id uuid,p_current jsonb,p_job public.web_extension_import_jobs,p_action text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_permission text; v_session public.class_sessions; v_teaching uuid;
BEGIN
  SELECT * INTO v_session FROM public.class_sessions WHERE id=p_job.class_session_id;
  SELECT teaching_id INTO v_teaching FROM public.classrooms WHERE id=p_job.classroom_id;
  v_permission := 'teaching.' || CASE p_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses'
    WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments'
    WHEN 'occurrence' THEN 'occurrences' WHEN 'report' THEN 'reports' END || '.' || p_action;
  IF v_permission IS NULL OR v_teaching IS NULL THEN RETURN false; END IF;
  IF p_current IS NOT NULL THEN
    RETURN CASE p_kind
      WHEN 'student' THEN public.can_access_student(p_id,v_permission)
      WHEN 'course' THEN public.has_teaching_permission(auth.uid(),v_permission,(p_current->>'teaching_id')::uuid,NULL,NULL)
      WHEN 'class_session' THEN p_id=p_job.class_session_id AND public.can_access_class_session(p_id,v_permission)
      WHEN 'enrollment' THEN (p_current->>'class_session_id')::uuid=p_job.class_session_id AND public.can_access_enrollment(p_id,v_permission)
      WHEN 'occurrence' THEN (p_current->>'class_session_id')::uuid=p_job.class_session_id AND public.has_teaching_permission(auth.uid(),v_permission,v_teaching,p_job.classroom_id,p_job.class_session_id)
      WHEN 'report' THEN EXISTS(SELECT 1 FROM public.class_occurrences o WHERE o.id=(p_current->>'class_occurrence_id')::uuid AND o.class_session_id=p_job.class_session_id)
        AND CASE WHEN p_action='update' THEN public.can_mutate_occurrence_report(p_id,v_permission) ELSE public.can_access_report(p_id,v_permission) END
      ELSE false END;
  END IF;
  RETURN public.has_teaching_permission(auth.uid(),v_permission,v_teaching,
    CASE WHEN p_kind='course' THEN NULL ELSE p_job.classroom_id END,
    CASE WHEN p_kind='course' OR v_session.id IS NULL THEN NULL ELSE v_session.id END);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_row_permission(text,uuid,jsonb,public.web_extension_import_jobs,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_workspace(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_job public.web_extension_import_jobs; v_batch public.web_extension_import_batches;
  v_link public.web_extension_source_links; v_row jsonb; v_data jsonb; v_current jsonb; v_patch jsonb;
  v_kind text; v_id uuid; v_field text; v_table text; v_status text; v_version text; v_versions jsonb := '{}';
  v_items jsonb := '[]'; v_item jsonb; v_before jsonb; v_counts jsonb := '{}'; v_count integer; v_report public.occurrence_reports;
  v_teaching uuid; v_allowed text[]; v_offset integer := COALESCE((p_input->>'offset')::integer,0);
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
    RETURN jsonb_build_object('workspace_version',1,'submission_confirmation',false,'all_classes_import',false);
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
    INSERT INTO public.web_extension_import_jobs(user_id,source_origin,source_class_id,date_from,date_to,classroom_id,course_id,class_session_id)
      VALUES(v_user,p_input->>'source_origin',p_input->>'source_class_id',(p_input->>'date_from')::date,(p_input->>'date_to')::date,(p_input->>'classroom_id')::uuid,(p_input->>'course_id')::uuid,(p_input->>'class_session_id')::uuid) RETURNING * INTO v_job;
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
  IF EXISTS(SELECT 1 FROM public.class_sessions s WHERE s.id=v_job.class_session_id AND (s.classroom_id IS DISTINCT FROM v_job.classroom_id OR NOT v_job.course_id=ANY(s.course_ids)))
    OR EXISTS(SELECT 1 FROM public.courses c JOIN public.classrooms r ON r.id=v_job.classroom_id WHERE c.id=v_job.course_id AND c.teaching_id IS DISTINCT FROM r.teaching_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
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
      WHEN 'report' THEN ARRAY['enrollment_id','class_occurrence_id','lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'] END;
    IF v_allowed IS NULL OR jsonb_typeof(v_data)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_data) k WHERE NOT k=ANY(v_allowed)) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    SELECT * INTO v_link FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_job.source_origin AND source_kind=v_kind AND source_id=v_row->>'source_id' FOR UPDATE;
    IF v_link.id IS NOT NULL AND v_link.edulog_id<>v_id THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    v_current:=public.web_extension_target(v_kind,v_id); v_version:=COALESCE(v_current->>'version',v_current->>'updated_at','new');
    IF v_current IS NULL AND (v_kind='occurrence' AND EXISTS(SELECT 1 FROM public.class_occurrences WHERE class_session_id=(v_data->>'class_session_id')::uuid AND occurrence_date=(v_data->>'occurrence_date')::date)
      OR v_kind='report' AND EXISTS(SELECT 1 FROM public.occurrence_reports WHERE enrollment_id=(v_data->>'enrollment_id')::uuid AND class_occurrence_id=(v_data->>'class_occurrence_id')::uuid)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    v_versions:=v_versions||jsonb_build_object(v_kind||':'||(v_row->>'source_id'),v_version);
    IF p_operation='apply' AND v_batch.target_versions->>(v_kind||':'||(v_row->>'source_id')) IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
    IF NOT public.web_extension_row_permission(v_kind,v_id,v_current,v_job,CASE WHEN v_current IS NULL THEN 'create' ELSE 'read' END) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    -- Never transfer an existing entity to a different scope/identity.
    IF v_current IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(v_data) d WHERE d.key IN ('student_id','course_id','class_session_id','classroom_id','course_ids','enrollment_id','class_occurrence_id') AND v_current->d.key IS DISTINCT FROM d.value) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    v_before:='{}'; v_patch:='{}';
    FOR v_field IN SELECT jsonb_object_keys(v_data) LOOP
      v_before:=v_before||jsonb_build_object(v_field,v_current->v_field);
      IF v_current IS NULL OR (v_current->v_field IS DISTINCT FROM v_data->v_field AND (v_row->'overwrite') ? v_field) THEN v_patch:=v_patch||jsonb_build_object(v_field,v_data->v_field); END IF;
    END LOOP;
    IF v_current IS NOT NULL AND ((v_kind='enrollment' AND (v_patch-'status'-'external_link')<>'{}')
      OR (v_kind='class_session' AND (v_patch-'name'-'external_link')<>'{}') OR (v_kind='occurrence' AND v_patch<>'{}')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_status:=CASE WHEN v_current IS NULL THEN 'added' WHEN v_before=v_data THEN 'unchanged' WHEN v_patch<>'{}' THEN 'updated' ELSE 'conflict' END;
    IF v_status='updated' AND NOT public.web_extension_row_permission(v_kind,v_id,v_current,v_job,'update') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
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
          IF (v_patch - 'name' - 'external_link')<>'{}' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
          UPDATE public.class_sessions SET name=COALESCE(v_patch->>'name',name),external_link=COALESCE(v_patch->>'external_link',external_link) WHERE id=v_id;
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
      ELSIF v_kind='report' THEN
        IF NOT EXISTS(SELECT 1 FROM public.class_occurrences o JOIN public.enrollments e ON e.id=(v_data->>'enrollment_id')::uuid WHERE o.id=(v_data->>'class_occurrence_id')::uuid AND o.class_session_id=v_job.class_session_id AND e.class_session_id=v_job.class_session_id)
          OR (v_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.enrollments e ON e.id=(v_data->>'enrollment_id')::uuid WHERE l.id=(v_data->>'lesson_id')::uuid AND l.course_id=e.course_id)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
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
    v_items:=v_items||jsonb_build_array(v_item);
    v_count:=COALESCE((v_counts->>v_status)::integer,0)+1; v_counts:=jsonb_set(v_counts,ARRAY[v_status],to_jsonb(v_count));
    IF p_operation='apply' THEN
      v_current:=public.web_extension_target(v_kind,v_id);
      INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id,source_fingerprint,target_version)
        VALUES(v_user,v_job.source_origin,v_kind,v_row->>'source_id',v_id,COALESCE(v_row->>'source_fingerprint',p_input->>'fingerprint'),COALESCE(v_current->>'version',v_current->>'updated_at'))
        ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET source_fingerprint=EXCLUDED.source_fingerprint,target_version=EXCLUDED.target_version,updated_at=now();
    END IF;
  END LOOP;
  IF p_operation='preview' THEN
    INSERT INTO public.web_extension_import_batches(job_id,batch_key,fingerprint,target_versions,status) VALUES(v_job.id,(p_input->>'key')::uuid,p_input->>'fingerprint',v_versions,'previewed')
      ON CONFLICT(job_id,batch_key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,target_versions=EXCLUDED.target_versions,status='previewed';
    UPDATE public.web_extension_import_jobs SET status='previewed',updated_at=now() WHERE id=v_job.id;
    RETURN jsonb_build_object('rows',v_items,'counts',v_counts);
  END IF;
  -- Results contain identity and counts only, never source/target field values.
  v_item:=jsonb_build_object('key',p_input->>'key','counts',v_counts,'applied',jsonb_array_length(p_input->'rows'));
  UPDATE public.web_extension_import_batches SET status='applied',result=v_item WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;
  UPDATE public.web_extension_import_jobs SET status='applying',counts=jsonb_build_object('applied',COALESCE((counts->>'applied')::integer,0)+jsonb_array_length(p_input->'rows')),updated_at=now() WHERE id=v_job.id;
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
