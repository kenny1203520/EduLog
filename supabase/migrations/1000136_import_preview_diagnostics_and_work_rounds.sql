BEGIN;

-- Keep immutable server import jobs attached to one local work record. A later
-- submission round gets a new job while the local work identity stays stable.
CREATE TABLE public.web_extension_work_record_rounds (
  user_id uuid NOT NULL,
  work_id uuid NOT NULL,
  round_no integer NOT NULL CHECK (round_no BETWEEN 1 AND 1000),
  job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_id, round_no),
  UNIQUE (user_id, job_id),
  FOREIGN KEY (user_id, work_id)
    REFERENCES public.web_extension_work_record_metadata(user_id, work_id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES public.web_extension_import_jobs(id) ON DELETE CASCADE
);
CREATE INDEX web_extension_work_record_rounds_recent
  ON public.web_extension_work_record_rounds(user_id, work_id, round_no DESC);
ALTER TABLE public.web_extension_work_record_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY web_extension_work_record_rounds_self
  ON public.web_extension_work_record_rounds USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON public.web_extension_work_record_rounds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.web_extension_work_record_rounds TO service_role;

-- The previous RPC remains the authority for authentication, field allowlists,
-- ownership and revision checks. This wrapper adds an optional round link.
ALTER FUNCTION public.web_extension_work_records(uuid,text,text,jsonb)
  RENAME TO web_extension_work_records_before_rounds;

CREATE FUNCTION public.web_extension_work_records(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_input jsonb;
  v_changes jsonb;
  v_result jsonb;
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_rounds jsonb;
  v_user uuid;
  v_round integer;
  v_job public.web_extension_import_jobs;
  v_meta public.web_extension_work_record_metadata;
BEGIN
  v_input:=p_input;
  IF p_operation='patch' AND jsonb_typeof(p_input->'changes')='object'
     AND (p_input->'changes') ? 'submission_round' THEN
    v_changes:=p_input->'changes';
    IF jsonb_typeof(v_changes->'submission_round')<>'number'
       OR (v_changes->>'submission_round') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'INVALID_IMPORT';
    END IF;
    v_round:=(v_changes->>'submission_round')::integer;
    IF v_round>1000 OR jsonb_typeof(v_changes->'server_job_id')<>'string' THEN
      RAISE EXCEPTION 'INVALID_IMPORT';
    END IF;
    v_input:=jsonb_set(p_input,'{changes}',v_changes-'submission_round',false);
  END IF;

  v_result:=public.web_extension_work_records_before_rounds(
    p_token_id,p_token_hash,p_operation,v_input
  );

  IF p_operation='patch' AND v_round IS NOT NULL THEN
    SELECT user_id INTO v_user FROM public.web_extension_tokens
      WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now();
    IF v_user IS NULL THEN RAISE EXCEPTION 'EXTENSION_AUTH_INVALID'; END IF;
    SELECT * INTO v_meta FROM public.web_extension_work_record_metadata
      WHERE user_id=v_user AND work_id=(p_input->>'work_id')::uuid FOR UPDATE;
    SELECT * INTO v_job FROM public.web_extension_import_jobs
      WHERE id=(v_changes->>'server_job_id')::uuid AND user_id=v_user FOR SHARE;
    IF v_meta.work_id IS NULL OR v_job.id IS NULL
       OR v_job.source_origin IS DISTINCT FROM v_meta.source_origin
       OR v_job.source_class_id IS DISTINCT FROM v_meta.source_class_id
       OR v_job.classroom_id IS DISTINCT FROM v_meta.target_classroom_id
       OR v_job.class_session_id IS DISTINCT FROM v_meta.target_class_session_id
       OR v_round<>COALESCE((SELECT max(round_no)+1 FROM public.web_extension_work_record_rounds
          WHERE user_id=v_user AND work_id=v_meta.work_id),1)
       OR EXISTS(SELECT 1 FROM public.web_extension_work_record_rounds
          WHERE user_id=v_user AND job_id=v_job.id) THEN
      RAISE EXCEPTION 'INVALID_REFERENCE';
    END IF;
    INSERT INTO public.web_extension_work_record_rounds(user_id,work_id,round_no,job_id)
      VALUES(v_user,v_meta.work_id,v_round,v_job.id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'round_no',r.round_no,'job_id',r.job_id,'status',j.status,
      'batch_count',(SELECT count(*) FROM public.web_extension_import_batches b WHERE b.job_id=j.id),
      'applied_batches',(SELECT count(*) FROM public.web_extension_import_batches b WHERE b.job_id=j.id AND b.status='applied'),
      'updated_at',j.updated_at) ORDER BY r.round_no),'[]'::jsonb)
      INTO v_rounds FROM public.web_extension_work_record_rounds r
      JOIN public.web_extension_import_jobs j ON j.id=r.job_id AND j.user_id=r.user_id
      WHERE r.user_id=v_user AND r.work_id=v_meta.work_id;
    RETURN jsonb_set(v_result,'{item}',(v_result->'item')||jsonb_build_object('submission_rounds',v_rounds),true);
  END IF;

  IF p_operation='list' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_result->'items','[]'::jsonb)) LOOP
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'round_no',r.round_no,'job_id',r.job_id,'status',j.status,
        'batch_count',(SELECT count(*) FROM public.web_extension_import_batches b WHERE b.job_id=j.id),
        'applied_batches',(SELECT count(*) FROM public.web_extension_import_batches b WHERE b.job_id=j.id AND b.status='applied'),
        'updated_at',j.updated_at) ORDER BY r.round_no),'[]'::jsonb)
        INTO v_rounds FROM public.web_extension_work_record_rounds r
        JOIN public.web_extension_import_jobs j ON j.id=r.job_id AND j.user_id=r.user_id
        WHERE r.user_id=(SELECT user_id FROM public.web_extension_tokens WHERE id=p_token_id)
          AND r.work_id=(v_item->>'work_id')::uuid;
      v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object('submission_rounds',v_rounds));
    END LOOP;
    RETURN jsonb_set(v_result,'{items}',v_items,true);
  END IF;
  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) TO service_role;

