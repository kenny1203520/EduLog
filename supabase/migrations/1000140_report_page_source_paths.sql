BEGIN;

-- A class report collection may be read from its dedicated report page. Keep
-- the captured path intact while applying the same narrow route allowlist in
-- the API and database.
DO $migration$
DECLARE
  v_definition text;
  v_old_evidence text := $old$'^/(dt_admissions/[0-9]+(/reports/[0-9]+/edit)?|courses/dt/[0-9]+)$'$old$;
  v_new_evidence text := $new$'^/(dt_admissions/[0-9]+(/reports/[0-9]+/edit)?|courses/dt/[0-9]+(/lesson_reports|/lesson-reports)?)$'$new$;
  v_old_work text := $old$'^/(courses/dt/[0-9]+|dt_admissions/[0-9]+|admissions/unfilled_report)$'$old$;
  v_new_work text := $new$'^/(courses/dt/[0-9]+(/lesson_reports|/lesson-reports)?|dt_admissions/[0-9]+(/reports/[0-9]+/edit)?|admissions/unfilled_report)$'$new$;
BEGIN
  SELECT pg_get_functiondef('public.validate_enrollment_history(jsonb,jsonb,public.web_extension_import_jobs,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old_evidence IN v_definition)=0 THEN
    RAISE EXCEPTION 'REPORT_EVIDENCE_PATH_CONTRACT_PATCH_FAILED';
  END IF;
  v_definition:=replace(v_definition,v_old_evidence,v_new_evidence);
  IF position(v_old_evidence IN v_definition)>0 THEN
    RAISE EXCEPTION 'REPORT_EVIDENCE_PATH_CONTRACT_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;

  -- Migration 1000136 wraps this RPC to add submission rounds; route
  -- validation remains in the preserved implementation underneath it.
  SELECT pg_get_functiondef('public.web_extension_work_records_before_rounds(uuid,text,text,jsonb)'::regprocedure)
    INTO v_definition;
  IF position(v_old_work IN v_definition)=0 THEN
    RAISE EXCEPTION 'WORK_RECORD_PATH_CONTRACT_PATCH_FAILED';
  END IF;
  v_definition:=replace(v_definition,v_old_work,v_new_work);
  IF position(v_old_work IN v_definition)>0 THEN
    RAISE EXCEPTION 'WORK_RECORD_PATH_CONTRACT_PATCH_FAILED';
  END IF;
  EXECUTE v_definition;
END
$migration$;

ALTER TABLE public.web_extension_work_record_metadata
  DROP CONSTRAINT IF EXISTS web_extension_work_record_metadata_source_path_check;
ALTER TABLE public.web_extension_work_record_metadata
  ADD CONSTRAINT web_extension_work_record_metadata_source_path_check
  CHECK (source_path ~ '^/(courses/dt/[0-9]+(/lesson_reports|/lesson-reports)?|dt_admissions/[0-9]+(/reports/[0-9]+/edit)?|admissions/unfilled_report)$');

REVOKE ALL ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.web_extension_work_records(uuid,text,text,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
