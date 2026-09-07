\set ON_ERROR_STOP on

-- 1000045 must leave every formerly broad core table with action-specific
-- authenticated policies. This is intentionally catalog based so it also
-- catches a future policy reintroduction without depending on fixture data.
DO $$
DECLARE
  target_table text;
  action_name text;
  policy_count integer;
  broad_count integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'students', 'student_contacts', 'student_schools', 'student_credentials',
    'teacher_credentials', 'classroom_schedules', 'student_suspensions'
  ] LOOP
    SELECT count(*) INTO broad_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target_table
      AND cmd = 'ALL'
      AND roles @> ARRAY['authenticated'::name];
    IF broad_count <> 0 THEN
      RAISE EXCEPTION 'authenticated-wide policy remains on %: %', target_table, broad_count;
    END IF;

    FOREACH action_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      SELECT count(*) INTO policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
        AND cmd = action_name
        AND permissive = 'PERMISSIVE'
        AND roles @> ARRAY['authenticated'::name];
      IF policy_count <> 1 THEN
        RAISE EXCEPTION 'expected one authenticated % policy on %, found %', action_name, target_table, policy_count;
      END IF;
    END LOOP;
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
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_table
        AND policyname = policy_name
        AND roles @> ARRAY['authenticated'::name]
    ) THEN
      RAISE EXCEPTION 'missing canonical policy % on %', policy_name, policy_table;
    END IF;
  END LOOP;
END;
$$;

-- Regression check for actual row isolation, not only policy metadata.
-- Use identities present in both clean and upgrade fixtures.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'rls-a@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'rls-b@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.students(id, name, user_id) VALUES
  ('81000000-0000-0000-0000-000000000001', 'RLS Student A', '00000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000002', 'RLS Student B', '00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.students TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.students) <> 1 THEN
    RAISE EXCEPTION 'student cross-user RLS isolation failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = '81000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'student owner visibility failed';
  END IF;
END;
$$;
RESET ROLE;

-- Exercise the teaching resolver against rows owned by learners rather than
-- the caller. This proves that a teaching owner may access its own teaching
-- through membership while a second teaching remains invisible, including its
-- credential rows.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000003', 'teaching-owner-a@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'teaching-owner-b@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'teaching-learner-a@example.test'),
  ('00000000-0000-0000-0000-000000000006', 'teaching-learner-b@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teachings(id, name, owner_user_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'RLS Teaching A', '00000000-0000-0000-0000-000000000003'),
  ('b1000000-0000-4000-8000-000000000002', 'RLS Teaching B', '00000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching.id, teaching.owner_user_id, role.id
FROM public.teachings teaching
JOIN public.roles role ON role.code = 'teaching_owner'
WHERE teaching.id IN (
  'a1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002'
)
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = EXCLUDED.role_id,
    status = 'active';

INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES
  ('a2000000-0000-4000-8000-000000000001', 'RLS Classroom A', '00000000-0000-0000-0000-000000000003', 'a1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'RLS Classroom B', '00000000-0000-0000-0000-000000000004', 'b1000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES
  ('a3000000-0000-4000-8000-000000000001', 'RLS Course A', 'primary', '00000000-0000-0000-0000-000000000003', 'a1000000-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002', 'RLS Course B', 'primary', '00000000-0000-0000-0000-000000000004', 'b1000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.students(id, name, user_id) VALUES
  ('a4000000-0000-4000-8000-000000000001', 'Teaching Learner A', '00000000-0000-0000-0000-000000000005'),
  ('b4000000-0000-4000-8000-000000000002', 'Teaching Learner B', '00000000-0000-0000-0000-000000000006')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, user_id) VALUES
  ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000003'),
  ('b5000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.student_credentials(id, student_id, platform, username, password, user_id) VALUES
  ('a6000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'fixture', 'learner-a', 'fixture-secret-a', '00000000-0000-0000-0000-000000000005'),
  ('b6000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'fixture', 'learner-b', 'fixture-secret-b', '00000000-0000-0000-0000-000000000006')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.classrooms, public.students, public.student_credentials TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.classrooms WHERE id IN (
    'a2000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000002'
  )) <> 1 THEN
    RAISE EXCEPTION 'teaching owner classroom isolation failed';
  END IF;
  IF (SELECT count(*) FROM public.students WHERE id IN (
    'a4000000-0000-4000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000002'
  )) <> 1 THEN
    RAISE EXCEPTION 'teaching owner student isolation failed (visible %, scope A %, scope B %, member A %, permission A %)',
      (SELECT count(*) FROM public.students WHERE id IN (
        'a4000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000002'
      )),
      public.can_access_student('a4000000-0000-4000-8000-000000000001', 'teaching.students.read'),
      public.can_access_student('b4000000-0000-4000-8000-000000000002', 'teaching.students.read'),
      public.is_teaching_member('a1000000-0000-4000-8000-000000000001'),
      public.has_teaching_permission(
        '00000000-0000-0000-0000-000000000003',
        'teaching.students.read',
        'a1000000-0000-4000-8000-000000000001'
      );
  END IF;
  IF (SELECT count(*) FROM public.student_credentials WHERE id IN (
    'a6000000-0000-4000-8000-000000000001',
    'b6000000-0000-4000-8000-000000000002'
  )) <> 1 THEN
    RAISE EXCEPTION 'teaching owner credential isolation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = 'b4000000-0000-4000-8000-000000000002')
     OR EXISTS (SELECT 1 FROM public.student_credentials WHERE id = 'b6000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'cross-teaching sensitive-data leak detected';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_classroom(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_class_session(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_enrollment(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'canonical scope helpers are incomplete';
  END IF;
END;
$$;
