-- Trial enrollments are not on a lesson's roster until they hold a report on
-- it, so a report could never be added to one by hand. Allow that for a lesson
-- of the trial enrollment's own class on or after its start date. The roster
-- itself is unchanged: trial enrollments are still not provisioned
-- automatically, and a created report puts the enrollment on that lesson's
-- roster through the existing report-backed rule.
CREATE OR REPLACE FUNCTION public.can_create_occurrence_report(p_enrollment_id uuid, p_class_occurrence_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.class_occurrences occurrence
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    JOIN public.enrollments enrollment ON enrollment.id = p_enrollment_id
    WHERE occurrence.id = p_class_occurrence_id
      AND (
        EXISTS (
          SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
          WHERE roster.enrollment_id = enrollment.id
        )
        OR (
          enrollment.status = 'trial'
          AND enrollment.start_date <= occurrence.occurrence_date
          AND EXISTS (
            SELECT 1
            FROM public.enrollment_class_history history
            WHERE history.enrollment_id = enrollment.id
              AND history.class_session_id = occurrence.class_session_id
              -- The first class segment also covers lessons before it began,
              -- as in sync_enrollment_reports.
              AND (
                history.effective_from <= occurrence.occurrence_date
                OR NOT EXISTS (
                  SELECT 1 FROM public.enrollment_class_history earlier
                  WHERE earlier.enrollment_id = enrollment.id
                    AND earlier.effective_from < history.effective_from
                )
              )
              AND (history.effective_to IS NULL OR history.effective_to >= occurrence.occurrence_date)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.single_lesson_transfers transfer
            WHERE transfer.enrollment_id = enrollment.id
              AND transfer.source_occurrence_id = occurrence.id
              AND transfer.cancelled_at IS NULL
          )
        )
      )
      AND public.can_teaching_scope_action('reports', 'create', session.classroom_id, session.id)
  );
$function$;
