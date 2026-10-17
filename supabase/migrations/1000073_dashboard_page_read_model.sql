-- Dashboard page read model.
--
-- This is a forward-only migration.  The function is SECURITY INVOKER so
-- every relation read remains subject to the caller's JWT and RLS policies.
-- It replaces several independent PostgREST nested queries with one
-- planner-visible read model and keeps the response projection explicit.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000073 prerequisites missing; apply migrations through 1000072 first';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS class_occurrences_occurrence_date_idx
  ON public.class_occurrences USING btree (occurrence_date);

CREATE INDEX IF NOT EXISTS occurrence_reports_attendance_occurrence_idx
  ON public.occurrence_reports USING btree (attendance_status, class_occurrence_id);

CREATE OR REPLACE FUNCTION public.get_dashboard_page(
  p_start date DEFAULT NULL,
  p_end date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_start date := p_start;
  v_end date := p_end;
BEGIN
  IF (p_start IS NULL) <> (p_end IS NULL) THEN
    RAISE EXCEPTION 'DASHBOARD_DATE_RANGE_REQUIRED';
  END IF;

  IF p_start IS NOT NULL AND p_end < p_start THEN
    RAISE EXCEPTION 'DASHBOARD_DATE_RANGE_INVALID';
  END IF;

  IF p_start IS NOT NULL AND p_end - p_start > 31 THEN
    RAISE EXCEPTION 'DASHBOARD_DATE_RANGE_TOO_LARGE';
  END IF;

  RETURN (
    WITH current_teacher AS (
      SELECT id
      FROM public.teachers
      WHERE user_id = auth.uid()
    ),
    pending_rows AS (
      SELECT jsonb_build_object(
        'id', report.id,
        'studentName', student.name,
        'date', occurrence.occurrence_date,
        'className', session.name,
        'classroomName', classroom.name,
        'enrollmentId', report.enrollment_id,
        'contentPreview', left(trim(coalesce(report.content, '')), 300),
        'missingContent', (NOT (length(trim(coalesce(report.content, ''))) > 0)),
        'missingLesson', (report.lesson_id IS NULL),
        'missingProgress', NOT (report.is_completed IS TRUE OR nullif(trim(coalesce(report.progress_letter, '')), '') IS NOT NULL),
        'missingParticipation', NOT (report.class_participation IS NOT NULL AND report.class_participation > 0),
        'missingBehavior', NOT (report.classroom_behavior IS NOT NULL AND report.classroom_behavior > 0),
        'isMissing', (
          length(trim(coalesce(report.content, ''))) = 0
          OR report.lesson_id IS NULL
          OR NOT (report.is_completed IS TRUE OR nullif(trim(coalesce(report.progress_letter, '')), '') IS NOT NULL)
          OR NOT (report.class_participation IS NOT NULL AND report.class_participation > 0)
          OR NOT (report.classroom_behavior IS NOT NULL AND report.classroom_behavior > 0)
        )
      ) AS payload
      FROM public.occurrence_reports report
      JOIN public.enrollments enrollment ON enrollment.id = report.enrollment_id
      JOIN public.students student ON student.id = enrollment.student_id
      JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
      JOIN public.class_sessions session ON session.id = occurrence.class_session_id
      LEFT JOIN public.classrooms classroom ON classroom.id = session.classroom_id
      WHERE report.attendance_status = 'present'
        AND occurrence.occurrence_date BETWEEN current_date - 90 AND current_date
        AND EXISTS (
          SELECT 1
          FROM current_teacher teacher
          WHERE (
            teacher.id = ANY(coalesce(occurrence.teacher_ids, '{}'::uuid[]))
            OR auth.uid() = ANY(coalesce(occurrence.teacher_ids, '{}'::uuid[]))
          )
          AND coalesce(occurrence.teacher_attendance ->> teacher.id::text, 'true') <> 'false'
          AND coalesce(occurrence.teacher_attendance ->> auth.uid()::text, 'true') <> 'false'
          AND (
            occurrence.teacher_attendance ->> teacher.id::text = 'true'
            OR occurrence.teacher_attendance ->> auth.uid()::text = 'true'
          )
        )
        AND (
          length(trim(coalesce(report.content, ''))) = 0
          OR report.lesson_id IS NULL
          OR NOT (report.is_completed IS TRUE OR nullif(trim(coalesce(report.progress_letter, '')), '') IS NOT NULL)
          OR NOT (report.class_participation IS NOT NULL AND report.class_participation > 0)
          OR NOT (report.classroom_behavior IS NOT NULL AND report.classroom_behavior > 0)
        )
    ),
    occurrence_rows AS (
      SELECT jsonb_build_object(
        'id', occurrence.id,
        'class_session_id', occurrence.class_session_id,
        'occurrence_date', occurrence.occurrence_date,
        'status', occurrence.status,
        'teacher_ids', occurrence.teacher_ids,
        'teacher_attendance', occurrence.teacher_attendance,
        'is_conducted', occurrence.is_conducted,
        'actual_start_time', occurrence.actual_start_time,
        'actual_end_time', occurrence.actual_end_time,
        'original_start_time', occurrence.original_start_time,
        'original_end_time', occurrence.original_end_time,
        'time_zone', session.time_zone,
        'class_sessions', jsonb_build_object(
          'name', session.name,
          'time_zone', session.time_zone,
          'classrooms', CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object(
            'name', classroom.name,
            'color', classroom.color
          ) END
        )
      ) AS payload
      FROM public.class_occurrences occurrence
      JOIN public.class_sessions session ON session.id = occurrence.class_session_id
      LEFT JOIN public.classrooms classroom ON classroom.id = session.classroom_id
      WHERE v_start IS NOT NULL
        AND occurrence.occurrence_date BETWEEN v_start AND v_end
        AND occurrence.is_conducted IS TRUE
        AND (
          NOT EXISTS (SELECT 1 FROM current_teacher)
          OR EXISTS (
            SELECT 1
            FROM current_teacher teacher
            WHERE (
              teacher.id = ANY(coalesce(occurrence.teacher_ids, '{}'::uuid[]))
              OR auth.uid() = ANY(coalesce(occurrence.teacher_ids, '{}'::uuid[]))
            )
            AND coalesce(occurrence.teacher_attendance ->> teacher.id::text, 'true') <> 'false'
            AND coalesce(occurrence.teacher_attendance ->> auth.uid()::text, 'true') <> 'false'
            AND (
              occurrence.teacher_attendance ->> teacher.id::text = 'true'
              OR occurrence.teacher_attendance ->> auth.uid()::text = 'true'
            )
          )
        )
      ORDER BY occurrence.occurrence_date, occurrence.id
    )
    SELECT jsonb_build_object(
      'pendingReportsScope', 'my_present',
      'stats', jsonb_build_object(
        'totalStudents', (SELECT count(*) FROM public.students),
        'activeCourses', (SELECT count(*) FROM public.courses),
        'pendingReportsCount', (SELECT count(*) FROM pending_rows),
        'pendingReportsScope', 'my_present'
      ),
      'pendingReports', coalesce((SELECT jsonb_agg(payload) FROM pending_rows), '[]'::jsonb),
      'occurrences', coalesce((SELECT jsonb_agg(payload) FROM occurrence_rows), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_page(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_page(date, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_dashboard_page(date, date)
  IS 'RLS-scoped dashboard page read model with explicit safe projections.';
