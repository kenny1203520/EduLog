-- 1000090: isolate report placeholder provisioning from the interactive report RLS path.
--
-- The public command remains an invoker-facing, authenticated API.  The private
-- helper is deliberately narrower than report CRUD: it accepts only an
-- enrollment/occurrence pair, re-checks the caller's canonical permission and
-- effective roster, and can only insert the empty placeholder shape used by
-- provisioning.  This avoids making the general occurrence_reports INSERT
-- policy responsible for a generated row whose scope is established by the
-- provisioning command itself.

DO $$
BEGIN
  IF to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000090 prerequisites missing; apply migrations through 1000089 first';
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.insert_provisioned_occurrence_report(
  p_enrollment_id uuid,
  p_occurrence_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_id uuid := auth.uid();
  enrollment_row record;
  occurrence_row record;
  attendance_row record;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT occurrence.id, occurrence.class_session_id, occurrence.occurrence_date
  INTO occurrence_row
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_occurrence_id;

  IF occurrence_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  SELECT enrollment.id, enrollment.status, enrollment.start_date, enrollment.class_session_id
  INTO enrollment_row
  FROM public.enrollments AS enrollment
  WHERE enrollment.id = p_enrollment_id;

  IF enrollment_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT (
    public.has_api_permission(actor_id, 'teaching.reports.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(actor_id, 'teaching.enrollments.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(actor_id, 'teaching.enrollments.update', NULL, occurrence_row.class_session_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF enrollment_row.status <> 'regular'
     OR enrollment_row.start_date > occurrence_row.occurrence_date THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id) AS roster
    WHERE roster.enrollment_id = p_enrollment_id
  ) THEN
    RETURN;
  END IF;

  SELECT *
  INTO attendance_row
  FROM public.get_effective_attendance(p_enrollment_id, p_occurrence_id);

  INSERT INTO public.occurrence_reports(
    enrollment_id,
    class_occurrence_id,
    content,
    version,
    is_completed,
    attendance_status,
    absence_reason
  ) VALUES (
    p_enrollment_id,
    p_occurrence_id,
    '',
    1,
    false,
    attendance_row.attendance_status,
    attendance_row.absence_reason
  )
  ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
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
  actor_id uuid := auth.uid();
  occurrence_row record;
  provisionable_row record;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED';
  END IF;

  SELECT occurrence.id, occurrence.class_session_id, occurrence.occurrence_date
  INTO occurrence_row
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_occurrence_id;

  IF occurrence_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF NOT (
    public.has_api_permission(actor_id, 'teaching.reports.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(actor_id, 'teaching.enrollments.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(actor_id, 'teaching.enrollments.update', NULL, occurrence_row.class_session_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  FOR provisionable_row IN
    SELECT roster.enrollment_id
    FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id) AS roster
    JOIN public.enrollments AS enrollment
      ON enrollment.id = roster.enrollment_id
    WHERE enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence_row.occurrence_date
  LOOP
    PERFORM private.insert_provisioned_occurrence_report(
      provisionable_row.enrollment_id,
      p_occurrence_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON FUNCTION private.insert_provisioned_occurrence_report(uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.insert_provisioned_occurrence_report(uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.provision_occurrence_reports(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.provision_occurrence_reports(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
