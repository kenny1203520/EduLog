-- Forward-only enrollment scope hardening.
-- Enrollment access must resolve through session, classroom, or course and the
-- referenced student must already be visible to the acting user.

DO $$
BEGIN
  IF to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.courses') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000053 prerequisites missing; apply migrations through 1000052 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(
  p_student_id uuid,
  p_course_id uuid,
  p_classroom_id uuid,
  p_class_session_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH input_row AS (
  SELECT p_student_id AS student_id, p_course_id AS course_id,
         p_classroom_id AS classroom_id, p_class_session_id AS session_id
), resolved AS (
  SELECT input_row.*,
         course.teaching_id AS course_teaching_id,
         classroom.teaching_id AS classroom_teaching_id,
         session.teaching_id AS session_teaching_id
  FROM input_row
  LEFT JOIN public.courses course ON course.id = input_row.course_id
  LEFT JOIN public.classrooms classroom ON classroom.id = input_row.classroom_id
  LEFT JOIN public.class_sessions session ON session.id = input_row.session_id
)
SELECT EXISTS (
  SELECT 1
  FROM resolved
  WHERE COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id) IS NOT NULL
    AND (session_teaching_id IS NULL OR session_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND (classroom_teaching_id IS NULL OR classroom_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND (course_teaching_id IS NULL OR course_teaching_id = COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id))
    AND public.can_access_student(student_id, p_permission_key)
    AND public.can_access_teaching(COALESCE(session_teaching_id, classroom_teaching_id, course_teaching_id), p_permission_key)
);
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(
  p_enrollment_id uuid, p_permission_key text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_student(enrollment.student_id, p_permission_key)
      AND public.can_access_teaching(
        COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
        p_permission_key
      )
  );
$$;

DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments read" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments create" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments update" ON public.enrollments;
DROP POLICY IF EXISTS "Teaching enrollments delete" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments read" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments create" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments update" ON public.enrollments;
DROP POLICY IF EXISTS "Canonical enrollments delete" ON public.enrollments;

CREATE POLICY "Canonical enrollments read" ON public.enrollments FOR SELECT TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.read') OR public.can_access_enrollment(id, 'teaching.enrollments.list'));
CREATE POLICY "Canonical enrollments create" ON public.enrollments FOR INSERT TO authenticated
  WITH CHECK (public.can_access_enrollment_scope(student_id, course_id, classroom_id, class_session_id, 'teaching.enrollments.create'));
CREATE POLICY "Canonical enrollments update" ON public.enrollments FOR UPDATE TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.update'))
  WITH CHECK (public.can_access_enrollment_scope(student_id, course_id, classroom_id, class_session_id, 'teaching.enrollments.update'));
CREATE POLICY "Canonical enrollments delete" ON public.enrollments FOR DELETE TO authenticated
  USING (public.can_access_enrollment(id, 'teaching.enrollments.delete'));

REVOKE ALL ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;
