-- A manually added makeup student is only roster-eligible after its report
-- exists. Authorize that explicit operation without widening generic INSERT.
CREATE FUNCTION public.can_create_makeup_report(p_enrollment_id uuid, p_class_occurrence_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL
    AND private.account_is_active(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.class_occurrences AS occurrence
      JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
      JOIN public.enrollments AS enrollment ON enrollment.id = p_enrollment_id
      WHERE occurrence.id = p_class_occurrence_id
        AND occurrence.status <> 'cancelled'
        AND enrollment.status = 'regular'
        AND enrollment.start_date <= occurrence.occurrence_date
        AND public.can_access_enrollment(enrollment.id, 'teaching.enrollments.read')
        AND public.can_teaching_scope_action('reports', 'create', session.classroom_id, session.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.single_lesson_transfers AS transfer
          WHERE transfer.enrollment_id = enrollment.id
            AND transfer.source_occurrence_id = occurrence.id
            AND transfer.cancelled_at IS NULL
        )
    );
$$;

CREATE FUNCTION public.create_makeup_report(p_enrollment_id uuid, p_class_occurrence_id uuid)
RETURNS SETOF public.occurrence_reports
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.can_create_makeup_report(p_enrollment_id, p_class_occurrence_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;

  RETURN QUERY
    INSERT INTO public.occurrence_reports AS report
      (enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason)
    SELECT p_enrollment_id, p_class_occurrence_id, '', 1, false,
           COALESCE(attendance.attendance_status, 'pending'), attendance.absence_reason
    FROM (VALUES (1)) AS seed(dummy)
    LEFT JOIN LATERAL public.get_effective_attendance(p_enrollment_id, p_class_occurrence_id) AS attendance ON true
    RETURNING report.*;
END;
$$;

REVOKE ALL ON FUNCTION public.can_create_makeup_report(uuid, uuid), public.create_makeup_report(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_create_makeup_report(uuid, uuid), public.create_makeup_report(uuid, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
