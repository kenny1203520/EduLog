-- Forward-only hardening for report mutation validation and DELETE replay.
-- The historical 1000040-1000062 files remain unchanged.

DO $$
BEGIN
  IF to_regclass('public.api_idempotency_keys') IS NULL
     OR to_regprocedure('public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000063 prerequisites missing; apply migrations through 1000062 first';
  END IF;
END;
$$;

ALTER TABLE public.api_idempotency_keys
  ADD COLUMN IF NOT EXISTS resource_id uuid,
  ADD COLUMN IF NOT EXISTS teaching_id uuid,
  ADD COLUMN IF NOT EXISTS classroom_id uuid,
  ADD COLUMN IF NOT EXISTS class_session_id uuid,
  ADD COLUMN IF NOT EXISTS permission_key text;

DROP FUNCTION IF EXISTS public.bind_api_idempotency_scope(uuid,text,uuid,uuid,text);
CREATE OR REPLACE FUNCTION public.bind_api_idempotency_scope(
  p_user_id uuid,
  p_key text,
  p_resource_id uuid,
  p_teaching_id uuid,
  p_classroom_id uuid,
  p_class_session_id uuid,
  p_permission_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_resource_id IS NULL OR p_teaching_id IS NULL OR p_permission_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_SCOPE';
  END IF;
  UPDATE public.api_idempotency_keys
  SET resource_id = p_resource_id,
      teaching_id = p_teaching_id,
      classroom_id = p_classroom_id,
      class_session_id = p_class_session_id,
      permission_key = p_permission_key
  WHERE user_id = p_user_id
    AND idempotency_key = p_key
    AND response_status IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IDEMPOTENCY_SCOPE_NOT_RESERVED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.replay_deleted_report_idempotency(
  p_user_id uuid,
  p_key text,
  p_method text,
  p_route text,
  p_resource_id uuid,
  p_permission_key text
) RETURNS TABLE(is_replay boolean, response_status integer, response_body jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.api_idempotency_keys%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  SELECT * INTO v_row
  FROM public.api_idempotency_keys
  WHERE user_id = p_user_id AND idempotency_key = p_key;
  IF NOT FOUND
     OR v_row.method IS DISTINCT FROM p_method
     OR v_row.route IS DISTINCT FROM p_route
     OR v_row.resource_id IS DISTINCT FROM p_resource_id
     OR v_row.permission_key IS DISTINCT FROM p_permission_key
     OR v_row.response_status IS NULL
     OR v_row.teaching_id IS NULL
     OR NOT public.is_teaching_member(v_row.teaching_id, p_user_id)
     OR NOT public.has_teaching_permission(p_user_id, v_row.permission_key, v_row.teaching_id, v_row.classroom_id, v_row.class_session_id) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT true, v_row.response_status, v_row.response_body;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_api_idempotency_scope(uuid,text,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replay_deleted_report_idempotency(uuid,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_api_idempotency_scope(uuid,text,uuid,uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replay_deleted_report_idempotency(uuid,text,text,text,uuid,text) TO service_role;

-- Keep the original implementation private and expose a validating wrapper at
-- the same signature. This prevents a JWT caller from bypassing REST/Zod
-- bounds by invoking the SECURITY DEFINER lifecycle function directly.
DO $$
BEGIN
  IF to_regprocedure('public.apply_occurrence_report_lifecycle_unvalidated(uuid,integer,jsonb,uuid,text)') IS NULL THEN
    ALTER FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)
      RENAME TO apply_occurrence_report_lifecycle_unvalidated;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_occurrence_report_lifecycle(
  p_report_id uuid,
  p_expected_version integer,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_actor uuid DEFAULT auth.uid(),
  p_operation text DEFAULT 'update'
) RETURNS public.occurrence_reports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_report public.occurrence_reports%ROWTYPE;
  v_key text;
  v_value jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_operation NOT IN ('update', 'delete') THEN
    RAISE EXCEPTION 'INVALID_OPERATION';
  END IF;
  IF p_operation = 'delete' AND p_patch <> '{}'::jsonb THEN
    RAISE EXCEPTION 'INVALID_DELETE_PATCH';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) LOOP
    IF v_key NOT IN (
      'lesson_id', 'is_completed', 'progress_letter', 'attendance_status',
      'absence_reason', 'class_participation', 'classroom_behavior',
      'contact_notes', 'contact_notes_document', 'class_notes',
      'class_notes_document', 'content', 'content_document', 'external_link'
    ) THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH_FIELD';
    END IF;
  END LOOP;

  IF p_patch ? 'lesson_id' AND p_patch->'lesson_id' <> 'null'::jsonb
     AND (jsonb_typeof(p_patch->'lesson_id') <> 'string'
          OR p_patch->>'lesson_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_patch ? 'is_completed' AND jsonb_typeof(p_patch->'is_completed') <> 'boolean' THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_patch ? 'attendance_status'
     AND (jsonb_typeof(p_patch->'attendance_status') <> 'string'
          OR p_patch->>'attendance_status' NOT IN ('present', 'absent', 'pending')) THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_patch ? 'progress_letter' AND p_patch->'progress_letter' <> 'null'::jsonb
     AND (jsonb_typeof(p_patch->'progress_letter') <> 'string'
          OR length(p_patch->>'progress_letter') > 32
          OR p_patch->>'progress_letter' !~ '^[A-Z](-[A-Z])?$') THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_patch ? 'absence_reason' AND p_patch->'absence_reason' <> 'null'::jsonb
     AND (jsonb_typeof(p_patch->'absence_reason') <> 'string' OR length(p_patch->>'absence_reason') > 64) THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  IF p_patch ? 'external_link' AND p_patch->'external_link' <> 'null'::jsonb
     AND (jsonb_typeof(p_patch->'external_link') <> 'string' OR length(p_patch->>'external_link') > 2048) THEN
    RAISE EXCEPTION 'INVALID_REPORT_PATCH';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['contact_notes', 'class_notes', 'content'] LOOP
    IF p_patch ? v_key AND p_patch->v_key <> 'null'::jsonb
       AND (jsonb_typeof(p_patch->v_key) <> 'string' OR length(p_patch->>v_key) > 10000) THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['contact_notes_document', 'class_notes_document', 'content_document'] LOOP
    IF p_patch ? v_key AND p_patch->v_key <> 'null'::jsonb
       AND jsonb_typeof(p_patch->v_key) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['class_participation', 'classroom_behavior'] LOOP
    IF p_patch ? v_key AND p_patch->v_key <> 'null'::jsonb
       AND (jsonb_typeof(p_patch->v_key) <> 'number'
            OR (p_patch->>v_key)::numeric < 0 OR (p_patch->>v_key)::numeric > 5) THEN
      RAISE EXCEPTION 'INVALID_REPORT_PATCH';
    END IF;
  END LOOP;

  SELECT * INTO v_report
  FROM public.apply_occurrence_report_lifecycle_unvalidated(
    p_report_id, p_expected_version, COALESCE(p_patch, '{}'::jsonb), p_actor, p_operation
  );
  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle_unvalidated(uuid,integer,jsonb,uuid,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text) TO authenticated, service_role;
