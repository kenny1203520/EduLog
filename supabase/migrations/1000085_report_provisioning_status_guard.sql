-- 1000085: keep report placeholder provisioning limited to active enrollments.
--
-- The occurrence roster is intentionally a separate concept from the set of
-- enrollments that may receive a new placeholder report.  This forward
-- migration makes the latter explicit so a stale or older roster function
-- cannot provision reports for completed, dropped, or trial enrollments.

DO $$
BEGIN
  IF to_regprocedure('public.get_effective_occurrence_enrollment_ids(uuid)') IS NULL
     OR to_regprocedure('public.get_effective_attendance(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000085 prerequisites missing; apply migrations through 1000084 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_provisionable_occurrence_enrollment_ids(
  p_occurrence_id uuid
) RETURNS TABLE (enrollment_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  occurrence_row record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT occurrence.id, occurrence.class_session_id, occurrence.occurrence_date
  INTO occurrence_row
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_occurrence_id;

  IF occurrence_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT public.has_api_permission(
    auth.uid(),
    'teaching.reports.create',
    NULL,
    occurrence_row.class_session_id
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
  SELECT roster.enrollment_id
  FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id) AS roster
  JOIN public.enrollments AS enrollment
    ON enrollment.id = roster.enrollment_id
  WHERE enrollment.status = 'regular'
    AND enrollment.start_date <= occurrence_row.occurrence_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_occurrence_reports(
  p_occurrence_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  occurrence_row record;
  provisionable_row record;
  attendance_row record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT occurrence.id, occurrence.class_session_id
  INTO occurrence_row
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_occurrence_id;

  IF occurrence_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT (
    public.has_api_permission(auth.uid(), 'teaching.reports.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(auth.uid(), 'teaching.enrollments.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, occurrence_row.class_session_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  FOR provisionable_row IN
    SELECT roster.enrollment_id
    FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id) AS roster
    JOIN public.enrollments AS enrollment
      ON enrollment.id = roster.enrollment_id
    JOIN public.class_occurrences AS occurrence
      ON occurrence.id = p_occurrence_id
    WHERE enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
  LOOP
    SELECT *
    INTO attendance_row
    FROM public.get_effective_attendance(provisionable_row.enrollment_id, p_occurrence_id);

    INSERT INTO public.occurrence_reports(
      enrollment_id,
      class_occurrence_id,
      content,
      version,
      is_completed,
      attendance_status,
      absence_reason
    ) VALUES (
      provisionable_row.enrollment_id,
      p_occurrence_id,
      '',
      1,
      false,
      attendance_row.attendance_status,
      attendance_row.absence_reason
    )
    ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_provisionable_occurrence_enrollment_ids(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_provisionable_occurrence_enrollment_ids(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.provision_occurrence_reports(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.provision_occurrence_reports(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
