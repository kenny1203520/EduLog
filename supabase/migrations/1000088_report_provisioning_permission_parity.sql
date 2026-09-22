-- 1000088: keep report INSERT RLS permission parity with provisioning.
--
-- The provisioning command accepts reports.create as well as the enrollment
-- create/update permissions because those permissions are valid ways to open
-- a class roster.  The RLS policy must apply the same decision or an allowed
-- command can still fail at the table boundary.

DO $$
BEGIN
  IF to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_create_occurrence_report(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000088 prerequisites missing; apply migrations through 1000087 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Canonical reports create" ON public.occurrence_reports;
CREATE POLICY "Canonical reports create" ON public.occurrence_reports
FOR INSERT TO authenticated
WITH CHECK (
  public.can_create_occurrence_report(enrollment_id, class_occurrence_id)
  OR EXISTS (
    SELECT 1
    FROM public.class_occurrences AS occurrence
    JOIN public.class_sessions AS session
      ON session.id = occurrence.class_session_id
    JOIN public.enrollments AS enrollment
      ON enrollment.id = occurrence_reports.enrollment_id
    WHERE occurrence.id = occurrence_reports.class_occurrence_id
      AND enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
      AND (
        public.has_api_permission(auth.uid(), 'teaching.reports.create', NULL, session.id)
        OR public.has_api_permission(auth.uid(), 'teaching.enrollments.create', NULL, session.id)
        OR public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, session.id)
      )
  )
);

NOTIFY pgrst, 'reload schema';
