BEGIN;

ALTER TABLE public.web_extension_import_batches
  ADD COLUMN IF NOT EXISTS dependency_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.validate_enrollment_history(
  p_data jsonb,
  p_row jsonb,
  p_job public.web_extension_import_jobs,
  p_batch jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  e public.enrollments;
  existing public.enrollment_history_reports;
  v_course_id uuid;
  v_reference jsonb;
BEGIN
  SELECT * INTO e FROM public.enrollments WHERE id=(p_data->>'enrollment_id')::uuid;
  IF e.id IS NULL THEN
    SELECT (x->'record'->'data'->>'course_id')::uuid INTO v_course_id
      FROM jsonb_array_elements(COALESCE(p_batch->'rows','[]'::jsonb)) x
      WHERE x->'record'->>'kind'='enrollment'
        AND x->>'target_id'=p_data->>'enrollment_id'
        AND x->>'source_id'=p_data->>'source_admission_id'
      LIMIT 1;
    IF v_course_id IS NULL THEN
      SELECT (m->>'course_id')::uuid INTO v_course_id
        FROM jsonb_array_elements(COALESCE(p_batch->'dependencies','[]'::jsonb)) d
        JOIN public.web_extension_import_batches b
          ON b.job_id=p_job.id AND b.batch_key=(d->>'key')::uuid
         AND b.fingerprint=d->>'fingerprint' AND b.status IN ('previewed','applied')
        CROSS JOIN LATERAL jsonb_array_elements(b.dependency_manifest) m
        WHERE m->>'target_id'=p_data->>'enrollment_id'
          AND m->>'source_id'=p_data->>'source_admission_id'
        LIMIT 1;
    END IF;
    IF v_course_id IS NULL THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','enrollment_id','reason','ENROLLMENT_REFERENCE_UNVERIFIED');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE', DETAIL=v_reference::text;
    END IF;
    IF p_data ? 'lesson_id' AND NOT EXISTS (
      SELECT 1 FROM public.lessons l WHERE l.id=(p_data->>'lesson_id')::uuid AND l.course_id=v_course_id
    ) THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','lesson_id','reason','LESSON_COURSE_MISMATCH');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE', DETAIL=v_reference::text;
    END IF;
    IF NOT public.has_api_permission(auth.uid(),'teaching.reports.create',p_job.classroom_id,p_job.class_session_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  ELSE
    IF NOT public.can_access_enrollment(e.id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(e.id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.enrollment_history_reports WHERE id=(p_row->>'target_id')::uuid) AND NOT public.can_access_enrollment(e.id,'teaching.reports.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF p_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(p_data->>'lesson_id')::uuid AND course_id=e.course_id) THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','lesson_id','reason','LESSON_COURSE_MISMATCH');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE', DETAIL=v_reference::text;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.web_extension_mapping_memory m WHERE m.user_id=auth.uid() AND m.source_origin=p_job.source_origin AND m.kind='admission' AND m.source_key=p_data->>'source_admission_id' AND m.target_id=e.id AND m.student_id=e.student_id AND m.course_id=e.course_id AND m.class_session_id=e.class_session_id)
      AND NOT EXISTS(SELECT 1 FROM public.web_extension_source_links l WHERE l.user_id=auth.uid() AND l.source_origin=p_job.source_origin AND l.source_kind='enrollment' AND l.source_id=p_data->>'source_admission_id' AND l.edulog_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_batch->'rows','[]'::jsonb)) x WHERE x->'record'->>'kind'='enrollment' AND x->>'target_id'=e.id::text AND x->>'source_id'=p_data->>'source_admission_id') THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
  END IF;
  IF p_data ? 'source_evidence' AND (jsonb_typeof(p_data->'source_evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'source_evidence')>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'source_evidence') f WHERE f->>'source_path' !~ '^/(dt_admissions/[0-9]+(/reports/[0-9]+/edit)?|courses/dt/[0-9]+)$' OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('source_path','table','row','captured_at')))) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF p_data->>'source_origin' IS DISTINCT FROM p_job.source_origin OR (p_data->>'report_date')::date NOT BETWEEN p_job.date_from AND p_job.date_to
    OR jsonb_typeof(p_data->'source_fields') IS DISTINCT FROM 'array' OR jsonb_array_length(p_data->'source_fields')>50
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_data->'source_fields') f WHERE f->>'key' NOT IN ('attendance_status','absence_reason','lesson_id','progress_start','progress_end','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','sourceLessonLabel','progress_letter') OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('key','label','text')))
    OR (p_data->>'identity_status'='evidence_only' AND (p_data->>'source_report_id' IS NOT NULL OR p_data->>'external_link' IS NOT NULL))
    OR (p_data->>'identity_status'='verified' AND (p_data->>'source_report_id' IS NULL OR p_data->>'external_link' IS DISTINCT FROM 'https://corp.orangeapple.co/dt_admissions/'||(p_data->>'source_admission_id')||'/reports/'||(p_data->>'source_report_id')||'/edit')) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  IF EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.enrollment_id=(p_data->>'enrollment_id')::uuid AND h.source_origin=p_data->>'source_origin' AND h.source_admission_id=p_data->>'source_admission_id' AND h.source_key=p_data->>'source_key' AND h.id<>(p_row->>'target_id')::uuid) THEN RAISE EXCEPTION 'SOURCE_MAPPING_CONFLICT'; END IF;
  SELECT * INTO existing FROM public.enrollment_history_reports WHERE id=(p_row->>'target_id')::uuid;
  IF existing.linked_report_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(p_data) d WHERE d.key NOT IN ('source_fields','source_evidence') AND to_jsonb(existing)->d.key IS DISTINCT FROM d.value) THEN RAISE EXCEPTION 'HISTORY_ALREADY_LINKED'; END IF;
  IF existing.id IS NULL AND NOT COALESCE((p_row->>'reviewed_duplicate')::boolean,false)
    AND (EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.enrollment_id=(p_data->>'enrollment_id')::uuid AND h.source_admission_id=p_data->>'source_admission_id' AND h.report_date=(p_data->>'report_date')::date AND (p_data->>'identity_status'='evidence_only' OR h.identity_status='evidence_only'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_batch->'rows','[]'::jsonb)) x WHERE x->'record'->>'kind'='history_report' AND x->>'target_id'<>p_row->>'target_id' AND x->'record'->'data'->>'enrollment_id'=p_data->>'enrollment_id' AND x->'record'->'data'->>'report_date'=p_data->>'report_date' AND (p_data->>'identity_status'='evidence_only' OR x->'record'->'data'->>'identity_status'='evidence_only'))) THEN RAISE EXCEPTION 'HISTORY_IDENTITY_AMBIGUOUS'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.validate_enrollment_history(jsonb,jsonb,public.web_extension_import_jobs,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_import_batch_manifest(
  p_token_id uuid,
  p_token_hash text,
  p_job_id uuid,
  p_batch_key uuid,
  p_fingerprint text,
  p_manifest jsonb,
  p_dependencies jsonb,
  p_action text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_user uuid;
  v_job public.web_extension_import_jobs;
  v_parent public.web_extension_import_batches;
  v_ref jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  SELECT user_id INTO v_user FROM public.web_extension_tokens
    WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT * INTO v_job FROM public.web_extension_import_jobs WHERE id=p_job_id AND user_id=v_user FOR SHARE;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF jsonb_typeof(COALESCE(p_dependencies,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_dependencies,'[]'::jsonb))>50 OR jsonb_typeof(COALESCE(p_manifest,'[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(p_manifest,'[]'::jsonb))>50 THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(COALESCE(p_dependencies,'[]'::jsonb)) LOOP
    SELECT * INTO v_parent FROM public.web_extension_import_batches WHERE job_id=p_job_id AND batch_key=(v_ref->>'key')::uuid FOR SHARE;
    IF v_parent.batch_key IS NULL OR v_parent.fingerprint IS DISTINCT FROM v_ref->>'fingerprint' OR v_parent.status NOT IN ('previewed','applied') OR jsonb_array_length(v_parent.dependency_manifest)=0 THEN RAISE EXCEPTION 'IMPORT_DEPENDENCY_INVALID'; END IF;
    IF p_action='apply-check' AND v_parent.status<>'applied' THEN RAISE EXCEPTION 'IMPORT_DEPENDENCY_PENDING'; END IF;
  END LOOP;
  IF p_action='save' THEN
    PERFORM 1 FROM public.web_extension_import_batches WHERE job_id=p_job_id AND batch_key=p_batch_key AND fingerprint=p_fingerprint AND status='previewed' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
    UPDATE public.web_extension_import_batches SET dependency_manifest=p_manifest WHERE job_id=p_job_id AND batch_key=p_batch_key;
    RETURN jsonb_build_object('status','saved');
  ELSIF p_action='apply-check' THEN
    RETURN jsonb_build_object('status','ready');
  END IF;
  RAISE EXCEPTION 'INVALID_IMPORT';
END $$;
REVOKE ALL ON FUNCTION public.web_extension_import_batch_manifest(uuid,text,uuid,uuid,text,jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_import_batch_manifest(uuid,text,uuid,uuid,text,jsonb,jsonb,text) TO service_role;

COMMIT;
