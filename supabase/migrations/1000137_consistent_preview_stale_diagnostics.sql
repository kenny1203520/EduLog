BEGIN;

-- The diagnostic wrapper must use the same target version value that the
-- preview/apply RPC stores in target_versions. Earlier diagnostics preferred
-- updated_at where preview/apply use md5(target::text), which could point at
-- an unchanged row before the row that actually changed.
ALTER FUNCTION public.web_extension_workspace(uuid,text,text,jsonb)
  RENAME TO web_extension_workspace_before_consistent_stale_diagnostics;

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
  v_enrollment_id uuid;
  v_occurrence_id uuid;
  v_occurrence_report public.occurrence_reports;
  v_message text;
BEGIN
  RETURN public.web_extension_workspace_before_consistent_stale_diagnostics(
    p_token_id,p_token_hash,p_operation,p_input
  );
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_message=MESSAGE_TEXT;
  IF v_message='PREVIEW_STALE' AND p_operation='apply' THEN
    SELECT user_id INTO v_user FROM public.web_extension_tokens
      WHERE id=p_token_id AND token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now();
    IF v_user IS NULL THEN RAISE; END IF;

    SELECT * INTO v_job FROM public.web_extension_import_jobs
      WHERE id=(p_input->>'job_id')::uuid AND user_id=v_user;
    SELECT * INTO v_batch FROM public.web_extension_import_batches
      WHERE job_id=v_job.id AND batch_key=(p_input->>'key')::uuid;

    IF v_batch.batch_key IS NULL OR v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint' THEN
      RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
        'kind','batch','source_id',p_input->>'key','field','preview',
        'reason',CASE WHEN v_batch.batch_key IS NULL THEN 'PREVIEW_NOT_FOUND' ELSE 'REQUEST_FINGERPRINT_CHANGED' END
      )::text;
    END IF;

    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);

    FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_input->'rows','[]'::jsonb)) LOOP
      v_kind:=v_row->'record'->>'kind';
      v_source_id:=v_row->>'source_id';
      v_target_id:=NULL;
      v_current:=NULL;

      IF v_kind IN ('student','course','class_session','enrollment','occurrence','report','history_report')
         AND COALESCE(v_row->>'target_id','') ~* '^[0-9a-f-]{36}$' THEN
        v_target_id:=(v_row->>'target_id')::uuid;
        v_expected:=v_batch.target_versions->>(v_kind||':'||v_source_id);
        IF v_expected IS NOT NULL THEN
          v_current:=public.web_extension_target(v_kind,v_target_id);
          IF public.web_extension_row_permission(v_kind,v_target_id,v_current,v_job,'read') THEN
            -- Keep this expression byte-for-byte equivalent in meaning to the
            -- target-version calculation in web_extension_workspace preview/apply.
            v_actual:=CASE WHEN v_current IS NULL THEN 'new'
              ELSE COALESCE(v_current->>'version',md5(v_current::text)) END;
            IF v_expected IS DISTINCT FROM v_actual THEN
              RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
                'kind',v_kind,'source_id',v_source_id,'field','target_version','reason','TARGET_VERSION_CHANGED'
              )::text;
            END IF;
          END IF;
        END IF;
      END IF;

      IF v_kind='history_report' AND v_row ? 'history_reconciliation'
         AND COALESCE(v_row->>'target_id','') ~* '^[0-9a-f-]{36}$' THEN
        v_target_id:=(v_row->>'target_id')::uuid;
        v_history:=v_row->'history_reconciliation';
        v_expected:=v_batch.target_versions->>('history_reconciliation:'||v_source_id);
        SELECT h.enrollment_id INTO v_enrollment_id
          FROM public.enrollment_history_reports h WHERE h.id=v_target_id;
        v_occurrence_id:=NULLIF(v_history->>'class_occurrence_id','')::uuid;
        SELECT r.* INTO v_occurrence_report FROM public.occurrence_reports r
          WHERE r.enrollment_id=v_enrollment_id AND r.class_occurrence_id=v_occurrence_id;

        IF v_expected IS NOT NULL THEN
          v_actual:=CASE WHEN v_occurrence_report.id IS NULL THEN 'new'
            ELSE v_occurrence_report.id::text||':'||v_occurrence_report.version::text END;
          -- Do not disclose an inaccessible report's existence or identity.
          IF v_expected IS DISTINCT FROM v_actual THEN
            IF v_occurrence_report.id IS NULL
               OR public.can_access_report(v_occurrence_report.id,'teaching.reports.read') THEN
              RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
                'kind','history_report','source_id',v_source_id,
                'field','occurrence_report_version','reason','OCCURRENCE_REPORT_VERSION_CHANGED'
              )::text;
            END IF;
            RAISE;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;
  RAISE;
END
$function$;

REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) IS
  'Extension workspace RPC with preview-stale diagnostics using the exact preview/apply target-version algorithm.';

NOTIFY pgrst,'reload schema';
COMMIT;
