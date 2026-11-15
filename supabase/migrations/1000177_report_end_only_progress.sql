-- Preserve a selected end bound when the start is unset. Existing A and A-Z
-- values retain their meaning and do not need a data rewrite.
ALTER TABLE public.occurrence_reports
  DROP CONSTRAINT occurrence_reports_progress_letter_check,
  ADD CONSTRAINT occurrence_reports_progress_letter_check
    CHECK (progress_letter ~ '^([A-Z](-[A-Z])?|-[A-Z])$');

-- Both lifecycle functions validate progress before writing. Change only the
-- existing guards so version checks, permissions and grants remain identical.
DO $migration$
DECLARE
  signature regprocedure;
  definition text;
  old_pattern constant text := '''^[A-Z](-[A-Z])?$''';
  new_pattern constant text := '''^([A-Z](-[A-Z])?|-[A-Z])$''';
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)'::regprocedure,
    'public.apply_occurrence_report_lifecycle_single_lesson(uuid,integer,jsonb,uuid,text)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(signature);
    IF strpos(definition, old_pattern) = 0 THEN
      IF strpos(definition, new_pattern) > 0 THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Expected existing progress guard in %', signature;
    END IF;
    EXECUTE replace(definition, old_pattern, new_pattern);
  END LOOP;
END
$migration$;

NOTIFY pgrst, 'reload schema';
