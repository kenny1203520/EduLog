-- Confirmed field semantics are separate from identity memories and raw evidence.
BEGIN;
CREATE TABLE public.web_extension_field_mapping_memory (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_origin text NOT NULL CHECK(source_origin='https://corp.orangeapple.co'),
  adapter_version text NOT NULL CHECK(adapter_version='orange-apple-v1'),
  field_key text NOT NULL CHECK(field_key IN ('attendance_status','absence_reason','is_completed','class_participation','classroom_behavior','lesson_id','progress_start','progress_end')),
  scope_key text NOT NULL DEFAULT '', course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,
  source_value text NOT NULL CHECK(length(source_value) BETWEEN 1 AND 256),
  options_signature text NOT NULL CHECK(length(options_signature) BETWEEN 2 AND 16000),
  canonical_value jsonb NOT NULL,
  revision uuid NOT NULL DEFAULT gen_random_uuid(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,source_origin,adapter_version,field_key,scope_key,source_value),
  CHECK(scope_key=COALESCE(course_id::text,''))
);
ALTER TABLE public.web_extension_field_mapping_memory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_extension_field_mapping_memory FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_field_mappings(p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb) RETURNS jsonb
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
  IF p_operation='capabilities' THEN RETURN jsonb_build_object('field_mapping_memory',true); END IF;
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
      OR (v_key IN ('lesson_id','progress_start','progress_end') AND v_course IS NULL) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
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
        AND m.field_key=v_key AND m.scope_key=v_scope;
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
REVOKE ALL ON FUNCTION public.web_extension_field_mappings(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.web_extension_field_mappings(uuid,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
