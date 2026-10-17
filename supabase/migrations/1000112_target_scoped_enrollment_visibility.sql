-- Allow a teacher to enroll an existing student into a target scope when the
-- teacher can read students and create enrollments there. Do not require the
-- student to have an existing enrollment in a scope the teacher can access.
CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(
  p_student_id uuid, p_course_id uuid, p_classroom_id uuid, p_class_session_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    LEFT JOIN public.courses course ON course.id = p_course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = p_classroom_id
    LEFT JOIN public.class_sessions session ON session.id = p_class_session_id
    WHERE student.id = p_student_id
      AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
      AND (session.teaching_id IS NULL OR session.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (classroom.teaching_id IS NULL OR classroom.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (course.teaching_id IS NULL OR course.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND CASE WHEN p_permission_key = 'teaching.enrollments.create'
        THEN public.has_teaching_permission(auth.uid(), 'teaching.students.read',
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
        ELSE public.can_access_student(student.id, p_permission_key)
      END
      AND CASE WHEN p_permission_key IS NULL
        THEN public.is_teaching_member(COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
        ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
      END
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment_scope(uuid, uuid, uuid, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
