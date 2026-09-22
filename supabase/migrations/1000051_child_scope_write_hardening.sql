-- Forward-only child-scope hardening.  Child rows must be authorized through
-- their actual parent; an arbitrary user_id on the child is not a scope.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.teacher_credentials') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.classroom_schedules') IS NULL
     OR to_regclass('public.class_session_teachers') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000051 prerequisites missing; apply migrations through 1000050 first';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Canonical student contacts read" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts create" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts update" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts delete" ON public.student_contacts;
CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical student schools read" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools create" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools update" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools delete" ON public.student_schools;
CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical student credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials delete" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Teaching credentials delete" ON public.student_credentials;
CREATE POLICY "Canonical student credentials read" ON public.student_credentials FOR SELECT TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student credentials create" ON public.student_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student credentials update" ON public.student_credentials FOR UPDATE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student credentials delete" ON public.student_credentials FOR DELETE TO authenticated
  USING (public.can_access_student(student_id, 'teaching.students.update'));

DROP POLICY IF EXISTS "Canonical teacher credentials read" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials create" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials update" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials delete" ON public.teacher_credentials;
CREATE POLICY "Canonical teacher credentials read" ON public.teacher_credentials FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teachers teacher
      WHERE teacher.id = teacher_credentials.teacher_id
        AND (
          teacher.user_id = (select auth.uid())
          OR EXISTS (
            SELECT 1
            FROM public.class_session_teachers assignment
            JOIN public.class_sessions session ON session.id = assignment.class_session_id
            WHERE assignment.teacher_id = teacher.id
              AND public.can_access_class_session(session.id, 'teaching.teachers.read')
          )
        )
    )
  );
CREATE POLICY "Canonical teacher credentials create" ON public.teacher_credentials FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));
CREATE POLICY "Canonical teacher credentials update" ON public.teacher_credentials FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));
CREATE POLICY "Canonical teacher credentials delete" ON public.teacher_credentials FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.id = teacher_credentials.teacher_id AND teacher.user_id = (select auth.uid())));

DROP POLICY IF EXISTS "Canonical classroom schedules read" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules create" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules update" ON public.classroom_schedules;
DROP POLICY IF EXISTS "Canonical classroom schedules delete" ON public.classroom_schedules;
CREATE POLICY "Canonical classroom schedules read" ON public.classroom_schedules FOR SELECT TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.read'));
CREATE POLICY "Canonical classroom schedules create" ON public.classroom_schedules FOR INSERT TO authenticated
  WITH CHECK (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules update" ON public.classroom_schedules FOR UPDATE TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'))
  WITH CHECK (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules delete" ON public.classroom_schedules FOR DELETE TO authenticated
  USING (public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('student_contacts', 'student_schools', 'student_credentials', 'teacher_credentials', 'classroom_schedules')
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated'::name]
  ) THEN
    RAISE EXCEPTION '1000051 authenticated-wide child policies remain';
  END IF;
END;
$$;
