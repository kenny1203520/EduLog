BEGIN;
CREATE TABLE public.web_extension_sync_field_preferences (
 user_id uuid NOT NULL, source_origin text NOT NULL CHECK(source_origin='https://corp.orangeapple.co'),
 adapter_version text NOT NULL CHECK(adapter_version='orange-apple-v1'),
 fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fields)='object'),
 revision uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,source_origin,adapter_version),
 CHECK(fields - ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']::text[]='{}'::jsonb)
);
ALTER TABLE public.web_extension_sync_field_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_extension_sync_field_preferences_self ON public.web_extension_sync_field_preferences USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
REVOKE ALL ON public.web_extension_sync_field_preferences FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.web_extension_sync_preferences(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user uuid;v_row public.web_extension_sync_field_preferences;v_field jsonb;v_fields jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';END IF;
 SELECT user_id INTO v_user FROM public.web_extension_tokens WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID';END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',v_user::text,true);PERFORM set_config('request.jwt.claim.role','authenticated',true);
 IF p_input->>'source_origin'<>'https://corp.orangeapple.co' OR p_input->>'adapter_version'<>'orange-apple-v1' THEN RAISE EXCEPTION 'INVALID_IMPORT';END IF;
 IF p_operation='capabilities' THEN RETURN jsonb_build_object('sync_field_preferences',true);END IF;
 IF p_operation NOT IN ('get','patch') THEN RAISE EXCEPTION 'INVALID_IMPORT';END IF;
 IF p_operation='patch' THEN
  IF jsonb_typeof(p_input->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'fields') NOT BETWEEN 1 AND 11
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'fields') x WHERE x->>'field_key' NOT IN ('lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link') OR jsonb_typeof(x->'enabled') IS DISTINCT FROM 'boolean')
   OR (SELECT count(*)<>count(DISTINCT x->>'field_key') FROM jsonb_array_elements(p_input->'fields') x) THEN RAISE EXCEPTION 'INVALID_IMPORT';END IF;
  SELECT * INTO v_row FROM public.web_extension_sync_field_preferences WHERE user_id=v_user AND source_origin=p_input->>'source_origin' AND adapter_version=p_input->>'adapter_version' FOR UPDATE;
  IF COALESCE(p_input->>'expected_revision','')<>COALESCE(v_row.revision::text,'') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  v_fields:=COALESCE(v_row.fields,'{}');
  FOR v_field IN SELECT value FROM jsonb_array_elements(p_input->'fields') LOOP v_fields:=jsonb_set(v_fields,ARRAY[v_field->>'field_key'],v_field->'enabled',true);END LOOP;
  INSERT INTO public.web_extension_sync_field_preferences(user_id,source_origin,adapter_version,fields) VALUES(v_user,p_input->>'source_origin',p_input->>'adapter_version',v_fields)
   ON CONFLICT(user_id,source_origin,adapter_version) DO UPDATE SET fields=EXCLUDED.fields,revision=gen_random_uuid(),updated_at=now() RETURNING * INTO v_row;
 END IF;
 IF p_operation='get' THEN SELECT * INTO v_row FROM public.web_extension_sync_field_preferences WHERE user_id=v_user AND source_origin=p_input->>'source_origin' AND adapter_version=p_input->>'adapter_version';END IF;
 RETURN jsonb_build_object('fields',COALESCE(v_row.fields,'{}'),'revision',v_row.revision);
