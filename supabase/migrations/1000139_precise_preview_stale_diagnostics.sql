BEGIN;

-- Emit stale-preview diagnostics at the exact check that detects the conflict.
-- The API only exposes allowlisted identity/reason fields; expected/actual
-- versions stay in the database error detail for server-side diagnostics.
DO $migration$
DECLARE
  v_definition text;
  v_old_batch text := $old$IF p_operation='apply' AND (v_batch.batch_key IS NULL OR v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint') THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;$old$;
  v_new_batch text := $new$IF p_operation='apply' AND v_batch.batch_key IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object('diagnostic_source','version_check','kind','batch','source_id',p_input->>'key','field','preview','reason','PREVIEW_NOT_FOUND')::text;
  END IF;
  IF p_operation='apply' AND v_batch.fingerprint IS DISTINCT FROM p_input->>'fingerprint' THEN
    RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object('diagnostic_source','version_check','kind','batch','source_id',p_input->>'key','field','preview','reason','REQUEST_FINGERPRINT_CHANGED','expected_version',v_batch.fingerprint,'actual_version',p_input->>'fingerprint')::text;
  END IF;$new$;
  v_old_target text := $old$IF p_operation='apply' AND v_batch.target_versions->>(v_kind||':'||(v_row->>'source_id')) IS DISTINCT FROM v_version THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;$old$;
  v_new_target text := $new$IF p_operation='apply' AND v_batch.target_versions->>(v_kind||':'||(v_row->>'source_id')) IS DISTINCT FROM v_version THEN
      RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object('diagnostic_source','version_check','kind',v_kind,'source_id',v_row->>'source_id','field','target_version','reason','TARGET_VERSION_CHANGED','expected_version',v_batch.target_versions->>(v_kind||':'||(v_row->>'source_id')),'actual_version',v_version)::text;
    END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old_batch IN v_definition)=0 OR position(v_old_target IN v_definition)=0 THEN
    RAISE EXCEPTION 'PRECISE_STALE_DIAGNOSTICS_CORE_PATCH_FAILED';
  END IF;
  v_definition:=replace(v_definition,v_old_batch,v_new_batch);
  v_definition:=replace(v_definition,v_old_target,v_new_target);
  IF position(v_old_batch IN v_definition)>0 OR position(v_old_target IN v_definition)>0
    OR position('diagnostic_source' IN v_definition)=0 THEN
    RAISE EXCEPTION 'PRECISE_STALE_DIAGNOSTICS_CORE_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- History-to-occurrence version checks happen inside the atomic reconciliation
-- wrapper. Resolve the occurrence by the request enrollment and class
-- occurrence (the history row may not exist yet), then mark only this check.
DO $migration$
DECLARE
  v_definition text;
  v_old text := $old$IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual THEN RAISE EXCEPTION 'PREVIEW_STALE'; END IF;$old$;
  v_new text := $new$IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_actual THEN
        RAISE EXCEPTION USING MESSAGE='PREVIEW_STALE',DETAIL=jsonb_build_object(
          'diagnostic_source','version_check','kind','history_report','source_id',v_source_id,
          'field','occurrence_report_version','reason','OCCURRENCE_REPORT_VERSION_CHANGED',
          'expected_version',v_expected,'actual_version',v_actual
        )::text;
      END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.web_extension_workspace_before_stale_diagnostics(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old IN v_definition)=0 THEN
    RAISE EXCEPTION 'PRECISE_STALE_DIAGNOSTICS_RECONCILIATION_PATCH_FAILED';
  END IF;
  v_definition:=replace(v_definition,v_old,v_new);
  IF position(v_old IN v_definition)>0 OR position('OCCURRENCE_REPORT_VERSION_CHANGED' IN v_definition)=0 THEN
    RAISE EXCEPTION 'PRECISE_STALE_DIAGNOSTICS_RECONCILIATION_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

-- Bypass the rollback-time scanners introduced by 1000136/1000137. The
-- delegated 1000134 wrapper remains responsible for atomic reconciliation.
CREATE OR REPLACE FUNCTION public.web_extension_workspace(
  p_token_id uuid,p_token_hash text,p_operation text,p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
  RETURN public.web_extension_workspace_before_stale_diagnostics(p_token_id,p_token_hash,p_operation,p_input);
END
$function$;
REVOKE ALL ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.web_extension_workspace(uuid,text,text,jsonb) IS
  'Extension workspace RPC with PREVIEW_STALE diagnostics emitted at the actual version checks.';
NOTIFY pgrst,'reload schema';
COMMIT;
