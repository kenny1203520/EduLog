BEGIN;

-- Keep the deployed import implementation intact and wrap its preview/apply in
-- one transaction so history and an occurrence report commit or roll back as
-- a unit. The optional metadata lives beside the strict history payload.
ALTER FUNCTION public.web_extension_workspace(uuid,text,text,jsonb)
  RENAME TO web_extension_workspace_before_history_reconciliation;

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
  v_same_link boolean := false;
BEGIN
  SELECT * INTO e FROM public.enrollments WHERE id=(p_data->>'enrollment_id')::uuid;
  IF e.id IS NULL THEN
    SELECT (x->'record'->'data'->>'course_id')::uuid INTO v_course_id
      FROM jsonb_array_elements(COALESCE(p_batch->'rows','[]'::jsonb)) x
      WHERE x->'record'->>'kind'='enrollment' AND x->>'target_id'=p_data->>'enrollment_id'
        AND x->>'source_id'=p_data->>'source_admission_id' LIMIT 1;
    IF v_course_id IS NULL THEN
      SELECT (m->>'course_id')::uuid INTO v_course_id
        FROM jsonb_array_elements(COALESCE(p_batch->'dependencies','[]'::jsonb)) d
        JOIN public.web_extension_import_batches b ON b.job_id=p_job.id AND b.batch_key=(d->>'key')::uuid
          AND b.fingerprint=d->>'fingerprint' AND b.status IN ('previewed','applied')
        CROSS JOIN LATERAL jsonb_array_elements(b.dependency_manifest) m
        WHERE m->>'target_id'=p_data->>'enrollment_id' AND m->>'source_id'=p_data->>'source_admission_id' LIMIT 1;
    END IF;
    IF v_course_id IS NULL THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','enrollment_id','reason','ENROLLMENT_REFERENCE_UNVERIFIED');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE',DETAIL=v_reference::text;
    END IF;
    IF p_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=(p_data->>'lesson_id')::uuid AND l.course_id=v_course_id) THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','lesson_id','reason','LESSON_COURSE_MISMATCH');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE',DETAIL=v_reference::text;
    END IF;
    IF NOT public.has_api_permission(auth.uid(),'teaching.reports.create',p_job.classroom_id,p_job.class_session_id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
  ELSE
    IF NOT public.can_access_enrollment(e.id,'teaching.enrollments.read') OR NOT public.can_access_enrollment(e.id,'teaching.reports.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.enrollment_history_reports WHERE id=(p_row->>'target_id')::uuid) AND NOT public.can_access_enrollment(e.id,'teaching.reports.create') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF p_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(p_data->>'lesson_id')::uuid AND course_id=e.course_id) THEN
      v_reference:=jsonb_build_object('kind',p_row->'record'->>'kind','source_id',p_row->>'source_id','field','lesson_id','reason','LESSON_COURSE_MISMATCH');
      RAISE EXCEPTION USING MESSAGE='INVALID_REFERENCE',DETAIL=v_reference::text;
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
  IF existing.linked_report_id IS NOT NULL AND p_row ? 'history_reconciliation' THEN
    v_same_link:=EXISTS(SELECT 1 FROM public.occurrence_reports r WHERE r.id=existing.linked_report_id AND r.enrollment_id=existing.enrollment_id AND r.class_occurrence_id=(p_row->'history_reconciliation'->>'class_occurrence_id')::uuid);
  END IF;
  IF existing.linked_report_id IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_each(p_data) d WHERE d.key NOT IN ('source_fields','source_evidence') AND to_jsonb(existing)->d.key IS DISTINCT FROM d.value) AND NOT v_same_link THEN
    RAISE EXCEPTION 'HISTORY_ALREADY_LINKED';
  END IF;
  IF existing.id IS NULL AND NOT COALESCE((p_row->>'reviewed_duplicate')::boolean,false)
    AND (EXISTS(SELECT 1 FROM public.enrollment_history_reports h WHERE h.enrollment_id=(p_data->>'enrollment_id')::uuid AND h.source_admission_id=p_data->>'source_admission_id' AND h.report_date=(p_data->>'report_date')::date AND (p_data->>'identity_status'='evidence_only' OR h.identity_status='evidence_only'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_batch->'rows','[]'::jsonb)) x WHERE x->'record'->>'kind'='history_report' AND x->>'target_id'<>p_row->>'target_id' AND x->'record'->'data'->>'enrollment_id'=p_data->>'enrollment_id' AND x->'record'->'data'->>'report_date'=p_data->>'report_date' AND (p_data->>'identity_status'='evidence_only' OR x->'record'->'data'->>'identity_status'='evidence_only'))) THEN RAISE EXCEPTION 'HISTORY_IDENTITY_AMBIGUOUS'; END IF;
