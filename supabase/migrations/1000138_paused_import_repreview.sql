BEGIN;

-- A preview-stale recovery pauses the import job before the teacher reviews
-- the refreshed differences. Permit previews while paused, but keep the job
-- paused after each preview so that only the explicit apply path can write.
DO $migration$
DECLARE
  v_definition text;
  v_old_guard text := $old$IF v_job.status IN ('cancelled','complete','paused') THEN RAISE EXCEPTION 'JOB_STOPPED'; END IF;$old$;
  v_new_guard text := $new$IF v_job.status IN ('cancelled','complete') OR (v_job.status='paused' AND p_operation='apply') THEN RAISE EXCEPTION 'JOB_STOPPED'; END IF;$new$;
  v_old_preview_status text := $old$UPDATE public.web_extension_import_jobs SET status='previewed',updated_at=now() WHERE id=v_job.id;$old$;
  v_new_preview_status text := $new$UPDATE public.web_extension_import_jobs SET status=CASE WHEN v_job.status='paused' THEN 'paused' ELSE 'previewed' END,updated_at=now() WHERE id=v_job.id;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.web_extension_workspace_before_history_reconciliation(uuid,text,text,jsonb)'::regprocedure
  ) INTO v_definition;

  IF position(v_old_guard IN v_definition)=0 OR position(v_old_preview_status IN v_definition)=0 THEN
    RAISE EXCEPTION 'PAUSED_IMPORT_REPREVIEW_PATCH_FAILED';
  END IF;

  v_definition := replace(v_definition,v_old_guard,v_new_guard);
  v_definition := replace(v_definition,v_old_preview_status,v_new_preview_status);

  IF position(v_old_guard IN v_definition)>0
     OR position(v_old_preview_status IN v_definition)>0
     OR position(v_new_guard IN v_definition)=0
     OR position(v_new_preview_status IN v_definition)=0 THEN
    RAISE EXCEPTION 'PAUSED_IMPORT_REPREVIEW_PATCH_FAILED';
  END IF;

  EXECUTE v_definition;
END
$migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
