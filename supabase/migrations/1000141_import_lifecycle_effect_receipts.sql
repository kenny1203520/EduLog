BEGIN;

-- Track only report rows actually created by an import transaction. This is
-- deliberately private to the definer functions: clients cannot manufacture
-- provenance from a version number, blank report, or timestamp.
CREATE TABLE public.web_extension_import_report_effects (
  job_id uuid NOT NULL,
  batch_key uuid NOT NULL,
  enrollment_id uuid NOT NULL REFERENCES public.enrollments(id) ON DELETE CASCADE,
  class_occurrence_id uuid NOT NULL REFERENCES public.class_occurrences(id) ON DELETE CASCADE,
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  report_snapshot jsonb NOT NULL,
  enrollment_snapshot jsonb NOT NULL,
  occurrence_snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, enrollment_id, class_occurrence_id),
  FOREIGN KEY (job_id, batch_key)
    REFERENCES public.web_extension_import_batches(job_id, batch_key) ON DELETE CASCADE
);
ALTER TABLE public.web_extension_import_report_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_extension_import_report_effects FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.capture_web_extension_import_report_effect(
  p_job_id uuid, p_batch_key uuid, p_report_id uuid, p_inserted boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_report public.occurrence_reports;
  v_enrollment public.enrollments;
  v_occurrence public.class_occurrences;
BEGIN
  IF auth.uid() IS NULL
     OR current_setting('edulog.import_job_id',true) IS DISTINCT FROM p_job_id::text
     OR current_setting('edulog.import_batch_key',true) IS DISTINCT FROM p_batch_key::text
     OR NOT EXISTS (
       SELECT 1 FROM public.web_extension_import_jobs j
       JOIN public.web_extension_import_batches b ON b.job_id=j.id AND b.batch_key=p_batch_key
       WHERE j.id=p_job_id AND j.user_id=auth.uid() AND b.status='applied'
     ) THEN
    RAISE EXCEPTION 'IMPORT_EFFECT_CONTEXT_INVALID';
  END IF;
  SELECT * INTO v_report FROM public.occurrence_reports WHERE id=p_report_id;
  IF v_report.id IS NULL THEN RAISE EXCEPTION 'IMPORT_EFFECT_REPORT_MISSING'; END IF;
  SELECT * INTO v_enrollment FROM public.enrollments WHERE id=v_report.enrollment_id;
  SELECT * INTO v_occurrence FROM public.class_occurrences WHERE id=v_report.class_occurrence_id;
  IF v_enrollment.id IS NULL OR v_occurrence.id IS NULL THEN RAISE EXCEPTION 'IMPORT_EFFECT_RELATION_MISSING'; END IF;

  IF p_inserted THEN
    INSERT INTO public.web_extension_import_report_effects(
      job_id,batch_key,enrollment_id,class_occurrence_id,report_id,report_version,
      report_snapshot,enrollment_snapshot,occurrence_snapshot
    ) VALUES (
      p_job_id,p_batch_key,v_report.enrollment_id,v_report.class_occurrence_id,
      v_report.id,v_report.version,to_jsonb(v_report),to_jsonb(v_enrollment),to_jsonb(v_occurrence)
    )
    ON CONFLICT (job_id,enrollment_id,class_occurrence_id) DO UPDATE SET
      batch_key=EXCLUDED.batch_key,report_id=EXCLUDED.report_id,
      report_version=EXCLUDED.report_version,report_snapshot=EXCLUDED.report_snapshot,
      enrollment_snapshot=EXCLUDED.enrollment_snapshot,occurrence_snapshot=EXCLUDED.occurrence_snapshot,
      updated_at=now();
  ELSE
    UPDATE public.web_extension_import_report_effects SET
      batch_key=p_batch_key,report_version=v_report.version,
      report_snapshot=to_jsonb(v_report),enrollment_snapshot=to_jsonb(v_enrollment),
      occurrence_snapshot=to_jsonb(v_occurrence),updated_at=now()
    WHERE job_id=p_job_id AND enrollment_id=v_report.enrollment_id
      AND class_occurrence_id=v_report.class_occurrence_id AND report_id=v_report.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.capture_web_extension_import_report_effect(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.web_extension_import_report_effect_matches(
  p_job_id uuid,p_enrollment_id uuid,p_occurrence_id uuid,p_report_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.web_extension_import_report_effects effect
    JOIN public.web_extension_import_batches batch
      ON batch.job_id=effect.job_id AND batch.batch_key=effect.batch_key AND batch.status='applied'
    JOIN public.occurrence_reports report ON report.id=effect.report_id
    JOIN public.enrollments enrollment ON enrollment.id=effect.enrollment_id
    JOIN public.class_occurrences occurrence ON occurrence.id=effect.class_occurrence_id
    WHERE effect.job_id=p_job_id AND effect.enrollment_id=p_enrollment_id
      AND effect.class_occurrence_id=p_occurrence_id AND effect.report_id=p_report_id
      AND effect.report_version=report.version
      AND effect.report_snapshot=to_jsonb(report)
      AND effect.enrollment_snapshot=to_jsonb(enrollment)
      AND effect.occurrence_snapshot=to_jsonb(occurrence)
  );
$$;
REVOKE ALL ON FUNCTION public.web_extension_import_report_effect_matches(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Capture the actual INSERT ... RETURNING row in the native lifecycle path.
-- This preserves the normal next-report provisioning behavior while giving
-- imports trustworthy evidence for the row they caused to be provisioned.
DO $migration$
DECLARE
  v_definition text;
  v_old_declaration text := $old$  v_report public.occurrence_reports%ROWTYPE;$old$;
  v_new_declaration text := $new$  v_report public.occurrence_reports%ROWTYPE;
  v_created_report public.occurrence_reports%ROWTYPE;$new$;
  v_old_insert text := $old$ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;$old$;
  v_new_insert text := $new$ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING
        RETURNING * INTO v_created_report;
        IF FOUND AND NULLIF(current_setting('edulog.import_job_id',true),'') IS NOT NULL THEN
          PERFORM public.capture_web_extension_import_report_effect(
            current_setting('edulog.import_job_id',true)::uuid,
            current_setting('edulog.import_batch_key',true)::uuid,
            v_created_report.id,true
          );
        END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.apply_occurrence_report_lifecycle_unvalidated(uuid,integer,jsonb,uuid,text)'::regprocedure)
    INTO v_definition;
  IF position(v_old_declaration IN v_definition)=0 OR position(v_old_insert IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_LIFECYCLE_EFFECT_PATCH_FAILED declaration %, insert %',position(v_old_declaration IN v_definition),position(v_old_insert IN v_definition);
  END IF;
  v_definition:=replace(v_definition,v_old_declaration,v_new_declaration);
  v_definition:=replace(v_definition,v_old_insert,v_new_insert);
  IF position('v_created_report' IN v_definition)=0 OR position('capture_web_extension_import_report_effect' IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_LIFECYCLE_EFFECT_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- Validate all reconciled report targets and versions before the delegated
-- import writes any history rows. A "new" target may already exist only when
-- a same-job applied batch has an exact, unchanged insertion receipt.
DO $migration$
DECLARE
  v_definition text;
  v_old_declaration text := $old$  v_source_id text; v_version_key text; v_previous_status text;$old$;
  v_new_declaration text := $new$  v_source_id text; v_version_key text; v_previous_status text;
  v_user uuid;
  v_check_row jsonb; v_check_data jsonb; v_check_meta jsonb;
  v_check_enrollment public.enrollments; v_check_occurrence public.class_occurrences;
  v_check_report public.occurrence_reports; v_check_history public.enrollment_history_reports;
  v_check_expected text; v_check_actual text;$new$;
  v_old_delegate text := $old$  v_result:=public.web_extension_workspace_before_history_reconciliation(p_token_id,p_token_hash,p_operation,p_input);$old$;
  v_new_delegate text := $new$  IF p_operation='apply' AND v_previous_status IS DISTINCT FROM 'applied' THEN
    SELECT user_id INTO v_user FROM public.web_extension_tokens
      WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now();
    IF v_user IS NULL THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    SELECT * INTO v_job FROM public.web_extension_import_jobs WHERE id=v_job.id FOR UPDATE;
    SELECT * INTO v_batch FROM public.web_extension_import_batches WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid FOR UPDATE;
    FOR v_check_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
      IF NOT v_check_row ? 'history_reconciliation' THEN CONTINUE; END IF;
      IF v_check_row->'record'->>'kind'<>'history_report' THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      v_check_meta:=v_check_row->'history_reconciliation';v_check_data:=v_check_row->'record'->'data';
      IF EXISTS(SELECT 1 FROM jsonb_object_keys(v_check_meta) k WHERE k NOT IN ('key','class_occurrence_id','include_fields','overwrite','include_internal'))
        OR jsonb_typeof(v_check_meta->'include_fields') IS DISTINCT FROM 'array'
        OR jsonb_typeof(v_check_meta->'overwrite') IS DISTINCT FROM 'array'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_check_meta->'include_fields') f WHERE NOT f=ANY(ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']))
        OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_check_meta->'overwrite') f WHERE NOT f=ANY(ARRAY['lesson_id','is_completed','progress_letter','attendance_status','absence_reason','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link'])) THEN RAISE EXCEPTION 'INVALID_IMPORT'; END IF;
      SELECT * INTO v_check_enrollment FROM public.enrollments WHERE id=(v_check_data->>'enrollment_id')::uuid FOR UPDATE;
      SELECT * INTO v_check_occurrence FROM public.class_occurrences WHERE id=(v_check_meta->>'class_occurrence_id')::uuid FOR KEY SHARE;
      IF v_check_enrollment.id IS NULL OR v_check_occurrence.id IS NULL
        OR v_check_occurrence.occurrence_date<>(v_check_data->>'report_date')::date
        OR v_check_occurrence.status='cancelled'
        OR NOT public.history_occurrence_eligible(v_check_enrollment.id,v_check_occurrence.id)
        OR NOT public.can_access_enrollment(v_check_enrollment.id,'teaching.enrollments.read')
        OR NOT public.can_access_class_session(v_check_occurrence.class_session_id,'teaching.occurrences.read') THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      IF v_check_data ? 'lesson_id' AND NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(v_check_data->>'lesson_id')::uuid AND course_id=v_check_enrollment.course_id) THEN RAISE EXCEPTION 'INVALID_REFERENCE'; END IF;
      SELECT * INTO v_check_history FROM public.enrollment_history_reports WHERE id=(v_check_row->>'target_id')::uuid FOR UPDATE;
      SELECT * INTO v_check_report FROM public.occurrence_reports WHERE enrollment_id=v_check_enrollment.id AND class_occurrence_id=v_check_occurrence.id FOR UPDATE;
      IF v_check_history.linked_report_id IS NOT NULL AND v_check_history.linked_report_id IS DISTINCT FROM v_check_report.id THEN RAISE EXCEPTION 'HISTORY_ALREADY_LINKED'; END IF;
      IF v_check_report.id IS NULL THEN
        IF NOT public.can_create_occurrence_report(v_check_enrollment.id,v_check_occurrence.id) THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      ELSIF NOT public.can_access_report(v_check_report.id,'teaching.reports.read') OR NOT public.can_mutate_occurrence_report(v_check_report.id,'teaching.reports.update') THEN RAISE EXCEPTION 'PERMISSION_DENIED'; END IF;
      v_version_key:='history_reconciliation:'||(v_check_row->>'source_id');
      v_check_expected:=v_batch.target_versions->>v_version_key;
      v_check_actual:=CASE WHEN v_check_report.id IS NULL THEN 'new' ELSE v_check_report.id::text||':'||v_check_report.version::text END;
      IF v_check_expected IS NULL
        OR (v_check_expected='new' AND v_check_report.id IS NOT NULL AND NOT public.web_extension_import_report_effect_matches(v_job.id,v_check_enrollment.id,v_check_occurrence.id,v_check_report.id))
        OR (v_check_expected<>'new' AND v_check_expected IS DISTINCT FROM v_check_actual) THEN
        RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
          'diagnostic_source','version_check','kind','history_report','source_id',v_check_row->>'source_id',
          'field','occurrence_report_version','reason','OCCURRENCE_REPORT_VERSION_CHANGED',
          'expected_version',v_check_expected,'actual_version',v_check_actual
        )::text;
      END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','service_role')::text,true);
    PERFORM set_config('request.jwt.claim.role','service_role',true);
  END IF;
  v_result:=public.web_extension_workspace_before_history_reconciliation(p_token_id,p_token_hash,p_operation,p_input);$new$;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old_declaration IN v_definition)=0 OR position(v_old_delegate IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_RECONCILIATION_PREFLIGHT_PATCH_FAILED';
  END IF;
  v_definition:=replace(v_definition,v_old_declaration,v_new_declaration);
  v_definition:=replace(v_definition,v_old_delegate,v_new_delegate);
  IF position('web_extension_import_report_effect_matches' IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_RECONCILIATION_PREFLIGHT_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- The preflight above protects the original preview expectation. During the
-- apply loop accept only a same-job effect receipt whose full snapshots still
-- match; this covers both same-batch and earlier-batch next-report creation.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual THEN$old$;
  v_new text := $new$IF v_expected IS NULL
        OR (v_expected='new' AND v_report.id IS NOT NULL AND NOT public.web_extension_import_report_effect_matches(v_job.id,v_enrollment.id,v_occurrence.id,v_report.id))
        OR (v_expected<>'new' AND v_expected IS DISTINCT FROM v_actual) THEN$new$;
  v_old_loop text := $old$  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP$old$;
  v_new_loop text := $new$  IF p_operation='apply' THEN
    PERFORM set_config('edulog.import_job_id',v_job.id::text,true);
    PERFORM set_config('edulog.import_batch_key',(p_input->>'key'),true);
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP$new$;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition)=0 OR position(v_old_loop IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_RECONCILIATION_EFFECT_PATCH_FAILED check %, loop %',position(v_old IN v_definition),position(v_old_loop IN v_definition);
  END IF;
  v_definition:=replace(v_definition,v_old,v_new);
  v_definition:=replace(v_definition,v_old_loop,v_new_loop);
  EXECUTE v_definition;
END
$migration$;

-- Record inserts made directly by reconciliation and refresh a receipt after
-- this same import updates a report it previously created.
DO $migration$
DECLARE
  v_definition text;
  v_old_insert text := $old$        INSERT INTO public.occurrence_reports(enrollment_id,class_occurrence_id,content,version) VALUES(v_enrollment.id,v_occurrence.id,'',1) RETURNING * INTO v_report;$old$;
  v_new_insert text := $new$        INSERT INTO public.occurrence_reports(enrollment_id,class_occurrence_id,content,version) VALUES(v_enrollment.id,v_occurrence.id,'',1) RETURNING * INTO v_report;
        PERFORM public.capture_web_extension_import_report_effect(v_job.id,(p_input->>'key')::uuid,v_report.id,true);$new$;
  v_old_update text := $old$        PERFORM public.apply_occurrence_report_lifecycle(v_report.id,v_report.version,v_patch,auth.uid(),'update');$old$;
  v_new_update text := $new$        v_report:=public.apply_occurrence_report_lifecycle(v_report.id,v_report.version,v_patch,auth.uid(),'update');
        PERFORM public.capture_web_extension_import_report_effect(v_job.id,(p_input->>'key')::uuid,v_report.id,false);$new$;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old_insert IN v_definition)=0 OR position(v_old_update IN v_definition)=0 THEN
    RAISE EXCEPTION 'IMPORT_RECONCILIATION_EFFECT_PATCH_FAILED insert %, update %',position(v_old_insert IN v_definition),position(v_old_update IN v_definition);
  END IF;
  v_definition:=replace(v_definition,v_old_insert,v_new_insert);
  v_definition:=replace(v_definition,v_old_update,v_new_update);
  EXECUTE v_definition;
END
$migration$;

COMMENT ON TABLE public.web_extension_import_report_effects IS
  'Private transactional receipts for occurrence reports actually created or subsequently updated by an extension import job.';
NOTIFY pgrst,'reload schema';
COMMIT;
