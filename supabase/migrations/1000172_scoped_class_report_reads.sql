-- Authorize once per class, then aggregate only the authorized date range.
CREATE INDEX IF NOT EXISTS occurrence_reports_lesson_entries_containment_idx
  ON public.occurrence_reports USING gin (lesson_entries jsonb_path_ops);

CREATE OR REPLACE FUNCTION public.get_class_report_completion(p_session_id uuid, p_from date, p_to date)
RETURNS TABLE(occurrence_id uuid, occurrence_date date, total bigint, completed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_session_id IS NULL OR auth.uid() IS NULL OR NOT COALESCE(public.has_api_permission(auth.uid(), 'teaching.reports.list', NULL, p_session_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  IF NOT (public.can_access_class_session(p_session_id, 'teaching.occurrences.read')
       OR public.can_access_class_session(p_session_id, 'teaching.occurrences.list')) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH selected AS MATERIALIZED (
    SELECT o.id, o.occurrence_date FROM public.class_occurrences o
    WHERE o.class_session_id = p_session_id AND o.occurrence_date BETWEEN p_from AND p_to
    ORDER BY o.occurrence_date, o.id LIMIT 800
  )
  SELECT o.id, o.occurrence_date, count(r.id), count(r.id) FILTER (WHERE r.is_completed IS TRUE)
  FROM selected o LEFT JOIN public.occurrence_reports r ON r.class_occurrence_id = o.id
  GROUP BY o.id, o.occurrence_date ORDER BY o.occurrence_date, o.id;
END;
$$;

-- Single authorized statement; avoid applying enrollment RLS to an already
-- bounded effective roster, and avoid recomputing it for each insert.
CREATE OR REPLACE FUNCTION public.provision_class_reports(p_occurrence_id uuid)
RETURNS TABLE(enrollment_id uuid, provisioned boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  occurrence_row record;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTHENTICATION_REQUIRED';
  END IF;
  SELECT o.class_session_id, o.occurrence_date INTO occurrence_row
  FROM public.class_occurrences o WHERE o.id = p_occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (
    COALESCE(public.has_api_permission(actor, 'teaching.reports.create', NULL, occurrence_row.class_session_id), false)
    AND COALESCE(public.has_api_permission(actor, 'teaching.reports.list', NULL, occurrence_row.class_session_id), false)
    AND (public.can_access_class_session(occurrence_row.class_session_id, 'teaching.occurrences.read')
      OR public.can_access_class_session(occurrence_row.class_session_id, 'teaching.occurrences.list'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  RETURN QUERY
  WITH roster AS MATERIALIZED (
    SELECT DISTINCT effective.enrollment_id AS id
    FROM public.get_effective_occurrence_enrollment_ids(p_occurrence_id) effective
  ), missing AS MATERIALIZED (
    SELECT e.id FROM roster JOIN public.enrollments e ON e.id = roster.id
    WHERE e.status = 'regular' AND e.start_date <= occurrence_row.occurrence_date
      AND NOT EXISTS (
        SELECT 1 FROM public.occurrence_reports r WHERE r.class_occurrence_id = p_occurrence_id AND r.enrollment_id = e.id
      )
  ), inserted AS (
    INSERT INTO public.occurrence_reports AS report
      (enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status, absence_reason)
    SELECT m.id, p_occurrence_id, '', 1, false, a.attendance_status, a.absence_reason
    FROM missing m CROSS JOIN LATERAL public.get_effective_attendance(m.id, p_occurrence_id) a
    ORDER BY m.id
    ON CONFLICT ON CONSTRAINT occurrence_reports_enrollment_occurrence_unique DO NOTHING
    RETURNING report.enrollment_id
  )
  SELECT roster.id, inserted.enrollment_id IS NOT NULL FROM roster
  LEFT JOIN inserted ON inserted.enrollment_id = roster.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_class_holiday(p_session_id uuid, p_date date, p_teacher_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  classroom uuid;
BEGIN
  IF p_session_id IS NULL OR auth.uid() IS NULL OR NOT COALESCE(public.has_api_permission(auth.uid(), 'teaching.holidays.list', NULL, p_session_id), false) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PERMISSION_DENIED';
  END IF;
  SELECT s.classroom_id INTO classroom FROM public.class_sessions s WHERE s.id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_teacher_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.class_session_teachers t
    WHERE t.class_session_id = p_session_id AND t.teacher_id = p_teacher_id
      AND t.effective_from <= p_date AND (t.effective_to IS NULL OR t.effective_to >= p_date)
  ) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.holidays h
    WHERE h.start_date <= p_date AND h.end_date >= p_date
      AND ((p_teacher_id IS NULL AND h.kind = 'closure')
        OR (p_teacher_id IS NOT NULL AND h.kind = 'teacher_leave' AND p_teacher_id = ANY(h.teacher_ids)))
      AND ((COALESCE(cardinality(h.classroom_ids), 0) = 0 AND COALESCE(cardinality(h.class_session_ids), 0) = 0)
        OR p_session_id = ANY(h.class_session_ids) OR classroom = ANY(h.classroom_ids))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_class_report_completion(uuid,date,date),
  public.provision_class_reports(uuid), public.check_class_holiday(uuid,date,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_class_report_completion(uuid,date,date),
  public.provision_class_reports(uuid), public.check_class_holiday(uuid,date,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
