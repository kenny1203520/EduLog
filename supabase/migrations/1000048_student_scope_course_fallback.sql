-- Forward-only fix for student scope resolution.
-- Enrollment consistency intentionally clears classroom_id when no class session
-- is present, so student authorization must fall back to course.teaching_id.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000048 prerequisites missing; apply migrations through 1000047 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(
  p_student_id uuid,
  p_permission_key text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students student
    WHERE student.id = p_student_id
      AND (
        student.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.enrollments enrollment
          LEFT JOIN public.classrooms classroom
            ON classroom.id = enrollment.classroom_id
          LEFT JOIN public.class_sessions session
            ON session.id = enrollment.class_session_id
          LEFT JOIN public.courses course
            ON course.id = enrollment.course_id
          WHERE enrollment.student_id = student.id
            AND public.can_access_teaching(
              COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
              p_permission_key
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_student(uuid, text)
  IS 'Authorizes a student through ownership or session/classroom/course teaching scope.';
