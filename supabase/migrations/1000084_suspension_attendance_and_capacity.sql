-- 1000084: canonical effective attendance, atomic suspensions, and occupancy.
-- Forward-only migration. Historical migrations 1000001-1000083 are unchanged.

DO $$
BEGIN
  IF to_regclass('public.student_suspensions') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL THEN
    RAISE EXCEPTION '1000084 prerequisites missing; apply migrations through 1000083 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_attendance(
  p_enrollment_id uuid,
  p_occurrence_id uuid,
  p_ignore_suspension_report boolean DEFAULT false
) RETURNS TABLE (attendance_status text, absence_reason text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH context AS (
    SELECT occurrence.id, occurrence.occurrence_date, occurrence.class_session_id,
           session.classroom_id
    FROM public.class_occurrences AS occurrence
    JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
    WHERE occurrence.id = p_occurrence_id
  ), permission AS (
    SELECT (
      public.can_access_enrollment(p_enrollment_id, 'teaching.students.read')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.students.list')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.students.update')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.read')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.list')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.create')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.enrollments.update')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.reports.read')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.reports.list')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.reports.create')
      OR public.can_access_enrollment(p_enrollment_id, 'teaching.reports.update')
    ) AS allowed
  ), suspension AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.student_suspensions AS item
      JOIN context ON true
      WHERE item.enrollment_id = p_enrollment_id
        AND item.start_date <= context.occurrence_date
        AND (item.end_date IS NULL OR item.end_date >= context.occurrence_date)
    ) AS active
  ), holiday AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.holidays AS item
      JOIN context ON true
      WHERE item.kind = 'closure'
        AND item.start_date <= context.occurrence_date
        AND item.end_date >= context.occurrence_date
        AND (
          (COALESCE(cardinality(item.classroom_ids), 0) = 0 AND COALESCE(cardinality(item.class_session_ids), 0) = 0)
          OR context.classroom_id = ANY(COALESCE(item.classroom_ids, '{}'::uuid[]))
          OR context.class_session_id = ANY(COALESCE(item.class_session_ids, '{}'::uuid[]))
        )
    ) AS active
  ), report AS (
    SELECT item.attendance_status::text AS status, item.absence_reason::text AS reason
    FROM public.occurrence_reports AS item
    WHERE item.enrollment_id = p_enrollment_id
      AND item.class_occurrence_id = p_occurrence_id
    LIMIT 1
  )
  SELECT 'absent'::text, 'suspension'::text
  FROM suspension CROSS JOIN permission
  WHERE suspension.active AND permission.allowed
  UNION ALL
  SELECT 'absent'::text, 'holiday'::text
  FROM suspension, holiday, permission
  WHERE NOT suspension.active AND holiday.active AND permission.allowed
  UNION ALL
  SELECT
    CASE WHEN p_ignore_suspension_report AND report.reason = 'suspension' THEN 'pending' ELSE COALESCE(report.status, 'pending') END,
    CASE WHEN p_ignore_suspension_report AND report.reason = 'suspension' THEN NULL ELSE report.reason END
  FROM suspension, holiday, permission
  LEFT JOIN report ON true
  WHERE NOT suspension.active AND NOT holiday.active AND permission.allowed
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sync_suspension_attendance(
  p_enrollment_id uuid,
  p_start_date date,
  p_end_date date DEFAULT NULL,
  p_ignore_suspension_report boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  occurrence_row record;
  attendance_row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.can_access_enrollment(p_enrollment_id, 'teaching.students.update') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;
  FOR occurrence_row IN
    SELECT occurrence.id
    FROM public.class_occurrences AS occurrence
    JOIN public.enrollments AS enrollment ON enrollment.class_session_id = occurrence.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND enrollment.status = 'regular'
      AND enrollment.start_date <= occurrence.occurrence_date
      AND occurrence.occurrence_date >= p_start_date
      AND (p_end_date IS NULL OR occurrence.occurrence_date <= p_end_date)
  LOOP
    SELECT * INTO attendance_row
    FROM public.get_effective_attendance(p_enrollment_id, occurrence_row.id, p_ignore_suspension_report);

    INSERT INTO public.occurrence_reports(
      enrollment_id, class_occurrence_id, content, version,
      is_completed, attendance_status, absence_reason, last_edited_by, last_edited_at
    ) VALUES (
      p_enrollment_id, occurrence_row.id, '', 1, false,
      attendance_row.attendance_status, attendance_row.absence_reason, auth.uid(), now()
    )
    ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;

    UPDATE public.occurrence_reports AS report
    SET attendance_status = attendance_row.attendance_status,
        absence_reason = attendance_row.absence_reason,
        version = COALESCE(report.version, 1) + 1,
        last_edited_by = auth.uid(),
        last_edited_at = now(),
        updated_at = now()
    WHERE report.enrollment_id = p_enrollment_id
      AND report.class_occurrence_id = occurrence_row.id
      AND (
        (attendance_row.absence_reason = 'suspension')
        OR report.absence_reason = 'suspension'
      )
      AND (report.attendance_status, report.absence_reason)
          IS DISTINCT FROM (attendance_row.attendance_status, attendance_row.absence_reason);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_student_suspension(
  p_operation text,
  p_suspension_id uuid DEFAULT NULL,
  p_enrollment_id uuid DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_time_zone text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_end_date_set boolean DEFAULT false,
  p_reason_set boolean DEFAULT false
) RETURNS public.student_suspensions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_row public.student_suspensions%ROWTYPE;
  saved_row public.student_suspensions%ROWTYPE;
  effective_enrollment_id uuid;
  affected_start date;
  affected_end date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_operation NOT IN ('create', 'update', 'delete') THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;

  IF p_operation = 'create' THEN
    effective_enrollment_id := p_enrollment_id;
    IF effective_enrollment_id IS NULL OR p_start_date IS NULL THEN RAISE EXCEPTION 'REQUIRED_SUSPENSION_FIELDS'; END IF;
  ELSE
    SELECT * INTO current_row
    FROM public.student_suspensions
    WHERE id = p_suspension_id
    FOR UPDATE;
    IF current_row.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    effective_enrollment_id := current_row.enrollment_id;
  END IF;

  IF NOT public.can_access_enrollment(effective_enrollment_id, 'teaching.students.update') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  IF p_operation = 'create' THEN
    IF p_end_date IS NOT NULL AND p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.student_suspensions AS item
      WHERE item.enrollment_id = effective_enrollment_id
        AND p_start_date <= COALESCE(item.end_date, '9999-12-31'::date)
        AND COALESCE(p_end_date, '9999-12-31'::date) >= item.start_date
    ) THEN RAISE EXCEPTION 'SUSPENSION_OVERLAP'; END IF;
    INSERT INTO public.student_suspensions(enrollment_id, start_date, end_date, time_zone, reason)
    VALUES (effective_enrollment_id, p_start_date, p_end_date, COALESCE(p_time_zone, 'Asia/Taipei'), p_reason)
    RETURNING * INTO saved_row;
    PERFORM public.sync_suspension_attendance(effective_enrollment_id, saved_row.start_date, saved_row.end_date);
    RETURN saved_row;
  END IF;

  IF p_operation = 'update' THEN
    IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.student_suspensions AS item
      WHERE item.id <> p_suspension_id
        AND item.enrollment_id = effective_enrollment_id
        AND COALESCE(p_start_date, current_row.start_date) <= COALESCE(item.end_date, '9999-12-31'::date)
        AND COALESCE(CASE WHEN p_end_date_set THEN p_end_date ELSE current_row.end_date END, '9999-12-31'::date) >= item.start_date
    ) THEN RAISE EXCEPTION 'SUSPENSION_OVERLAP'; END IF;
    affected_start := LEAST(current_row.start_date, COALESCE(p_start_date, current_row.start_date));
    affected_end := CASE
      WHEN current_row.end_date IS NULL OR (p_end_date_set AND p_end_date IS NULL) THEN NULL
      WHEN NOT p_end_date_set THEN current_row.end_date
      ELSE GREATEST(current_row.end_date, p_end_date)
    END;
    UPDATE public.student_suspensions
    SET start_date = COALESCE(p_start_date, start_date),
        end_date = CASE WHEN p_end_date_set THEN p_end_date ELSE end_date END,
        time_zone = COALESCE(p_time_zone, time_zone),
        reason = CASE WHEN p_reason_set THEN p_reason ELSE reason END,
        updated_at = now()
    WHERE id = p_suspension_id
    RETURNING * INTO saved_row;
    PERFORM public.sync_suspension_attendance(effective_enrollment_id, affected_start, affected_end, true);
    PERFORM public.sync_suspension_attendance(effective_enrollment_id, saved_row.start_date, saved_row.end_date);
    RETURN saved_row;
  END IF;

  DELETE FROM public.student_suspensions
  WHERE id = p_suspension_id
  RETURNING * INTO saved_row;
  PERFORM public.sync_suspension_attendance(effective_enrollment_id, saved_row.start_date, saved_row.end_date, true);
  RETURN saved_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_class_session_occupancy(
  p_class_session_id uuid,
  p_start_date date,
  p_end_date date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF NOT public.has_api_permission(auth.uid(), 'teaching.class_sessions.read', NULL, p_class_session_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  WITH occurrence_roster AS (
    SELECT occurrence.id AS occurrence_id, occurrence.occurrence_date,
           session.capacity,
           roster.enrollment_id
    FROM public.class_occurrences AS occurrence
    JOIN public.class_sessions AS session ON session.id = occurrence.class_session_id
    CROSS JOIN LATERAL public.get_effective_occurrence_enrollment_ids(occurrence.id) AS roster
    WHERE occurrence.class_session_id = p_class_session_id
      AND occurrence.occurrence_date BETWEEN p_start_date AND p_end_date
  ), effective AS (
    SELECT occurrence_roster.*, attendance.attendance_status, attendance.absence_reason
    FROM occurrence_roster
    CROSS JOIN LATERAL public.get_effective_attendance(occurrence_roster.enrollment_id, occurrence_roster.occurrence_id) AS attendance
  ), per_occurrence AS (
    SELECT occurrence_id, occurrence_date, MAX(capacity)::integer AS capacity,
           COUNT(*)::integer AS roster_count,
           COUNT(*) FILTER (WHERE attendance_status <> 'absent')::integer AS occupied_count,
           COUNT(*) FILTER (WHERE attendance_status = 'absent')::integer AS absent_count
    FROM effective
    GROUP BY occurrence_id, occurrence_date
  ), summary AS (
    SELECT COALESCE(MAX(occupied_count), 0)::integer AS max_occupancy,
           COALESCE(MAX(roster_count), 0)::integer AS max_roster,
           COALESCE(MAX(absent_count), 0)::integer AS max_absent,
           COALESCE(MAX(capacity), 0)::integer AS capacity,
           COALESCE(jsonb_agg(to_jsonb(per_occurrence) ORDER BY occurrence_date, occurrence_id), '[]'::jsonb) AS occurrences
    FROM per_occurrence
  )
  SELECT jsonb_build_object(
    'max_occupancy', summary.max_occupancy,
    'max_roster', summary.max_roster,
    'max_absent', summary.max_absent,
    'roster_count', summary.max_roster,
    'occupied_count', summary.max_occupancy,
    'absent_count', summary.max_absent,
    'capacity', summary.capacity,
    'available_capacity', GREATEST(summary.capacity - summary.max_occupancy, 0),
    'occurrences', summary.occurrences
  ) INTO result
  FROM summary;
  RETURN result;
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
  roster_row record;
  attendance_row record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT occurrence.id, occurrence.class_session_id
  INTO occurrence_row
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = p_occurrence_id;
  IF occurrence_row.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (
    public.has_api_permission(auth.uid(), 'teaching.reports.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(auth.uid(), 'teaching.enrollments.create', NULL, occurrence_row.class_session_id)
    OR public.has_api_permission(auth.uid(), 'teaching.enrollments.update', NULL, occurrence_row.class_session_id)
  ) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  FOR roster_row IN SELECT * FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id)
  LOOP
    SELECT * INTO attendance_row
    FROM public.get_effective_attendance(roster_row.enrollment_id, p_occurrence_id);
    INSERT INTO public.occurrence_reports(
      enrollment_id, class_occurrence_id, content, version,
      is_completed, attendance_status, absence_reason
    ) VALUES (
      roster_row.enrollment_id, p_occurrence_id, '', 1, false,
      attendance_row.attendance_status, attendance_row.absence_reason
    )
    ON CONFLICT (enrollment_id, class_occurrence_id) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_attendance(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.sync_suspension_attendance(uuid, date, date, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.apply_student_suspension(text, uuid, uuid, date, date, text, text, boolean, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_class_session_occupancy(uuid, date, date) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.provision_occurrence_reports(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_attendance(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_suspension_attendance(uuid, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_student_suspension(text, uuid, uuid, date, date, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_class_session_occupancy(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provision_occurrence_reports(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS student_suspensions_enrollment_dates_idx
  ON public.student_suspensions (enrollment_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS occurrence_reports_occurrence_enrollment_attendance_idx
  ON public.occurrence_reports (class_occurrence_id, enrollment_id, attendance_status, absence_reason);
CREATE INDEX IF NOT EXISTS class_occurrences_session_date_conducted_idx
  ON public.class_occurrences (class_session_id, occurrence_date, is_conducted);

NOTIFY pgrst, 'reload schema';