END $$;
REVOKE ALL ON FUNCTION public.web_extension_sync_preferences(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_sync_preferences(uuid,text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.web_extension_field_mappings(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid; v_item jsonb; v_key text; v_scope text; v_course uuid; v_session uuid;
  v_source text; v_signature text; v_value jsonb; v_memory public.web_extension_field_mapping_memory;
  v_rows jsonb:='[]'; v_exists boolean; v_allowed boolean; v_options jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  IF p_operation='capabilities' THEN RETURN jsonb_build_object('field_mapping_memory',true,'global_progress_mapping',true,'history_binding_field_mask',true); END IF;
  IF p_operation NOT IN ('resolve','confirm') OR p_input->>'source_origin' IS DISTINCT FROM 'https://corp.orangeapple.co'
     OR p_input->>'adapter_version' IS DISTINCT FROM 'orange-apple-v1'
     OR jsonb_typeof(p_input->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_input->'items') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  -- Serialize rule confirmations, including the first insert and clear, per user.
  IF p_operation='confirm' THEN PERFORM pg_advisory_xact_lock(hashtext(v_user::text),124); END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_input->'items') LOOP
    v_key:=v_item->>'field_key';v_course:=NULLIF(v_item->>'course_id','')::uuid;
    v_session:=NULLIF(v_item->>'class_session_id','')::uuid;v_scope:=COALESCE(v_course::text,'');
    v_signature:=v_item->>'options_signature';
    IF v_key IS NULL OR v_key NOT IN ('attendance_status','absence_reason','is_completed','class_participation','classroom_behavior','lesson_id','progress_start','progress_end')
      OR v_signature IS NULL OR length(v_signature) NOT BETWEEN 2 AND 16000
      OR (v_key='lesson_id' AND v_course IS NULL) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_options:=v_signature::jsonb;
    IF jsonb_typeof(v_options) IS DISTINCT FROM 'array' OR jsonb_array_length(v_options)>500 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_options) o WHERE jsonb_typeof(o) IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_options) o WHERE jsonb_array_length(o)<>3
      OR jsonb_typeof(o->0) IS DISTINCT FROM 'string' OR length(o->>0)>256
      OR jsonb_typeof(o->1) IS DISTINCT FROM 'string' OR length(o->>1)>500
      OR jsonb_typeof(o->2) IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_allowed:=CASE WHEN v_course IS NOT NULL THEN EXISTS(SELECT 1 FROM public.courses c WHERE c.id=v_course
      AND public.has_teaching_permission(v_user,'teaching.courses.read',c.teaching_id,NULL,NULL))
      ELSE public.has_api_permission(v_user,'teaching.reports.read',NULL,NULL) END;
    IF NOT v_allowed OR (v_session IS NOT NULL AND NOT public.can_access_class_session(v_session,'teaching.class_sessions.read')) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_session IS NOT NULL AND v_course IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.class_sessions cs WHERE cs.id=v_session AND v_course=ANY(cs.course_ids)) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF p_operation='resolve' THEN
      SELECT COALESCE(jsonb_agg((to_jsonb(m) - 'user_id') || jsonb_build_object('valid',m.options_signature=v_signature AND
        (m.field_key<>'lesson_id' OR EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=(m.canonical_value#>>'{}')::uuid AND l.course_id=v_course))) ORDER BY m.source_value),'[]') INTO v_value
        FROM public.web_extension_field_mapping_memory m WHERE m.user_id=v_user
        AND m.source_origin='https://corp.orangeapple.co' AND m.adapter_version='orange-apple-v1'
        AND m.field_key=v_key AND (m.scope_key=v_scope OR (v_key<>'lesson_id' AND m.scope_key=''));
      v_rows:=v_rows||v_value;CONTINUE;
    END IF;
    v_source:=v_item->>'source_value';v_value:=v_item->'canonical_value';
    IF v_source IS NULL OR length(v_source) NOT BETWEEN 1 AND 256 OR v_item->>'action' NOT IN ('confirm','clear') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    SELECT * INTO v_memory FROM public.web_extension_field_mapping_memory m WHERE m.user_id=v_user
      AND m.source_origin='https://corp.orangeapple.co' AND m.adapter_version='orange-apple-v1'
      AND m.field_key=v_key AND m.scope_key=v_scope AND m.source_value=v_source FOR UPDATE;
    v_exists:=FOUND;
    IF COALESCE(v_item->>'expected_revision','')<>COALESCE(v_memory.revision::text,'') THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF v_item->>'action'='clear' THEN
      DELETE FROM public.web_extension_field_mapping_memory m WHERE m.user_id=v_user AND m.source_origin='https://corp.orangeapple.co'
        AND m.adapter_version='orange-apple-v1' AND m.field_key=v_key AND m.scope_key=v_scope AND m.source_value=v_source;
      v_rows:=v_rows||jsonb_build_array(jsonb_build_object('field_key',v_key,'source_value',v_source,'cleared',true));CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_options) o WHERE o->>0=v_source AND o->>2='false') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF v_value IS NULL OR v_value='null'::jsonb OR NOT (CASE v_key
      WHEN 'attendance_status' THEN jsonb_typeof(v_value)='string' AND v_value#>>'{}' IN ('present','absent','pending')
      WHEN 'absence_reason' THEN jsonb_typeof(v_value)='string' AND v_value#>>'{}' IN ('busy_with_schoolwork','school_event','family_matter','sick_or_injured','reason_not_provided','travel_abroad','family_ceremony','school_activity','other')
      WHEN 'is_completed' THEN jsonb_typeof(v_value)='boolean'
      WHEN 'class_participation' THEN CASE WHEN jsonb_typeof(v_value)='number' THEN (v_value#>>'{}')::numeric BETWEEN 0 AND 5 AND mod((v_value#>>'{}')::numeric*2,1)=0 ELSE false END
      WHEN 'classroom_behavior' THEN CASE WHEN jsonb_typeof(v_value)='number' THEN (v_value#>>'{}')::numeric BETWEEN 0 AND 5 AND mod((v_value#>>'{}')::numeric*2,1)=0 ELSE false END
      WHEN 'lesson_id' THEN CASE WHEN jsonb_typeof(v_value)='string' AND v_value#>>'{}' ~ '^[a-fA-F0-9-]{36}$' THEN EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=(v_value#>>'{}')::uuid AND l.course_id=v_course) ELSE false END
      ELSE jsonb_typeof(v_value)='string' AND v_value#>>'{}' ~ '^[A-Z]$' END) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    INSERT INTO public.web_extension_field_mapping_memory(user_id,source_origin,adapter_version,field_key,scope_key,course_id,source_value,options_signature,canonical_value)
      VALUES(v_user,'https://corp.orangeapple.co','orange-apple-v1',v_key,v_scope,v_course,v_source,v_signature,v_value)
      ON CONFLICT(user_id,source_origin,adapter_version,field_key,scope_key,source_value) DO UPDATE
      SET options_signature=EXCLUDED.options_signature,canonical_value=EXCLUDED.canonical_value,revision=gen_random_uuid(),updated_at=now()
      RETURNING * INTO v_memory;
    v_rows:=v_rows||jsonb_build_array(to_jsonb(v_memory)-'user_id');
  END LOOP;
  RETURN jsonb_build_object('items',v_rows);
END $$;
CREATE OR REPLACE FUNCTION public.enrollment_history_access(p_operation text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE h public.enrollment_history_reports; o public.class_occurrences; r public.occurrence_reports; v_enrollment public.enrollments;
 b public.enrollment_history_bindings; v_items jsonb:='[]'; v_rows jsonb:='[]'; v_patch jsonb; v_conflicts jsonb;
 v_row jsonb; v_context jsonb; v_id uuid; v_limit integer:=LEAST(50,GREATEST(1,COALESCE((p_input->>'limit')::integer,50)));
 v_cursor date; v_cursor_id uuid; v_scope text; v_fingerprint text; v_report uuid; v_version integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF p_operation='route' THEN
   IF jsonb_typeof(p_input->'dates') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'dates') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
   IF NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.enrollments.read') OR NOT public.can_access_enrollment((p_input->>'enrollment_id')::uuid,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
   SELECT COALESCE(jsonb_agg(x.row ORDER BY x.id),'[]') INTO v_items FROM (
    SELECT o.id,jsonb_build_object('id',o.id,'class_session_id',o.class_session_id,'occurrence_date',o.occurrence_date,'class_name',s.name,'start_time',o.original_start_time,'end_time',o.original_end_time,'enrollment',public.web_extension_target('enrollment',(p_input->>'enrollment_id')::uuid),'report',CASE WHEN public.can_access_report(r.id,'teaching.reports.read') THEN to_jsonb(r)-'user_id' END,'can_write',CASE WHEN r.id IS NULL THEN public.can_create_occurrence_report((p_input->>'enrollment_id')::uuid,o.id) ELSE public.can_access_report(r.id,'teaching.reports.read') AND public.can_mutate_occurrence_report(r.id,'teaching.reports.update') END) row
    FROM public.class_occurrences o JOIN public.class_sessions s ON s.id=o.class_session_id
    LEFT JOIN public.occurrence_reports r ON r.class_occurrence_id=o.id AND r.enrollment_id=(p_input->>'enrollment_id')::uuid
    WHERE o.occurrence_date IN (SELECT value::date FROM jsonb_array_elements_text(p_input->'dates')) AND o.status<>'cancelled'
      AND public.can_access_class_session(s.id,'teaching.occurrences.read') AND public.can_access_class_session(s.id,'teaching.class_sessions.read')
      AND public.history_occurrence_eligible((p_input->>'enrollment_id')::uuid,o.id)
      AND (p_input->>'cursor' IS NULL OR o.id>(p_input->>'cursor')::uuid)
    ORDER BY o.id LIMIT v_limit+1
   ) x;
   RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
 END IF;
 IF p_operation IN ('list','detail') THEN
   IF p_operation='detail' THEN
     SELECT * INTO h FROM public.enrollment_history_reports WHERE id=(p_input->>'id')::uuid;
     IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
     IF NOT public.can_access_enrollment(h.enrollment_id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(h.enrollment_id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
     RETURN to_jsonb(h)-'user_id';
   END IF;
   IF p_input->>'enrollment_id' IS NULL AND p_input->>'student_id' IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
   IF p_input->>'sort'='nearest' THEN
     IF p_input->>'anchor_date' IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
     v_scope:=md5(jsonb_build_array(p_input->>'enrollment_id',p_input->>'student_id',p_input->>'course_id',p_input->>'source_admission_id',p_input->>'unlinked_only',p_input->>'date_from',p_input->>'date_to',p_input->>'anchor_date')::text);
   END IF;
   IF p_input->>'cursor' IS NOT NULL THEN
     IF p_input->>'sort'='nearest' THEN
       IF split_part(p_input->>'cursor','|',1)<>'h1' OR split_part(p_input->>'cursor','|',2)<>v_scope THEN RAISE EXCEPTION 'INVALID_CURSOR'; END IF;
       v_cursor:=split_part(p_input->>'cursor','|',3)::date;v_cursor_id:=split_part(p_input->>'cursor','|',4)::uuid;
     ELSE v_cursor:=split_part(p_input->>'cursor','|',1)::date; v_cursor_id:=split_part(p_input->>'cursor','|',2)::uuid; END IF;
   END IF;
   SELECT COALESCE(jsonb_agg(x.row ORDER BY x.distance,x.nearest_date,x.nearest_id,x.report_date DESC,x.id DESC),'[]') INTO v_items FROM (
     SELECT h.id,h.report_date,CASE WHEN p_input->>'sort'='nearest' THEN abs(h.report_date-(p_input->>'anchor_date')::date) ELSE 0 END distance,CASE WHEN p_input->>'sort'='nearest' THEN h.report_date END nearest_date,CASE WHEN p_input->>'sort'='nearest' THEN h.id END nearest_id,(to_jsonb(h)-'user_id')||jsonb_build_object('kind','history_report','template_only',true,'date_difference',h.report_date-(p_input->>'anchor_date')::date,'student_id',e.student_id,'student_name',s.name,'course_id',e.course_id,'course_name',COALESCE(c.display_name,c.subject),'lesson_name',l.title,'class_name',cs.name) row
     FROM public.enrollment_history_reports h JOIN public.enrollments e ON e.id=h.enrollment_id JOIN public.students s ON s.id=e.student_id JOIN public.courses c ON c.id=e.course_id JOIN public.class_sessions cs ON cs.id=e.class_session_id
     LEFT JOIN public.lessons l ON l.id=h.lesson_id
     WHERE (p_input->>'enrollment_id' IS NULL OR h.enrollment_id=(p_input->>'enrollment_id')::uuid)
       AND (p_input->>'student_id' IS NULL OR e.student_id=(p_input->>'student_id')::uuid)
       AND (p_input->>'course_id' IS NULL OR e.course_id=(p_input->>'course_id')::uuid)
       AND (NOT COALESCE((p_input->>'unlinked_only')::boolean,false) OR h.linked_report_id IS NULL)
       AND (p_input->>'source_admission_id' IS NULL OR h.source_admission_id=p_input->>'source_admission_id')
       AND (p_input->>'date_from' IS NULL OR h.report_date>=(p_input->>'date_from')::date)
       AND (p_input->>'date_to' IS NULL OR h.report_date<=(p_input->>'date_to')::date)
       AND (v_cursor IS NULL OR CASE WHEN p_input->>'sort'='nearest' THEN (abs(h.report_date-(p_input->>'anchor_date')::date),h.report_date,h.id)>(abs(v_cursor-(p_input->>'anchor_date')::date),v_cursor,v_cursor_id) ELSE (h.report_date,h.id)<(v_cursor,v_cursor_id) END)
       AND public.can_access_enrollment(e.id,'teaching.enrollments.read') AND public.can_access_enrollment(e.id,'teaching.reports.read')
       AND public.can_access_student(e.student_id,'teaching.students.read') AND public.can_access_class_session(cs.id,'teaching.class_sessions.read')
     ORDER BY distance,nearest_date,nearest_id,h.report_date DESC,h.id DESC LIMIT v_limit+1
   ) x;
   RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-(v_limit) ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN CASE WHEN v_scope IS NOT NULL THEN 'h1|'||v_scope||'|' ELSE '' END||(v_items->(v_limit-1)->>'report_date')||'|'||(v_items->(v_limit-1)->>'id') END);
 END IF;
 SELECT * INTO h FROM public.enrollment_history_reports WHERE id=(p_input->>'history_id')::uuid FOR UPDATE;
 IF h.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT public.can_access_enrollment(h.enrollment_id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(h.enrollment_id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
 IF p_operation='candidates' THEN
   SELECT COALESCE(jsonb_agg(x.row ORDER BY x.id),'[]') INTO v_items FROM (
    SELECT o.id,jsonb_build_object('id',o.id,'class_session_id',o.class_session_id,'occurrence_date',o.occurrence_date,'class_name',s.name,'start_time',o.original_start_time,'end_time',o.original_end_time) row
    FROM public.class_occurrences o JOIN public.class_sessions s ON s.id=o.class_session_id
    WHERE o.occurrence_date=h.report_date AND o.status<>'cancelled' AND public.can_access_class_session(s.id,'teaching.occurrences.read')
      AND public.history_occurrence_eligible(h.enrollment_id,o.id)
      AND (p_input->>'cursor' IS NULL OR o.id>(p_input->>'cursor')::uuid)
    ORDER BY o.id LIMIT v_limit+1
   ) x;
   RETURN jsonb_build_object('items',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items-v_limit ELSE v_items END,'next_cursor',CASE WHEN jsonb_array_length(v_items)>v_limit THEN v_items->(v_limit-1)->>'id' END);
 END IF;
 IF p_operation NOT IN ('bind-preview','bind-apply') THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
 IF COALESCE((p_input->>'history_version')::integer,0)<1 OR p_input->>'key' IS NULL THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
 IF p_input ? 'include_fields' AND (jsonb_typeof(p_input->'include_fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'include_fields')>11 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'include_fields') f WHERE f NOT IN ('lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'))) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
 SELECT * INTO v_enrollment FROM public.enrollments WHERE id=h.enrollment_id FOR SHARE;
 IF h.lesson_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=h.lesson_id AND course_id=v_enrollment.course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
 -- Replay checks precede mutable version checks. A lost response can safely be recovered.
 v_fingerprint:=md5(p_input::text);
 SELECT * INTO b FROM public.enrollment_history_bindings WHERE user_id=auth.uid() AND operation_key=(p_input->>'key')::uuid FOR UPDATE;
 IF b.operation_key IS NOT NULL AND b.fingerprint<>v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
 IF b.result IS NOT NULL THEN RETURN b.result; END IF;
 SELECT * INTO o FROM public.class_occurrences WHERE id=(p_input->>'class_occurrence_id')::uuid FOR UPDATE;
 IF o.id IS NULL OR o.occurrence_date<>h.report_date OR o.status='cancelled'
   OR NOT public.history_occurrence_eligible(h.enrollment_id,o.id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
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
 FOR v_row IN SELECT jsonb_build_object('key',k,'value',to_jsonb(h)->k) FROM unnest(ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']) k WHERE p_input->'include_fields' IS NULL OR p_input->'include_fields' ? k LOOP
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
 IF v_patch='{}' AND (r.id IS NULL OR (p_input ? 'include_fields' AND jsonb_array_length(p_input->'include_fields')=0)) THEN
   v_context:=jsonb_build_object('history_id',h.id,'status','skipped','classification','skipped','reason','all_fields_excluded');
   UPDATE public.enrollment_history_bindings SET result=v_context WHERE user_id=auth.uid() AND operation_key=(p_input->>'key')::uuid;
   RETURN v_context;
 END IF;
 IF r.id IS NULL THEN
   INSERT INTO public.occurrence_reports(enrollment_id,class_occurrence_id,content,version) VALUES(h.enrollment_id,o.id,'',1) RETURNING * INTO r;
 END IF;
 IF v_patch ? 'content' THEN v_patch:=v_patch||jsonb_build_object('content_document',NULL); END IF;
 IF v_patch ? 'contact_notes' THEN v_patch:=v_patch||jsonb_build_object('contact_notes_document',NULL); END IF;
 IF v_patch ? 'class_notes' THEN v_patch:=v_patch||jsonb_build_object('class_notes_document',NULL); END IF;
 IF v_patch<>'{}' THEN PERFORM public.apply_occurrence_report_lifecycle(r.id,r.version,v_patch,auth.uid(),'update'); END IF;
 UPDATE public.enrollment_history_reports SET linked_report_id=r.id,version=version+1,updated_at=now() WHERE id=h.id;
 v_context:=jsonb_build_object('history_id',h.id,'report_id',r.id,'status','linked','classification',CASE WHEN b.preview->>'report_id' IS NULL THEN 'added' WHEN v_patch='{}' THEN 'unchanged' ELSE 'updated' END,'preserved_fields',COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(v_conflicts) x WHERE NOT COALESCE(p_input->'overwrite','[]') ? (x->>'field')),'[]'));
 UPDATE public.enrollment_history_bindings SET result=v_context WHERE user_id=auth.uid() AND operation_key=(p_input->>'key')::uuid;
 RETURN v_context;
END $$;
REVOKE ALL ON FUNCTION public.enrollment_history_access(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enrollment_history_access(text,jsonb) TO authenticated;
COMMIT;