END $$;

CREATE FUNCTION public.web_extension_workspace(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_result jsonb; v_job public.web_extension_import_jobs; v_batch public.web_extension_import_batches;
  v_row jsonb; v_data jsonb; v_meta jsonb; v_enrollment public.enrollments;
  v_occurrence public.class_occurrences; v_report public.occurrence_reports; v_history public.enrollment_history_reports;
  v_patch jsonb; v_value jsonb; v_field text; v_expected text; v_actual text;
  v_rows jsonb:='[]'::jsonb; v_reconciliations jsonb:='[]'::jsonb; v_reconciliation jsonb;
  v_allowed text[]:=ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'];
  v_source_id text; v_version_key text; v_previous_status text;
BEGIN
  IF p_operation NOT IN ('preview','apply') OR jsonb_typeof(p_input->'rows') IS DISTINCT FROM 'array' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_input->'rows') x WHERE x ? 'history_reconciliation') THEN
    RETURN public.web_extension_workspace_before_history_reconciliation(p_token_id,p_token_hash,p_operation,p_input);
  END IF;

  SELECT * INTO v_job FROM public.web_extension_import_jobs WHERE id=(p_input->>'job_id')::uuid;
  SELECT * INTO v_batch FROM public.web_extension_import_batches WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;
  v_previous_status:=v_batch.status;
  v_result:=public.web_extension_workspace_before_history_reconciliation(p_token_id,p_token_hash,p_operation,p_input);
  -- An applied key is returned idempotently by the legacy function. Its result
  -- already contains the reconciliation receipt from the first application.
  IF v_previous_status='applied' THEN RETURN v_result; END IF;
  SELECT * INTO v_batch FROM public.web_extension_import_batches WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid FOR UPDATE;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
    IF NOT v_row ? 'history_reconciliation' THEN
      IF p_operation='preview' THEN v_rows:=v_rows||jsonb_build_array((SELECT value FROM jsonb_array_elements(v_result->'rows') WHERE value->>'source_id'=v_row->>'source_id' LIMIT 1)); END IF;
      CONTINUE;
    END IF;
    IF v_row->'record'->>'kind'<>'history_report' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    v_meta:=v_row->'history_reconciliation';v_data:=v_row->'record'->'data';v_source_id:=v_row->>'source_id';
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_meta) k WHERE k NOT IN ('key','class_occurrence_id','include_fields','overwrite','include_internal'))
      OR jsonb_typeof(v_meta->'include_fields') IS DISTINCT FROM 'array' OR jsonb_typeof(v_meta->'overwrite') IS DISTINCT FROM 'array'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_meta->'include_fields') f WHERE NOT f=ANY(v_allowed))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_meta->'overwrite') f WHERE NOT f=ANY(v_allowed)) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
    SELECT * INTO v_enrollment FROM public.enrollments WHERE id=(v_data->>'enrollment_id')::uuid;
    SELECT * INTO v_occurrence FROM public.class_occurrences WHERE id=(v_meta->>'class_occurrence_id')::uuid;
    IF v_enrollment.id IS NULL OR v_occurrence.id IS NULL OR v_occurrence.occurrence_date<>(v_data->>'report_date')::date OR v_occurrence.status='cancelled'
      OR NOT public.history_occurrence_eligible(v_enrollment.id,v_occurrence.id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    IF NOT public.can_access_enrollment(v_enrollment.id,'teaching.enrollments.read') OR NOT public.can_access_class_session(v_occurrence.class_session_id,'teaching.occurrences.read') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    IF v_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(v_data->>'lesson_id')::uuid AND course_id=v_enrollment.course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
    SELECT * INTO v_history FROM public.enrollment_history_reports WHERE id=(v_row->>'target_id')::uuid;
    SELECT * INTO v_report FROM public.occurrence_reports WHERE enrollment_id=v_enrollment.id AND class_occurrence_id=v_occurrence.id;
    IF v_history.linked_report_id IS NOT NULL AND v_history.linked_report_id IS DISTINCT FROM v_report.id THEN RAISE EXCEPTION 'HISTORY_ALREADY_LINKED'; END IF;
    IF v_report.id IS NULL THEN
      IF NOT public.can_create_occurrence_report(v_enrollment.id,v_occurrence.id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    ELSIF NOT public.can_access_report(v_report.id,'teaching.reports.read') OR NOT public.can_mutate_occurrence_report(v_report.id,'teaching.reports.update') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
    v_patch:='{}'::jsonb;v_reconciliation:='[]'::jsonb;
    FOR v_field IN SELECT jsonb_array_elements_text(v_meta->'include_fields') LOOP
      IF v_field='class_notes' AND NOT COALESCE((v_meta->>'include_internal')::boolean,false) THEN CONTINUE; END IF;
      IF NOT v_data ? v_field THEN CONTINUE; END IF;
      v_value:=v_data->v_field;
      IF v_report.id IS NOT NULL AND to_jsonb(v_report)->v_field IS DISTINCT FROM v_value AND to_jsonb(v_report)->v_field IS NOT NULL AND to_jsonb(v_report)->>v_field<>'' AND NOT COALESCE(v_meta->'overwrite' ? v_field,false) THEN
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status','preserved'));
      ELSE
        v_patch:=v_patch||jsonb_build_object(v_field,v_value);
        v_reconciliation:=v_reconciliation||jsonb_build_array(jsonb_build_object('field',v_field,'status',CASE WHEN v_report.id IS NULL OR to_jsonb(v_report)->v_field IS DISTINCT FROM v_value THEN 'updated' ELSE 'unchanged' END));
      END IF;
    END LOOP;
    v_version_key:='history_reconciliation:'||v_source_id;
    v_actual:=CASE WHEN v_report.id IS NULL THEN 'new' ELSE v_report.id::text||':'||v_report.version::text END;
    IF p_operation='preview' THEN
      v_batch.target_versions:=jsonb_set(COALESCE(v_batch.target_versions,'{}'::jsonb),ARRAY[v_version_key],to_jsonb(v_actual),true);
      UPDATE public.web_extension_import_batches SET target_versions=v_batch.target_versions WHERE job_id=v_batch.job_id AND batch_key=v_batch.batch_key;
      v_rows:=v_rows||jsonb_build_array((SELECT value||jsonb_build_object('history_reconciliation',jsonb_build_object('occurrence_id',v_occurrence.id,'report_id',v_report.id,'report_version',v_report.version,'changes',v_reconciliation)) FROM jsonb_array_elements(v_result->'rows') WHERE value->>'source_id'=v_source_id LIMIT 1));
    ELSE
      v_expected:=v_batch.target_versions->>v_version_key;
      IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;
      IF v_report.id IS NULL AND v_patch<>'{}'::jsonb THEN
        INSERT INTO public.occurrence_reports(enrollment_id,class_occurrence_id,content,version) VALUES(v_enrollment.id,v_occurrence.id,'',1) RETURNING * INTO v_report;
      END IF;
      IF v_report.id IS NOT NULL AND v_patch<>'{}'::jsonb THEN
        IF v_patch ? 'content' THEN v_patch:=v_patch||jsonb_build_object('content_document',NULL); END IF;
        IF v_patch ? 'contact_notes' THEN v_patch:=v_patch||jsonb_build_object('contact_notes_document',NULL); END IF;
        IF v_patch ? 'class_notes' THEN v_patch:=v_patch||jsonb_build_object('class_notes_document',NULL); END IF;
        PERFORM public.apply_occurrence_report_lifecycle(v_report.id,v_report.version,v_patch,auth.uid(),'update');
      END IF;
      IF v_report.id IS NOT NULL THEN
        UPDATE public.enrollment_history_reports SET linked_report_id=v_report.id,version=CASE WHEN linked_report_id IS NULL THEN version+1 ELSE version END,updated_at=now() WHERE id=(v_row->>'target_id')::uuid;
      END IF;
      v_reconciliations:=v_reconciliations||jsonb_build_array(jsonb_build_object('source_id',v_source_id,'history_id',v_row->>'target_id','report_id',v_report.id,'status',CASE WHEN v_report.id IS NULL THEN 'saved_history_only' ELSE 'linked' END,'changes',v_reconciliation));
    END IF;
  END LOOP;
  IF p_operation='preview' THEN RETURN jsonb_set(v_result,'{rows}',v_rows,true); END IF;
  v_result:=v_result||jsonb_build_object('history_reconciliations',v_reconciliations);
  UPDATE public.web_extension_import_batches SET result=v_result WHERE job_id=v_batch.job_id AND batch_key=v_batch.batch_key;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;
COMMIT;