-- Add safe batch-level detail to the common stale-preview case. Target and
-- occurrence version failures remain intentionally neutral unless the database
-- can identify a single affected row without exposing inaccessible data.
ALTER FUNCTION public.web_extension_workspace(uuid,text,text,jsonb)
  RENAME TO web_extension_workspace_before_stale_diagnostics;
CREATE FUNCTION public.web_extension_workspace(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_user uuid;
  v_batch public.web_extension_import_batches;
  v_job public.web_extension_import_jobs;
  v_row jsonb;
  v_kind text;
  v_source_id text;
  v_target_id uuid;
  v_expected text;
  v_actual text;
  v_current jsonb;
  v_history jsonb;
  v_occurrence_report public.occurrence_reports;
  v_message text;
BEGIN
  RETURN public.web_extension_workspace_before_stale_diagnostics(p_token_id,p_token_hash,p_operation,p_input);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
  IF v_message='PREVIEW_STALE' AND p_operation='apply' THEN
    SELECT user_id INTO v_user FROM public.web_extension_tokens
      WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now();
    SELECT * INTO v_job FROM public.web_extension_import_jobs
      WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user;
    SELECT * INTO v_batch FROM public.web_extension_import_batches
      WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;
    IF v_user IS NOT NULL AND (v_batch.batch_key IS NULL OR v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint') THEN
      RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
        'kind','batch','source_id',p_input->>'key','field','preview',
        'reason',CASE WHEN v_batch.batch_key IS NULL THEN 'PREVIEW_NOT_FOUND' ELSE 'REQUEST_FINGERPRINT_CHANGED' END
      )::text;
    END IF;
    IF v_user IS NOT NULL AND v_batch.batch_key IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
      PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
      PERFORM set_config('request.jwt.claim.role','authenticated',true);
      FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'rows','[]'::jsonb)) LOOP
        v_kind:=v_row->'record'->>'kind';v_source_id:=v_row->>'source_id';v_target_id:=NULL;v_current:=NULL;
        IF v_kind IN ('student','course','class_session','enrollment','occurrence','report')
          AND COALESCE(v_row->>'target_id','') ~* '^[0-9a-f-]{36}$' THEN
          v_target_id:=(v_row->>'target_id')::uuid;
          v_expected:=v_batch.target_versions->>(v_kind||':'||v_source_id);
          IF v_expected IS NOT NULL THEN
            v_current:=public.web_extension_target(v_kind,v_target_id);
            IF public.web_extension_row_permission(v_kind,v_target_id,v_current,v_job,'read') THEN
              v_actual:=COALESCE(v_current->>'version',v_current->>'updated_at');
              IF v_expected IS DISTINCT FROM v_actual THEN
                RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
                  'kind',v_kind,'source_id',v_source_id,'field','target_version','reason','TARGET_VERSION_CHANGED'
                )::text;
              END IF;
            END IF;
          END IF;
        END IF;

        IF v_kind='history_report' AND COALESCE(v_row->>'target_id','') ~* '^[0-9a-f-]{36}$' THEN v_target_id:=(v_row->>'target_id')::uuid; END IF;
        v_history:=v_row->'history_reconciliation';
        IF v_kind='history_report' AND v_history IS NOT NULL AND v_target_id IS NOT NULL THEN
          v_expected:=v_batch.target_versions->>('history_reconciliation:'||v_source_id);
          SELECT r.* INTO v_occurrence_report FROM public.enrollment_history_reports h
            JOIN public.occurrence_reports r ON r.id=h.linked_report_id
            WHERE h.id=v_target_id AND r.class_occurrence_id=(v_history->>'class_occurrence_id')::uuid;
          IF v_expected IS NOT NULL THEN
            v_actual:=CASE WHEN v_occurrence_report.id IS NULL THEN 'new' ELSE v_occurrence_report.id::text||':'||v_occurrence_report.version::text END;
            IF v_expected IS DISTINCT FROM v_actual AND (v_occurrence_report.id IS NULL OR public.can_access_report(v_occurrence_report.id,'teaching.reports.read')) THEN
              RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
                'kind','history_report','source_id',v_source_id,'field','occurrence_report_version','reason','OCCURRENCE_REPORT_VERSION_CHANGED'
              )::text;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;
  RAISE;
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;

-- For old clients and database functions that still return a bare stale code,
-- keep recovery safe and neutral. The API will expose only allowlisted details
-- when an upgraded database supplies them.
NOTIFY pgrst,'reload schema';
COMMIT;
