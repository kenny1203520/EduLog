-- Forward-only hardening for tables whose legacy policies were removed by
-- 1000043/1000044 but did not yet have canonical replacements.
-- Never rewrite an applied migration; rerun this file safely instead.

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regclass('public.teacher_credentials') IS NULL
     OR to_regclass('public.classroom_schedules') IS NULL
     OR to_regclass('public.student_suspensions') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_enrollment(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '1000045 prerequisites missing; apply migrations through 1000044 first';
  END IF;
END;
$$;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'students', 'student_contacts', 'student_schools', 'student_credentials',
    'teacher_credentials', 'classroom_schedules', 'student_suspensions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Enable all access for authenticated users', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow all authenticated users', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Authenticated users can access all rows', target_table);
  END LOOP;
END;
$$;

DO $$
DECLARE
  policy_name text;
  policy_table text;
BEGIN
  FOR policy_name, policy_table IN
    SELECT name, table_name
    FROM (VALUES
      ('Canonical students read', 'students'),
      ('Canonical students create', 'students'),
      ('Canonical students update', 'students'),
      ('Canonical students delete', 'students'),
      ('Canonical student contacts read', 'student_contacts'),
      ('Canonical student contacts create', 'student_contacts'),
      ('Canonical student contacts update', 'student_contacts'),
      ('Canonical student contacts delete', 'student_contacts'),
      ('Canonical student schools read', 'student_schools'),
      ('Canonical student schools create', 'student_schools'),
      ('Canonical student schools update', 'student_schools'),
      ('Canonical student schools delete', 'student_schools'),
      ('Canonical teacher credentials read', 'teacher_credentials'),
      ('Canonical teacher credentials create', 'teacher_credentials'),
      ('Canonical teacher credentials update', 'teacher_credentials'),
      ('Canonical teacher credentials delete', 'teacher_credentials'),
      ('Canonical classroom schedules read', 'classroom_schedules'),
      ('Canonical classroom schedules create', 'classroom_schedules'),
      ('Canonical classroom schedules update', 'classroom_schedules'),
      ('Canonical classroom schedules delete', 'classroom_schedules'),
      ('Canonical student suspensions read', 'student_suspensions'),
      ('Canonical student suspensions create', 'student_suspensions'),
      ('Canonical student suspensions update', 'student_suspensions'),
      ('Canonical student suspensions delete', 'student_suspensions')
    ) AS policies(name, table_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, policy_table);
  END LOOP;
END;
$$;
CREATE POLICY "Canonical students read" ON public.students FOR SELECT TO authenticated
  USING (public.can_access_student(id, 'teaching.students.read') OR user_id = (select auth.uid()));
CREATE POLICY "Canonical students create" ON public.students FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical students update" ON public.students FOR UPDATE TO authenticated
  USING (public.can_access_student(id, 'teaching.students.update') OR user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(id, 'teaching.students.update'));
CREATE POLICY "Canonical students delete" ON public.students FOR DELETE TO authenticated
  USING (public.can_access_student(id, 'teaching.students.delete') OR user_id = (select auth.uid()));

CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));

CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.read'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_student(student_id, 'teaching.students.update'));

CREATE POLICY "Canonical teacher credentials read" ON public.teacher_credentials FOR SELECT TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.class_session_teachers assignment
      JOIN public.class_sessions session ON session.id = assignment.class_session_id
      WHERE assignment.teacher_id = teacher_credentials.teacher_id
        AND public.can_access_class_session(session.id, 'teaching.teachers.read')
    )
  );
CREATE POLICY "Canonical teacher credentials create" ON public.teacher_credentials FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teacher credentials update" ON public.teacher_credentials FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Canonical teacher credentials delete" ON public.teacher_credentials FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Canonical classroom schedules read" ON public.classroom_schedules FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.read'));
CREATE POLICY "Canonical classroom schedules create" ON public.classroom_schedules FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules update" ON public.classroom_schedules FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'))
  WITH CHECK (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));
CREATE POLICY "Canonical classroom schedules delete" ON public.classroom_schedules FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) OR public.can_access_classroom(classroom_id, 'teaching.classrooms.update'));

CREATE POLICY "Canonical student suspensions read" ON public.student_suspensions FOR SELECT TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.read'));
CREATE POLICY "Canonical student suspensions create" ON public.student_suspensions FOR INSERT TO authenticated
  WITH CHECK (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));
CREATE POLICY "Canonical student suspensions update" ON public.student_suspensions FOR UPDATE TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.update'))
  WITH CHECK (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));
CREATE POLICY "Canonical student suspensions delete" ON public.student_suspensions FOR DELETE TO authenticated
  USING (public.can_access_enrollment(enrollment_id, 'teaching.students.update'));

REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_classroom(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_classroom(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;

DO $$
DECLARE
  forbidden_count integer;
BEGIN
  SELECT count(*) INTO forbidden_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('students', 'student_contacts', 'student_schools', 'student_credentials', 'teacher_credentials', 'classroom_schedules', 'student_suspensions')
    AND cmd = 'ALL'
    AND roles @> ARRAY['authenticated'::name];
  IF forbidden_count <> 0 THEN
    RAISE EXCEPTION '1000045 authenticated-wide policies remain: %', forbidden_count;
  END IF;
END;
$$;
