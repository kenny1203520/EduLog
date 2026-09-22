-- Dashboard read-model hardening.
--
-- 1000073 is forward history and may already be deployed. This migration
-- keeps the invoker boundary, but removes the count(*) privilege ambiguity
-- introduced by the sensitive-column grants in 1000072 and ensures the
-- student-scope lookup has the indexes it needs.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.class_occurrences') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.get_dashboard_page(date,date)') IS NULL THEN
    RAISE EXCEPTION '1000074 prerequisites missing; apply migrations through 1000073 first';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class index_relation
    JOIN pg_namespace index_schema ON index_schema.oid = index_relation.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_relation.oid
    WHERE index_schema.nspname = 'public'
      AND index_relation.relname = 'enrollments_student_id_idx'
      AND (
        NOT index_metadata.indisvalid
        OR NOT index_metadata.indisready
        OR index_metadata.indrelid <> to_regclass('public.enrollments')
        OR pg_get_indexdef(index_metadata.indexrelid, 1, true) <> 'student_id'
      )
  ) THEN
    RAISE EXCEPTION '1000074 found an invalid or conflicting enrollments_student_id_idx';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS enrollments_student_id_idx
  ON public.enrollments USING btree (student_id);

CREATE INDEX IF NOT EXISTS students_user_id_idx
  ON public.students USING btree (user_id);

-- The invoker read model must have the same minimal relation privileges as a
-- normal authenticated read.  RLS still decides which rows are visible;
-- these grants only make the non-sensitive relations readable to the caller.
-- In particular, class_session_teachers is consulted by the canonical
-- occurrence/report policies and therefore cannot be left at the PostgreSQL
-- default of no authenticated table privilege.
GRANT SELECT ON TABLE
  public.class_session_teachers,
  public.class_occurrences,
  public.occurrence_reports,
  public.enrollments,
  public.class_sessions,
  public.classrooms,
  public.courses
TO authenticated;

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
    ),
    visible_student_ids AS (
      SELECT student.id
      FROM public.students student
      WHERE student.user_id = auth.uid()
      UNION
      SELECT DISTINCT enrollment.student_id
      FROM public.enrollments enrollment
    )
    SELECT jsonb_build_object(
      'pendingReportsScope', 'my_present',
      'stats', jsonb_build_object(
        'totalStudents', (SELECT count(student.id) FROM visible_student_ids student),
        'activeCourses', (SELECT count(course.id) FROM public.courses course),
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
  IS 'RLS-scoped dashboard page read model with explicit safe projections and indexed student scope.';

NOTIFY pgrst, 'reload schema';
