-- Multi-course import and explicitly confirmed identity memories.
-- Earlier migrations stay immutable; service credentials never bypass teaching permissions.
BEGIN;
ALTER TABLE public.web_extension_import_jobs ADD COLUMN course_ids uuid[];
UPDATE public.web_extension_import_jobs SET course_ids=ARRAY[course_id] WHERE course_id IS NOT NULL;
CREATE TABLE public.web_extension_mapping_memory (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_origin text NOT NULL CHECK(source_origin='https://corp.orangeapple.co'),
  kind text NOT NULL CHECK(kind IN ('student','course','class_session','classroom','enrollment','admission','course_rule')),
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 512),
  scope_key text NOT NULL DEFAULT '', source_class_id text, source_identity text,
  target_id uuid, student_id uuid, course_id uuid, class_session_id uuid,
  revision uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,source_origin,kind,source_key,scope_key)
);
ALTER TABLE public.web_extension_mapping_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_extension_mapping_memory FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.web_extension_mapping_memory TO service_role;

CREATE FUNCTION public.web_extension_memory_target(p_kind text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_table text; v_row jsonb; v_safe jsonb; v_allowed boolean;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  v_table:=CASE p_kind WHEN 'students' THEN 'students' WHEN 'courses' THEN 'courses' WHEN 'classrooms' THEN 'classrooms' WHEN 'class_sessions' THEN 'class_sessions' WHEN 'enrollments' THEN 'enrollments' WHEN 'occurrences' THEN 'class_occurrences' WHEN 'report_targets' THEN 'occurrence_reports' WHEN 'lessons' THEN 'lessons' END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR SHARE',v_table) INTO v_row USING p_id;
  IF v_row IS NULL THEN RETURN NULL; END IF;
  v_allowed:=CASE p_kind
    WHEN 'students' THEN public.can_access_student(p_id,'teaching.students.read')
    WHEN 'courses' THEN public.has_teaching_permission(auth.uid(),'teaching.courses.read',(v_row->>'teaching_id')::uuid,NULL,NULL)
    WHEN 'classrooms' THEN public.can_access_classroom(p_id,'teaching.classrooms.read')
    WHEN 'class_sessions' THEN public.can_access_class_session(p_id,'teaching.class_sessions.read')
    WHEN 'enrollments' THEN public.can_access_enrollment(p_id,'teaching.enrollments.read')
    WHEN 'occurrences' THEN public.can_access_class_session((v_row->>'class_session_id')::uuid,'teaching.occurrences.read')
    WHEN 'report_targets' THEN public.can_access_report(p_id,'teaching.reports.read')
    WHEN 'lessons' THEN EXISTS(SELECT 1 FROM public.courses c WHERE c.id=(v_row->>'course_id')::uuid AND public.has_teaching_permission(auth.uid(),'teaching.courses.read',c.teaching_id,NULL,NULL)) ELSE false END;
  IF NOT v_allowed THEN RETURN NULL; END IF;
  v_safe:=public.web_extension_catalog_target(p_kind,p_id)||jsonb_build_object('target_version',md5(v_row::text));
  IF p_kind='students' THEN
    v_safe:=v_safe||jsonb_build_object('relationships',COALESCE((SELECT jsonb_agg(jsonb_build_object('class_name',s.name,'course_name',c.display_name)) FROM public.enrollments e JOIN public.class_sessions s ON s.id=e.class_session_id JOIN public.courses c ON c.id=e.course_id WHERE e.student_id=p_id AND public.can_access_enrollment(e.id,'teaching.enrollments.read')),'[]'));
  END IF;
  RETURN v_safe;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_memory_target(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_memory(p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid:=auth.uid(); v_origin text:='https://corp.orangeapple.co'; v_class text:=p_input->>'source_class_id';
  v_ref jsonb; v_item jsonb; v_target jsonb; v_relation jsonb; v_link public.web_extension_source_links;
  v_memory public.web_extension_mapping_memory; v_kind text; v_key text; v_scope text; v_plural text;
  v_id uuid; v_revision text; v_reason text; v_valid boolean; v_ids uuid[]; v_versions jsonb; v_identity text;
  v_links jsonb:='[]'; v_targets jsonb:='[]'; v_memories jsonb:='[]'; v_results jsonb:='[]'; v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF p_operation='resolve' THEN
    IF jsonb_typeof(p_input->'source_refs')<>'array' OR jsonb_array_length(p_input->'source_refs')>50 OR jsonb_typeof(p_input->'target_refs')<>'array' OR jsonb_array_length(p_input->'target_refs')>50 OR jsonb_array_length(COALESCE(p_input->'memory_refs','[]'))>50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(p_input->'source_refs') LOOP
      v_kind:=v_ref->>'source_kind';v_key:=v_ref->>'source_id';v_id:=NULL;v_revision:=NULL;v_reason:='remembered';
      v_plural:=CASE v_kind WHEN 'student' THEN 'students' WHEN 'course' THEN 'courses' WHEN 'classroom' THEN 'classrooms' WHEN 'class_session' THEN 'class_sessions' WHEN 'enrollment' THEN 'enrollments' WHEN 'occurrence' THEN 'occurrences' WHEN 'report' THEN 'report_targets' END;
      IF v_plural IS NULL OR length(v_key) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      SELECT * INTO v_link FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=v_kind AND source_id=v_key;
      IF v_link.id IS NOT NULL THEN v_id:=v_link.edulog_id;v_revision:=v_link.updated_at::text;
        SELECT * INTO v_memory FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key='';
        IF v_memory.revision IS NOT NULL THEN v_revision:=v_memory.revision::text; END IF;
      ELSIF v_kind IN ('student','class_session','enrollment') THEN
        -- Only a unique accessible canonical link identifies an existing record.
        IF v_kind='student' THEN SELECT array_agg(id) INTO v_ids FROM public.students WHERE external_link=v_origin||'/students/'||v_key AND public.can_access_student(id,'teaching.students.read');
        ELSIF v_kind='class_session' THEN SELECT array_agg(id) INTO v_ids FROM public.class_sessions WHERE external_link=v_origin||'/courses/dt/'||v_key AND public.can_access_class_session(id,'teaching.class_sessions.read');
        ELSE SELECT array_agg(id) INTO v_ids FROM public.enrollments WHERE external_link=v_origin||'/dt_admissions/'||v_key AND public.can_access_enrollment(id,'teaching.enrollments.read'); END IF;
        IF cardinality(v_ids)=1 THEN v_id:=v_ids[1];v_reason:='external_link'; END IF;
      END IF;
      IF v_id IS NULL THEN CONTINUE; END IF;
      v_target:=public.web_extension_memory_target(v_plural,v_id);v_valid:=v_target IS NOT NULL;
      v_links:=v_links||jsonb_build_array(jsonb_build_object('source_origin',v_origin,'source_kind',v_kind,'source_id',v_key,'target_id',CASE WHEN v_valid THEN v_id END,'valid',v_valid,'reason',v_reason,'revision',v_revision));
      IF v_valid THEN v_targets:=v_targets||jsonb_build_array(v_target); END IF;
    END LOOP;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(p_input->'target_refs') LOOP
      v_target:=public.web_extension_memory_target(v_ref->>'kind',(v_ref->>'id')::uuid);
      IF v_target IS NOT NULL THEN v_targets:=v_targets||jsonb_build_array(v_target); END IF;
    END LOOP;
    FOR v_ref IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'memory_refs','[]')) LOOP
      v_kind:=v_ref->>'kind';v_key:=v_ref->>'key';
      IF v_kind NOT IN ('course_rule','admission','classroom') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      FOR v_memory IN SELECT * FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key ORDER BY (source_class_id IS NOT DISTINCT FROM v_class) DESC,updated_at DESC LIMIT 5 LOOP
        v_versions:='{}';v_valid:=true;
        FOR v_plural,v_id IN SELECT * FROM (VALUES(CASE WHEN v_kind='course_rule' THEN 'courses' WHEN v_kind='classroom' THEN 'classrooms' ELSE 'enrollments' END,v_memory.target_id),('students',v_memory.student_id),('courses',v_memory.course_id),('class_sessions',v_memory.class_session_id)) t(kind,id) WHERE id IS NOT NULL LOOP
          v_target:=public.web_extension_memory_target(v_plural,v_id);
          IF v_target IS NULL THEN v_valid:=false; ELSE v_targets:=v_targets||jsonb_build_array(v_target);v_versions:=v_versions||jsonb_build_object(v_id::text,v_target->>'target_version'); END IF;
        END LOOP;
        IF v_kind='admission' AND v_ref->>'source_identity' IS NOT NULL AND v_memory.source_identity IS DISTINCT FROM v_ref->>'source_identity' THEN v_valid:=false; END IF;
        IF v_kind='admission' AND v_memory.target_id IS NOT NULL THEN
          v_relation:=public.web_extension_memory_target('enrollments',v_memory.target_id);
          IF v_relation->>'student_id' IS DISTINCT FROM v_memory.student_id::text OR v_relation->>'course_id' IS DISTINCT FROM v_memory.course_id::text OR v_relation->>'class_session_id' IS DISTINCT FROM v_memory.class_session_id::text THEN v_valid:=false; END IF;
        END IF;
        v_memories:=v_memories||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'source_class_id',v_memory.source_class_id,'source_identity',v_memory.source_identity,'target_id',CASE WHEN v_valid THEN v_memory.target_id END,'student_id',CASE WHEN v_valid THEN v_memory.student_id END,'course_id',CASE WHEN v_valid THEN v_memory.course_id END,'class_session_id',CASE WHEN v_valid THEN v_memory.class_session_id END,'revision',v_memory.revision,'valid',v_valid,'suggestion',v_kind='course_rule' AND v_memory.source_class_id IS DISTINCT FROM v_class,'versions',v_versions));
      END LOOP;
    END LOOP;
    RETURN jsonb_build_object('source_links',v_links,'targets',v_targets,'memories',v_memories);
  END IF;
  IF p_operation<>'memory-confirm' OR p_input->>'source_origin' IS DISTINCT FROM v_origin OR jsonb_typeof(p_input->'items')<>'array' OR jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    v_kind:=v_item->>'kind';v_key:=v_item->>'key';v_scope:=CASE WHEN v_kind='course_rule' THEN v_class ELSE '' END;
    IF v_kind NOT IN ('student','course','class_session','classroom','enrollment','admission','course_rule') OR length(v_key) NOT BETWEEN 1 AND (CASE WHEN v_kind='course_rule' THEN 512 ELSE 256 END) OR v_class IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||v_origin||v_kind||v_key||v_scope,0));
    SELECT * INTO v_memory FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key=v_scope FOR UPDATE;
    v_revision:=v_memory.revision::text;
    IF v_revision IS NULL AND v_kind IN ('student','course','class_session','enrollment') THEN SELECT updated_at::text INTO v_revision FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=v_kind AND source_id=v_key FOR UPDATE; END IF;
    IF v_item->>'expected_revision' IS DISTINCT FROM v_revision THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF v_item->>'action'='clear' THEN
      DELETE FROM public.web_extension_mapping_memory WHERE user_id=v_user AND source_origin=v_origin AND kind=v_kind AND source_key=v_key AND scope_key=v_scope;
      DELETE FROM public.web_extension_source_links WHERE user_id=v_user AND source_origin=v_origin AND source_kind=CASE WHEN v_kind='admission' THEN 'enrollment' ELSE v_kind END AND source_id=v_key;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'cleared',true));CONTINUE;
    END IF;
    IF v_item->>'action'<>'confirm' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_versions:=COALESCE(v_item->'versions','{}');v_count:=0;
    FOR v_plural,v_id IN SELECT * FROM (VALUES(CASE v_kind WHEN 'course_rule' THEN 'courses' WHEN 'course' THEN 'courses' WHEN 'student' THEN 'students' WHEN 'class_session' THEN 'class_sessions' WHEN 'classroom' THEN 'classrooms' ELSE 'enrollments' END,NULLIF(v_item->>'target_id','')::uuid),('students',NULLIF(v_item->>'student_id','')::uuid),('courses',NULLIF(v_item->>'course_id','')::uuid),('class_sessions',NULLIF(v_item->>'class_session_id','')::uuid)) t(kind,id) WHERE id IS NOT NULL LOOP
      v_target:=public.web_extension_memory_target(v_plural,v_id);v_count:=v_count+1;
      IF v_target IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      IF v_versions->>v_id::text IS DISTINCT FROM v_target->>'target_version' THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    END LOOP;
    IF v_count=0 OR (v_kind<>'admission' AND v_item->>'target_id' IS NULL) OR (v_kind='admission' AND (v_item->>'student_id' IS NULL OR v_item->>'course_id' IS NULL OR v_item->>'class_session_id' IS NULL)) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF v_kind='admission' AND v_item->>'target_id' IS NOT NULL THEN
      v_relation:=public.web_extension_memory_target('enrollments',(v_item->>'target_id')::uuid);
      IF v_relation->>'student_id' IS DISTINCT FROM v_item->>'student_id' OR v_relation->>'course_id' IS DISTINCT FROM v_item->>'course_id' OR v_relation->>'class_session_id' IS DISTINCT FROM v_item->>'class_session_id' THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
    END IF;
    IF v_kind='admission' AND NOT EXISTS(SELECT 1 FROM public.class_sessions s JOIN public.courses c ON c.id=(v_item->>'course_id')::uuid WHERE s.id=(v_item->>'class_session_id')::uuid AND s.teaching_id=c.teaching_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    INSERT INTO public.web_extension_mapping_memory(user_id,source_origin,kind,source_key,scope_key,source_class_id,source_identity,target_id,student_id,course_id,class_session_id)
      VALUES(v_user,v_origin,v_kind,v_key,v_scope,v_class,v_item->>'source_identity',NULLIF(v_item->>'target_id','')::uuid,NULLIF(v_item->>'student_id','')::uuid,NULLIF(v_item->>'course_id','')::uuid,NULLIF(v_item->>'class_session_id','')::uuid)
      ON CONFLICT(user_id,source_origin,kind,source_key,scope_key) DO UPDATE SET target_id=EXCLUDED.target_id,student_id=EXCLUDED.student_id,course_id=EXCLUDED.course_id,class_session_id=EXCLUDED.class_session_id,source_identity=EXCLUDED.source_identity,source_class_id=EXCLUDED.source_class_id,revision=gen_random_uuid(),updated_at=now() RETURNING * INTO v_memory;
    IF v_kind IN ('student','course','class_session','enrollment','admission') AND v_memory.target_id IS NOT NULL THEN
      INSERT INTO public.web_extension_source_links(user_id,source_origin,source_kind,source_id,edulog_id) VALUES(v_user,v_origin,CASE WHEN v_kind='admission' THEN 'enrollment' ELSE v_kind END,v_key,v_memory.target_id)
        ON CONFLICT(user_id,source_origin,source_kind,source_id) DO UPDATE SET edulog_id=EXCLUDED.edulog_id,updated_at=now();
    END IF;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('kind',v_kind,'key',v_key,'revision',v_memory.revision));
  END LOOP;
  RETURN jsonb_build_object('items',v_results);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_memory(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.web_extension_workspace(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
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
    RETURN jsonb_build_object('workspace_version',1,'submission_confirmation',false,'all_classes_import',false,'multi_course_import',true,'mapping_memory',true);
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
    INSERT INTO public.web_extension_import_jobs(user_id,source_origin,source_class_id,date_from,date_to,classroom_id,course_id,class_session_id,course_ids)
      VALUES(v_user,p_input->>'source_origin',p_input->>'source_class_id',(p_input->>'date_from')::date,(p_input->>'date_to')::date,(p_input->>'classroom_id')::uuid,COALESCE((p_input->>'course_id')::uuid,(p_input->'course_ids'->>0)::uuid),(p_input->>'class_session_id')::uuid,CASE WHEN p_input ? 'course_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_input->'course_ids')::uuid) ELSE ARRAY[(p_input->>'course_id')::uuid] END) RETURNING * INTO v_job;
    IF cardinality(v_job.course_ids) NOT BETWEEN 1 AND 10 OR v_job.course_ids IS NULL OR array_position(v_job.course_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF EXISTS(SELECT 1 FROM public.courses c JOIN public.classrooms r ON r.id=v_job.classroom_id WHERE c.id=ANY(v_job.course_ids) AND (c.teaching_id IS DISTINCT FROM r.teaching_id OR NOT public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL))) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
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
      WHEN 'report' THEN ARRAY['enrollment_id','class_occurrence_id','lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'] END;
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
    IF v_current IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(v_data) d WHERE d.key IN ('student_id','course_id','class_session_id','classroom_id','course_ids','enrollment_id','class_occurrence_id') AND NOT (v_kind='class_session' AND d.key='course_ids') AND v_current->d.key IS DISTINCT FROM d.value) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
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
    IF p_operation='apply' AND NOT (v_row ? 'source_rule') THEN
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
  v_item:=jsonb_build_object('key',p_input->>'key','counts',v_counts,'applied',jsonb_array_length(p_input->'rows'));
  UPDATE public.web_extension_import_batches SET status='applied',result=v_item WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;
  UPDATE public.web_extension_import_jobs SET status='applying',counts=jsonb_build_object('applied',COALESCE((counts->>'applied')::integer,0)+jsonb_array_length(p_input->'rows')),updated_at=now() WHERE id=v_job.id;
  RETURN v_item;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.web_extension_catalog(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid; v_resource text; v_query text; v_cursor text; v_next text; v_rows jsonb; v_limit integer;
  v_classroom uuid; v_course uuid; v_session uuid; v_student uuid; v_enrollment uuid; v_occurrence uuid;
  v_from date; v_to date; v_report uuid; v_kind text; v_source_id text; v_target uuid; v_current jsonb;
  v_refs jsonb := '[]'; v_targets jsonb := '[]'; v_link jsonb; v_report_cursor_date date; v_report_cursor_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation='capabilities' THEN RETURN jsonb_build_object('catalog_version',1,'mapping_memory',true,'multi_course_import',true); END IF;
  IF p_operation IN ('resolve','memory-confirm') THEN RETURN public.web_extension_memory(p_operation,p_input); END IF;
  IF p_operation='legacy-resolve' THEN
    IF jsonb_typeof(p_input->'source_refs')<>'array' OR jsonb_array_length(p_input->'source_refs')>50
       OR jsonb_typeof(p_input->'target_refs')<>'array' OR jsonb_array_length(p_input->'target_refs')>50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    FOR v_link IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'source_refs','[]')) LOOP
      v_kind:=v_link->>'source_kind'; v_source_id:=v_link->>'source_id';
      IF v_kind NOT IN ('student','course','class_session','enrollment','occurrence','report') OR length(v_source_id) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      SELECT to_jsonb(l) INTO v_link FROM public.web_extension_source_links l WHERE l.user_id=v_user AND l.source_origin='https://corp.orangeapple.co' AND l.source_kind=v_kind AND l.source_id=v_source_id;
      IF v_link IS NULL THEN CONTINUE; END IF;
      v_target:=(v_link->>'edulog_id')::uuid; v_current:=public.web_extension_target(v_kind,v_target);
      IF v_current IS NULL OR NOT (CASE v_kind
        WHEN 'student' THEN public.can_access_student(v_target,'teaching.students.read')
        WHEN 'course' THEN public.has_teaching_permission(v_user,'teaching.courses.read',(SELECT c.teaching_id FROM public.courses c WHERE c.id=v_target),NULL,NULL)
        WHEN 'class_session' THEN public.can_access_class_session(v_target,'teaching.class_sessions.read')
        WHEN 'enrollment' THEN public.can_access_enrollment(v_target,'teaching.enrollments.read')
        WHEN 'occurrence' THEN public.can_access_class_session((v_current->>'class_session_id')::uuid,'teaching.occurrences.read')
        WHEN 'report' THEN public.can_access_report(v_target,'teaching.reports.read')
        ELSE false END) THEN CONTINUE; END IF;
      v_refs:=v_refs||jsonb_build_array(jsonb_build_object('source_origin','https://corp.orangeapple.co','source_kind',v_kind,'source_id',v_source_id,'target_id',v_target));
    END LOOP;
    FOR v_link IN SELECT value FROM jsonb_array_elements(p_input->'target_refs') LOOP
      v_kind:=v_link->>'kind'; v_target:=(v_link->>'id')::uuid; v_current:=public.web_extension_catalog_target(v_kind,v_target);
      IF v_current IS NULL OR NOT (CASE v_kind
        WHEN 'classrooms' THEN public.can_access_classroom(v_target,'teaching.classrooms.read')
        WHEN 'courses' THEN public.has_teaching_permission(v_user,'teaching.courses.read',(SELECT c.teaching_id FROM public.courses c WHERE c.id=v_target),NULL,NULL)
        WHEN 'class_sessions' THEN public.can_access_class_session(v_target,'teaching.class_sessions.read')
        WHEN 'students' THEN public.can_access_student(v_target,'teaching.students.read')
        WHEN 'enrollments' THEN public.can_access_enrollment(v_target,'teaching.enrollments.read')
        WHEN 'occurrences' THEN public.can_access_class_session((v_current->>'class_session_id')::uuid,'teaching.occurrences.read')
        WHEN 'report_targets' THEN public.can_access_report(v_target,'teaching.reports.read')
        WHEN 'lessons' THEN public.has_teaching_permission(v_user,'teaching.courses.read',(SELECT c.teaching_id FROM public.courses c WHERE c.id=(v_current->>'course_id')::uuid),NULL,NULL)
        ELSE false END) THEN CONTINUE; END IF;
      v_targets:=v_targets||jsonb_build_array(CASE v_kind
        WHEN 'classrooms' THEN jsonb_build_object('kind',v_kind,'id',v_target,'name',v_current->>'name')
        WHEN 'courses' THEN jsonb_build_object('kind',v_kind,'id',v_target,'subject',v_current->>'subject','stage',v_current->>'stage','display_name',v_current->>'display_name')
        WHEN 'class_sessions' THEN jsonb_build_object('kind',v_kind,'id',v_target,'name',v_current->>'name','classroom_id',v_current->>'classroom_id','course_ids',v_current->'course_ids','start_time',v_current->>'start_time','end_time',v_current->>'end_time','start_date',v_current->>'start_date','day_of_week',v_current->>'day_of_week')
        WHEN 'students' THEN jsonb_build_object('kind',v_kind,'id',v_target,'name',v_current->>'name')
        WHEN 'enrollments' THEN jsonb_build_object('kind',v_kind,'id',v_target,'student_id',v_current->>'student_id','course_id',v_current->>'course_id','class_session_id',v_current->>'class_session_id','start_date',v_current->>'start_date','status',v_current->>'status')
        WHEN 'occurrences' THEN jsonb_build_object('kind',v_kind,'id',v_target,'class_session_id',v_current->>'class_session_id','occurrence_date',v_current->>'occurrence_date')
        WHEN 'report_targets' THEN jsonb_build_object('kind',v_kind,'id',v_target,'enrollment_id',v_current->>'enrollment_id','class_occurrence_id',v_current->>'class_occurrence_id')
        WHEN 'lessons' THEN jsonb_build_object('kind',v_kind,'id',v_target,'course_id',v_current->>'course_id','title',v_current->>'title','sequence',v_current->>'sequence') END);
    END LOOP;
    RETURN jsonb_build_object('source_links',v_refs,'targets',v_targets);
  END IF;
  IF p_operation='reports' THEN
    v_report:=NULLIF(p_input->>'report_id','')::uuid; v_limit:=CASE WHEN v_report IS NOT NULL THEN 1 ELSE LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50))) END;
    v_from:=NULLIF(p_input->>'date_from','')::date; v_to:=NULLIF(p_input->>'date_to','')::date; v_course:=NULLIF(p_input->>'course_id','')::uuid; v_query:=COALESCE(p_input->>'search',''); v_cursor:=NULLIF(p_input->>'cursor','');
    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF v_cursor IS NOT NULL THEN
      v_report_cursor_date:=split_part(v_cursor,'|',1)::date; v_report_cursor_id:=split_part(v_cursor,'|',2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.occurrence_date DESC,q.id DESC),'[]') INTO v_rows FROM (
      SELECT r.id,r.enrollment_id,r.lesson_id,r.version,r.is_completed,r.progress_letter,r.attendance_status,r.absence_reason,r.class_participation,r.classroom_behavior,
        r.content,r.contact_notes,r.class_notes,r.updated_at,s.name AS student_name,c.display_name AS course_name,c.id AS course_id,o.occurrence_date,
        e.student_id,o.class_session_id
      FROM public.occurrence_reports r JOIN public.enrollments e ON e.id=r.enrollment_id JOIN public.students s ON s.id=e.student_id
      JOIN public.courses c ON c.id=e.course_id JOIN public.class_occurrences o ON o.id=r.class_occurrence_id
      WHERE (v_report IS NULL OR r.id=v_report) AND (v_report IS NOT NULL OR (v_from IS NULL OR o.occurrence_date>=v_from) AND (v_to IS NULL OR o.occurrence_date<=v_to))
        AND (v_report IS NOT NULL OR v_course IS NULL OR e.course_id=v_course)
        AND (v_report IS NOT NULL OR p_input->>'enrollment_id' IS NULL OR e.id=(p_input->>'enrollment_id')::uuid) AND (v_report IS NOT NULL OR p_input->>'student_id' IS NULL OR e.student_id=(p_input->>'student_id')::uuid)
        AND (v_report IS NOT NULL OR v_query='' OR strpos(lower(concat_ws(' ',s.name,c.display_name,o.occurrence_date::text)),lower(v_query))>0)
        AND (v_report IS NOT NULL OR v_cursor IS NULL OR (o.occurrence_date<v_report_cursor_date OR (o.occurrence_date=v_report_cursor_date AND r.id<v_report_cursor_id)))
        AND public.can_access_report(r.id,'teaching.reports.read')
      ORDER BY o.occurrence_date DESC,r.id DESC LIMIT v_limit
    ) q;
    IF v_report IS NULL AND jsonb_array_length(v_rows)=v_limit AND v_limit>0 THEN v_next:=(v_rows->(v_limit-1)->>'occurrence_date')||'|'||(v_rows->(v_limit-1)->>'id'); END IF;
    RETURN jsonb_build_object('reports',v_rows,'next_cursor',v_next);
  END IF;
  IF p_operation<>'catalog' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  v_resource:=p_input->>'resource'; v_query:=COALESCE(p_input->>'search',''); v_cursor:=NULLIF(p_input->>'cursor','');
  v_limit:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
  v_classroom:=NULLIF(p_input->>'classroom_id','')::uuid; v_course:=NULLIF(p_input->>'course_id','')::uuid;
  v_session:=NULLIF(p_input->>'class_session_id','')::uuid; v_student:=NULLIF(p_input->>'student_id','')::uuid;
  v_enrollment:=NULLIF(p_input->>'enrollment_id','')::uuid; v_occurrence:=NULLIF(p_input->>'class_occurrence_id','')::uuid;
  v_from:=NULLIF(p_input->>'date_from','')::date; v_to:=NULLIF(p_input->>'date_to','')::date;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from>v_to THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF v_resource='permissions' THEN
    IF v_classroom IS NOT NULL AND NOT public.can_access_classroom(v_classroom,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_session IS NOT NULL AND NOT public.can_access_class_session(v_session,'teaching.class_sessions.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    RETURN jsonb_build_object('course_create',public.has_api_permission(v_user,'teaching.courses.create',NULL,NULL),
      'classroom',CASE WHEN v_classroom IS NULL THEN NULL ELSE jsonb_build_object('id',v_classroom,
        'class_update',CASE WHEN v_session IS NULL THEN false ELSE public.can_access_class_session(v_session,'teaching.class_sessions.update') END,'class_create',public.has_api_permission(v_user,'teaching.class_sessions.create',v_classroom,NULL),
        'student_create',public.has_api_permission(v_user,'teaching.students.create',v_classroom,NULL),
        'enrollment_create',public.has_api_permission(v_user,'teaching.enrollments.create',v_classroom,NULL),
        'occurrence_create',public.has_api_permission(v_user,'teaching.occurrences.create',v_classroom,NULL),
        'report_create',public.has_api_permission(v_user,'teaching.reports.create',v_classroom,NULL)) END,
      'session',CASE WHEN v_session IS NULL THEN NULL ELSE jsonb_build_object('id',v_session,
        'class_update',public.can_access_class_session(v_session,'teaching.class_sessions.update'),'student_create',public.has_api_permission(v_user,'teaching.students.create',NULL,v_session),
        'enrollment_create',public.has_api_permission(v_user,'teaching.enrollments.create',NULL,v_session),
        'occurrence_create',public.has_api_permission(v_user,'teaching.occurrences.create',NULL,v_session),
        'report_create',public.has_api_permission(v_user,'teaching.reports.create',NULL,v_session)) END);
  END IF;
  IF v_resource='classrooms' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT c.id,c.name FROM public.classrooms c WHERE public.can_access_classroom(c.id,'teaching.classrooms.list') AND (v_cursor IS NULL OR c.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(c.name),lower(v_query))>0) ORDER BY c.id LIMIT v_limit) q;
  ELSIF v_resource='courses' THEN
    IF v_classroom IS NOT NULL AND NOT public.can_access_classroom(v_classroom,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT c.id,c.subject,c.stage,c.display_name,md5(to_jsonb(c)::text) AS target_version FROM public.courses c
      JOIN public.classrooms r ON r.teaching_id=c.teaching_id
      WHERE public.has_teaching_permission(v_user,'teaching.courses.list',c.teaching_id,NULL,NULL) AND (v_classroom IS NULL OR r.id=v_classroom)
      AND (v_cursor IS NULL OR c.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(concat_ws(' ',c.display_name,c.subject,c.stage)),lower(v_query))>0)
      GROUP BY c.id ORDER BY c.id LIMIT v_limit) q;
  ELSIF v_resource='class_sessions' THEN
    IF v_classroom IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF NOT public.can_access_classroom(v_classroom,'teaching.classrooms.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT s.id,s.name,s.classroom_id,s.course_ids,s.start_time,s.end_time,s.start_date,s.day_of_week FROM public.class_sessions s
      WHERE s.classroom_id=v_classroom AND (v_course IS NULL OR v_course=ANY(s.course_ids)) AND public.can_access_class_session(s.id,'teaching.class_sessions.list')
      AND (v_cursor IS NULL OR s.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(s.name),lower(v_query))>0) ORDER BY s.id LIMIT v_limit) q;
  ELSIF v_resource='students' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT s.id,s.name,md5(to_jsonb(s)::text) AS target_version,COALESCE((SELECT jsonb_agg(jsonb_build_object('class_name',cs.name,'course_name',c.display_name)) FROM public.enrollments e JOIN public.class_sessions cs ON cs.id=e.class_session_id JOIN public.courses c ON c.id=e.course_id WHERE e.student_id=s.id AND public.can_access_enrollment(e.id,'teaching.enrollments.read')),'[]') AS relationships FROM public.students s WHERE public.can_access_student(s.id,'teaching.students.read')
      AND (v_cursor IS NULL OR s.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(s.name),lower(v_query))>0) ORDER BY s.id LIMIT v_limit) q;
  ELSIF v_resource='enrollments' THEN
    IF v_session IS NULL OR NOT public.can_access_class_session(v_session,'teaching.enrollments.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT e.id,e.student_id,e.course_id,e.class_session_id,e.start_date,e.status FROM public.enrollments e
      WHERE e.class_session_id=v_session AND (v_student IS NULL OR e.student_id=v_student) AND (v_course IS NULL OR e.course_id=v_course) AND (v_cursor IS NULL OR e.id>v_cursor::uuid)
      AND public.can_access_enrollment(e.id,'teaching.enrollments.read') ORDER BY e.id LIMIT v_limit) q;
  ELSIF v_resource='occurrences' THEN
    IF v_session IS NULL OR NOT public.can_access_class_session(v_session,'teaching.occurrences.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT o.id,o.class_session_id,o.occurrence_date FROM public.class_occurrences o
      WHERE o.class_session_id=v_session AND (v_from IS NULL OR o.occurrence_date>=v_from) AND (v_to IS NULL OR o.occurrence_date<=v_to)
      AND (v_cursor IS NULL OR o.id>v_cursor::uuid) AND public.can_access_class_session(o.class_session_id,'teaching.occurrences.read') ORDER BY o.id LIMIT v_limit) q;
  ELSIF v_resource='report_targets' THEN
    IF v_session IS NULL OR NOT public.can_access_class_session(v_session,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT r.id,r.enrollment_id,r.class_occurrence_id FROM public.occurrence_reports r
      JOIN public.class_occurrences o ON o.id=r.class_occurrence_id WHERE o.class_session_id=v_session AND (v_enrollment IS NULL OR r.enrollment_id=v_enrollment)
      AND (v_occurrence IS NULL OR r.class_occurrence_id=v_occurrence) AND (v_cursor IS NULL OR r.id>v_cursor::uuid)
      AND public.can_access_report(r.id,'teaching.reports.read') ORDER BY r.id LIMIT v_limit) q;
  ELSIF v_resource='lessons' THEN
    IF v_course IS NULL OR NOT EXISTS(SELECT 1 FROM public.courses c WHERE c.id=v_course AND public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL)) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT l.id,l.course_id,l.title,l.sequence FROM public.lessons l WHERE l.course_id=v_course
      AND (v_cursor IS NULL OR l.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(l.title),lower(v_query))>0) ORDER BY l.id LIMIT v_limit) q;
  ELSE RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF jsonb_array_length(v_rows)=v_limit THEN v_next:=v_rows->(v_limit-1)->>'id'; END IF;
  RETURN jsonb_build_object('items',v_rows,'next_cursor',v_next,'limit',v_limit);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_catalog(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_catalog(uuid,text,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
