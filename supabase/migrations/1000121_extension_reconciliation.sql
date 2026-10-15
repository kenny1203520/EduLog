-- Read-only reconciliation; deployed migrations remain immutable.
BEGIN;
CREATE OR REPLACE FUNCTION public.web_extension_catalog_target(p_kind text,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row jsonb;
BEGIN
  CASE p_kind
    WHEN 'classrooms' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'name',name) INTO v_row FROM public.classrooms WHERE id=p_id;
    WHEN 'courses' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'subject',subject,'stage',stage,'display_name',display_name) INTO v_row FROM public.courses WHERE id=p_id;
    WHEN 'class_sessions' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'name',name,'classroom_id',classroom_id,'course_ids',course_ids,'start_time',start_time,'end_time',end_time,'start_date',start_date,'day_of_week',day_of_week,'time_zone',time_zone,'session_type',session_type,'schedule_mode',schedule_mode,'schedule_rules',COALESCE((SELECT jsonb_agg(jsonb_build_object('schedule_kind',r.schedule_kind,'day_of_week',r.day_of_week,'day_of_month',r.day_of_month,'occurrence_date',r.occurrence_date,'start_time',r.start_time,'end_time',r.end_time) ORDER BY r.day_of_week NULLS LAST,r.day_of_month NULLS LAST,r.occurrence_date NULLS LAST,r.id) FROM public.class_session_schedule_rules r WHERE r.class_session_id=p_id),'[]'::jsonb)) INTO v_row FROM public.class_sessions WHERE id=p_id;
    WHEN 'students' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'name',name) INTO v_row FROM public.students WHERE id=p_id;
    WHEN 'enrollments' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'student_id',student_id,'course_id',course_id,'class_session_id',class_session_id,'start_date',start_date,'status',status) INTO v_row FROM public.enrollments WHERE id=p_id;
      IF v_row IS NOT NULL THEN
        v_row:=v_row||jsonb_build_object('class_session',CASE WHEN public.can_access_class_session((v_row->>'class_session_id')::uuid,'teaching.class_sessions.read') THEN public.web_extension_catalog_target('class_sessions',(v_row->>'class_session_id')::uuid) END,
          'course_name',CASE WHEN public.has_teaching_permission(auth.uid(),'teaching.courses.read',(SELECT c.teaching_id FROM public.courses c WHERE c.id=(v_row->>'course_id')::uuid),NULL,NULL) THEN (SELECT c.display_name FROM public.courses c WHERE c.id=(v_row->>'course_id')::uuid) END);
      END IF;
    WHEN 'occurrences' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'class_session_id',class_session_id,'occurrence_date',occurrence_date) INTO v_row FROM public.class_occurrences WHERE id=p_id;
    WHEN 'report_targets' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'enrollment_id',enrollment_id,'class_occurrence_id',class_occurrence_id) INTO v_row FROM public.occurrence_reports WHERE id=p_id;
    WHEN 'lessons' THEN SELECT jsonb_build_object('kind',p_kind,'id',id,'course_id',course_id,'title',title,'sequence',sequence) INTO v_row FROM public.lessons WHERE id=p_id;
    ELSE RAISE EXCEPTION 'INVALID_IMPORT';
  END CASE;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.web_extension_catalog_target(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_reconciliation(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_id uuid:=NULLIF(p_input->>'enrollment_id','')::uuid; v_enrollment jsonb; v_rows jsonb;
  v_limit integer:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
  v_cursor uuid:=NULLIF(p_input->>'cursor','')::uuid; v_next text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  v_enrollment:=public.web_extension_memory_target('enrollments',v_id);
  IF v_enrollment IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  IF NOT public.can_access_student((v_enrollment->>'student_id')::uuid,'teaching.students.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (
    SELECT t.id,t.created_at,t.cancelled_at,t.source_occurrence_id,t.target_occurrence_id,
      a.occurrence_date AS source_date,b.occurrence_date AS target_date,
      a.class_session_id AS source_class_session_id,b.class_session_id AS target_class_session_id,
      public.web_extension_catalog_target('class_sessions',a.class_session_id) AS source_class_session,
      public.web_extension_catalog_target('class_sessions',b.class_session_id) AS target_class_session,
      COALESCE(a.actual_start_time,a.original_start_time) AS source_start_time,COALESCE(a.actual_end_time,a.original_end_time) AS source_end_time,
      COALESCE(b.actual_start_time,b.original_start_time) AS target_start_time,COALESCE(b.actual_end_time,b.original_end_time) AS target_end_time,
      t.cancelled_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.single_lesson_transfers onward WHERE onward.enrollment_id=v_id AND onward.source_occurrence_id=t.target_occurrence_id AND onward.cancelled_at IS NULL) AS is_effective_target,
      (SELECT r.id FROM public.occurrence_reports r WHERE r.enrollment_id=v_id AND r.class_occurrence_id=t.target_occurrence_id AND public.can_access_report(r.id,'teaching.reports.read') LIMIT 1) AS target_report_id
    FROM public.single_lesson_transfers t JOIN public.class_occurrences a ON a.id=t.source_occurrence_id JOIN public.class_occurrences b ON b.id=t.target_occurrence_id
    WHERE t.enrollment_id=v_id AND (v_cursor IS NULL OR t.id>v_cursor)
      AND public.can_access_class_session(a.class_session_id,'teaching.occurrences.read') AND public.can_access_class_session(b.class_session_id,'teaching.occurrences.read')
      AND public.can_access_class_session(a.class_session_id,'teaching.class_sessions.read') AND public.can_access_class_session(b.class_session_id,'teaching.class_sessions.read')
    ORDER BY t.id LIMIT v_limit
  ) q;
  IF jsonb_array_length(v_rows)=v_limit THEN v_next:=v_rows->(v_limit-1)->>'id'; END IF;
  RETURN jsonb_build_object('enrollment',v_enrollment,'transfers',v_rows,'next_cursor',v_next,'limit',v_limit,'note','僅提供可讀取的單次調課紀錄；未推算轉班歷史或來源登記原因。');
END $$;
REVOKE ALL ON FUNCTION public.web_extension_reconciliation(jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
  IF p_operation='capabilities' THEN RETURN jsonb_build_object('catalog_version',1,'mapping_memory',true,'multi_course_import',true,'student_enrollment_catalog',true,'enrollment_reconciliation',true); END IF;
  IF p_operation='reconcile' THEN RETURN public.web_extension_reconciliation(p_input); END IF;
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
    SELECT COALESCE(jsonb_agg(q.item),'[]') INTO v_rows FROM (SELECT public.web_extension_catalog_target('class_sessions',s.id) AS item FROM public.class_sessions s
      WHERE s.classroom_id=v_classroom AND (v_course IS NULL OR v_course=ANY(s.course_ids)) AND public.can_access_class_session(s.id,'teaching.class_sessions.list')
      AND (v_cursor IS NULL OR s.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(s.name),lower(v_query))>0) ORDER BY s.id LIMIT v_limit) q;
  ELSIF v_resource='students' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q)),'[]') INTO v_rows FROM (SELECT s.id,s.name,md5(to_jsonb(s)::text) AS target_version,COALESCE((SELECT jsonb_agg(jsonb_build_object('class_name',cs.name,'course_name',c.display_name)) FROM public.enrollments e JOIN public.class_sessions cs ON cs.id=e.class_session_id JOIN public.courses c ON c.id=e.course_id WHERE e.student_id=s.id AND public.can_access_enrollment(e.id,'teaching.enrollments.read')),'[]') AS relationships FROM public.students s WHERE public.can_access_student(s.id,'teaching.students.read')
      AND (v_cursor IS NULL OR s.id>v_cursor::uuid) AND (v_query='' OR strpos(lower(s.name),lower(v_query))>0) ORDER BY s.id LIMIT v_limit) q;
  ELSIF v_resource='enrollments' THEN
    IF v_session IS NULL AND v_student IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF v_session IS NOT NULL AND NOT public.can_access_class_session(v_session,'teaching.enrollments.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_student IS NOT NULL AND NOT public.can_access_student(v_student,'teaching.students.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    SELECT COALESCE(jsonb_agg(q.item),'[]') INTO v_rows FROM (
      SELECT public.web_extension_memory_target('enrollments',e.id) AS item FROM public.enrollments e
      WHERE (v_session IS NULL OR e.class_session_id=v_session) AND (v_student IS NULL OR e.student_id=v_student)
        AND (v_course IS NULL OR e.course_id=v_course) AND (v_cursor IS NULL OR e.id>v_cursor::uuid)
        AND public.can_access_enrollment(e.id,'teaching.enrollments.read') ORDER BY e.id LIMIT v_limit
    ) q;
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
