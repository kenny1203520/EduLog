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
    'teacher_credentials', 'classroom_schedules', 'student_suspensions',
    'class_sessions', 'class_session_schedule_rules'
  ] LOOP
    SELECT count(*) INTO broad_count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = target_table
      AND cmd = 'ALL'
      AND (
        roles @> ARRAY['authenticated'::name]
        OR roles @> ARRAY['public'::name]
      );
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
        AND (
          roles @> ARRAY['authenticated'::name]
          OR roles @> ARRAY['public'::name]
        );
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
      ('Canonical student suspensions delete', 'student_suspensions'),
      ('Canonical sessions read', 'class_sessions'),
      ('Canonical sessions create', 'class_sessions'),
      ('Canonical sessions update', 'class_sessions'),
      ('Canonical sessions delete', 'class_sessions'),
      ('Canonical session schedule rules read', 'class_session_schedule_rules'),
      ('Canonical session schedule rules create', 'class_session_schedule_rules'),
      ('Canonical session schedule rules update', 'class_session_schedule_rules'),
      ('Canonical session schedule rules delete', 'class_session_schedule_rules')
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

INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, teaching_id)
VALUES
  ('a3500000-0000-4000-8000-000000000001', 'RLS Session A', 'a2000000-0000-4000-8000-000000000001', ARRAY['a3000000-0000-4000-8000-000000000001']::uuid[], '09:00', '10:00', '00000000-0000-0000-0000-000000000003', 'a1000000-0000-4000-8000-000000000001'),
  ('b3500000-0000-4000-8000-000000000002', 'RLS Session B', 'b2000000-0000-4000-8000-000000000002', ARRAY['b3000000-0000-4000-8000-000000000002']::uuid[], '09:00', '10:00', '00000000-0000-0000-0000-000000000004', 'b1000000-0000-4000-8000-000000000002')
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

-- Child foreign-parent fixtures are created as the database owner so the
-- authenticated regression below tests RLS rather than fixture privileges.
INSERT INTO public.teachers(id, name, email, user_id) VALUES
  ('a4500000-0000-4000-8000-000000000001', 'RLS Teacher A', 'rls-teacher-a@example.test', '00000000-0000-0000-0000-000000000003'),
  ('b4500000-0000-4000-8000-000000000002', 'RLS Teacher B', 'rls-teacher-b@example.test', '00000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.student_schools(id, student_id, name, user_id) VALUES
  ('a6600000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'RLS School A', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.teacher_credentials(id, teacher_id, platform, username, password, user_id) VALUES
  ('a6500000-0000-4000-8000-000000000001', 'a4500000-0000-4000-8000-000000000001', 'fixture', 'teacher-a', 'fixture-secret-a', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.classroom_schedules(id, classroom_id, day_of_week, start_time, end_time, user_id) VALUES
  ('a6700000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 1, '09:00:00', '10:00:00', '00000000-0000-0000-0000-000000000003')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.enrollments
WHERE id IN ('a5100000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000002');
GRANT SELECT, INSERT, DELETE ON public.enrollments TO authenticated;

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
    RAISE EXCEPTION 'teaching owner student isolation failed';
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

-- Child rows must validate both INSERT and UPDATE against the referenced
-- parent. A caller's child user_id must not permit re-parenting into another
-- teaching.
GRANT INSERT, UPDATE ON public.student_schools, public.teacher_credentials, public.classroom_schedules TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.student_schools(id, student_id, name, user_id)
    VALUES ('b6600000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'Foreign School', '00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'cross-teaching student school insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.student_schools SET student_id = 'b4000000-0000-4000-8000-000000000002'
    WHERE id = 'a6600000-0000-4000-8000-000000000001';
    IF FOUND THEN RAISE EXCEPTION 'cross-teaching student school update unexpectedly succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.teacher_credentials(id, teacher_id, platform, username, password, user_id)
    VALUES ('b6500000-0000-4000-8000-000000000002', 'b4500000-0000-4000-8000-000000000002', 'fixture', 'foreign-teacher', 'should-not-be-stored', '00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'cross-teaching teacher credential insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.teacher_credentials SET teacher_id = 'b4500000-0000-4000-8000-000000000002'
    WHERE id = 'a6500000-0000-4000-8000-000000000001';
    IF FOUND THEN RAISE EXCEPTION 'cross-teaching teacher credential update unexpectedly succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.classroom_schedules(id, classroom_id, day_of_week, start_time, end_time, user_id)
    VALUES ('b6700000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 1, '09:00:00', '10:00:00', '00000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'cross-teaching classroom schedule insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.classroom_schedules SET classroom_id = 'b2000000-0000-4000-8000-000000000002'
    WHERE id = 'a6700000-0000-4000-8000-000000000001';
    IF FOUND THEN RAISE EXCEPTION 'cross-teaching classroom schedule update unexpectedly succeeded'; END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- Course-only enrollments must resolve their teaching through course_id, and
-- a teaching manager must not attach a foreign-teaching student.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id)
  VALUES (
    'a5100000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    NULL, NULL, '00000000-0000-0000-0000-000000000003'
  );
  IF NOT EXISTS (SELECT 1 FROM public.enrollments WHERE id = 'a5100000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'course-only enrollment insert failed';
  END IF;
  DELETE FROM public.enrollments WHERE id = 'a5100000-0000-4000-8000-000000000001';

  BEGIN
    INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id)
    VALUES (
      'b5100000-0000-4000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001', NULL, '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'cross-teaching student enrollment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- Child rows must not use their own user_id to attach data to another
-- teaching's parent.  This is a regression check for 1000051.
DELETE FROM public.student_contacts
WHERE id = 'c6100000-0000-4000-8000-000000000003';
DELETE FROM public.student_credentials
WHERE id = 'c6200000-0000-4000-8000-000000000004';
GRANT INSERT, UPDATE ON public.student_credentials TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.student_contacts(id, student_id, name, user_id)
    VALUES (
      'c6100000-0000-4000-8000-000000000003',
      'b4000000-0000-4000-8000-000000000002',
      'Cross teaching contact injection',
      '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'cross-teaching child insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- Student credentials must also be tied to the referenced student.  The
-- child-owned user_id alone must not permit a foreign-parent insert/update.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.student_credentials(id, student_id, platform, username, password, user_id)
    VALUES (
      'c6200000-0000-4000-8000-000000000004',
      'b4000000-0000-4000-8000-000000000002',
      'fixture', 'foreign-student', 'should-not-be-stored',
      '00000000-0000-0000-0000-000000000003'
    );
    RAISE EXCEPTION 'cross-teaching student credential insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.student_credentials
    SET student_id = 'b4000000-0000-4000-8000-000000000002'
    WHERE id = 'a6000000-0000-4000-8000-000000000001';
    IF FOUND THEN
      RAISE EXCEPTION 'cross-teaching student credential update unexpectedly succeeded';
    END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

-- A scoped permission must be bound to the classroom's teaching. This guards
-- against a regression where has_api_permission checks an arbitrary teaching
-- and accidentally authorizes a cross-teaching classroom.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  IF NOT public.has_api_permission(
    '00000000-0000-0000-0000-000000000003',
    'teaching.holidays.read',
    'a2000000-0000-4000-8000-000000000001',
    NULL
  ) THEN
    RAISE EXCEPTION 'same-teaching scoped permission unexpectedly denied';
  END IF;
  IF public.has_api_permission(
    '00000000-0000-0000-0000-000000000003',
    'teaching.holidays.read',
    'b2000000-0000-4000-8000-000000000002',
    NULL
  ) THEN
    RAISE EXCEPTION 'cross-teaching scoped permission unexpectedly allowed';
  END IF;
  IF public.has_api_permission(
    '00000000-0000-0000-0000-000000000003',
    'teaching.holidays.read',
    NULL,
    'b3500000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'cross-teaching session permission unexpectedly allowed';
  END IF;
END;
$$;
RESET ROLE;

-- Holiday regression: scoped rows, mixed scopes, and global rows must follow
-- the canonical all-referenced-scope policy installed by 1000049.
INSERT INTO public.holidays(id, name, start_date, end_date, classroom_ids, class_session_ids)
VALUES
  ('a7000000-0000-4000-8000-000000000001', 'RLS Holiday A', CURRENT_DATE, CURRENT_DATE, ARRAY['a2000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]),
  ('b7000000-0000-4000-8000-000000000002', 'RLS Holiday B', CURRENT_DATE, CURRENT_DATE, ARRAY['b2000000-0000-4000-8000-000000000002']::uuid[], '{}'::uuid[]),
  ('c7000000-0000-4000-8000-000000000003', 'RLS Holiday Mixed', CURRENT_DATE, CURRENT_DATE, ARRAY['a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002']::uuid[], '{}'::uuid[]),
  ('d7000000-0000-4000-8000-000000000004', 'RLS Holiday Global', CURRENT_DATE, CURRENT_DATE, '{}'::uuid[], '{}'::uuid[])
ON CONFLICT (id) DO UPDATE
SET classroom_ids = EXCLUDED.classroom_ids,
    class_session_ids = EXCLUDED.class_session_ids;

-- Create a system-scoped fixture separately from teaching owners. Global
-- holiday mutations must require this kind of assignment, not membership in
-- one arbitrary teaching.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000007', 'rls-system-admin@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('rls_system_admin', 'RLS system admin', 'Fixture-only system role', true, 999)
ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING;
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
SELECT '00000000-0000-0000-0000-000000000007', role.id, 'system', NULL
FROM public.roles role
WHERE role.code = 'rls_system_admin'
ON CONFLICT DO NOTHING;
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.code = 'rls_system_admin'
  AND permission.key IN (
    'system.roles.manage',
    'teaching.holidays.read', 'teaching.holidays.create',
    'teaching.holidays.update', 'teaching.holidays.delete'
  )
ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.holidays WHERE id = 'a7000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'teaching A holiday visibility failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.holidays WHERE id IN (
    'b7000000-0000-4000-8000-000000000002',
    'c7000000-0000-4000-8000-000000000003'
  )) THEN
    RAISE EXCEPTION 'cross-teaching or mixed holiday leak detected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.holidays WHERE id = 'd7000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'global holiday compatibility visibility failed';
  END IF;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.holidays(id, name, start_date, end_date, classroom_ids, class_session_ids)
    VALUES ('e7000000-0000-4000-8000-000000000005', 'RLS Holiday Forbidden Mixed', CURRENT_DATE, CURRENT_DATE,
      ARRAY['a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002']::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'mixed holiday insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.holidays
    SET classroom_ids = ARRAY['a2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002']::uuid[]
    WHERE id = 'a7000000-0000-4000-8000-000000000001';
    IF FOUND THEN
      RAISE EXCEPTION 'mixed holiday update unexpectedly succeeded';
    END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  DELETE FROM public.holidays WHERE id = 'b7000000-0000-4000-8000-000000000002';
  IF EXISTS (SELECT 1 FROM public.holidays WHERE id = 'b7000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'cross-teaching holiday delete unexpectedly succeeded';
  END IF;

  BEGIN
    INSERT INTO public.holidays(id, name, start_date, end_date, classroom_ids, class_session_ids)
    VALUES ('f7000000-0000-4000-8000-000000000006', 'RLS Global Owner Forbidden', CURRENT_DATE, CURRENT_DATE, '{}'::uuid[], '{}'::uuid[]);
    RAISE EXCEPTION 'teaching-only owner global holiday insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE public.holidays
    SET name = 'RLS Global Owner Forbidden Update'
    WHERE id = 'd7000000-0000-4000-8000-000000000004';
    IF FOUND THEN
      RAISE EXCEPTION 'teaching-only owner global holiday update unexpectedly succeeded';
    END IF;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;

  DELETE FROM public.holidays WHERE id = 'd7000000-0000-4000-8000-000000000004';
  IF FOUND THEN
    RAISE EXCEPTION 'teaching-only owner global holiday delete unexpectedly succeeded';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
DO $$
BEGIN
  INSERT INTO public.holidays(id, name, start_date, end_date, classroom_ids, class_session_ids)
  VALUES ('f7000000-0000-4000-8000-000000000006', 'RLS Global Admin', CURRENT_DATE, CURRENT_DATE, '{}'::uuid[], '{}'::uuid[]);
  UPDATE public.holidays
  SET name = 'RLS Global Admin Updated'
  WHERE id = 'f7000000-0000-4000-8000-000000000006';
  DELETE FROM public.holidays WHERE id = 'f7000000-0000-4000-8000-000000000006';
END;
$$;
RESET ROLE;

-- RBAC policy replacement must use the same scope boundary as the API. A
-- teaching owner may replace policies in its own teaching/classroom/session,
-- but cannot mutate another teaching's policy rows. A system role may manage
-- the system scope.
INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('rls_scoped_manager', 'RLS scoped manager', 'Fixture-only teaching manager', false, 998)
ON CONFLICT (code) WHERE code IS NOT NULL DO NOTHING;
INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT 'a1000000-0000-4000-8000-000000000001',
       '00000000-0000-0000-0000-000000000005',
       role.id
FROM public.roles role
WHERE role.code = 'rls_scoped_manager'
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = EXCLUDED.role_id,
    status = 'active';
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'teaching', 'a1000000-0000-4000-8000-000000000001', 'allow'
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.code = 'rls_scoped_manager'
  AND permission.key = 'teaching.members.manage'
ON CONFLICT DO NOTHING;

-- The same role is a member of Teaching A, but this permission is initially
-- configured only for Teaching B. The B policy must not leak into A merely
-- because the role itself is assigned in A.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'teaching', 'b1000000-0000-4000-8000-000000000002', 'allow'
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.code = 'rls_scoped_manager'
  AND permission.key = 'teaching.students.read'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.replace_role_permission_policies(text,text,uuid,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'scoped RBAC policy RPC is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.replace_role_permission_policies(text,text,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anonymous role can execute scoped RBAC policy RPC';
  END IF;
END;
$$;

-- The scoped replacement RPC has a narrowly validated SECURITY DEFINER write
-- path; direct writes by an unrelated authenticated user must still be denied
-- by the table's RLS policies.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
DO $$
DECLARE
  manager_role uuid;
  student_read_permission uuid;
BEGIN
  SELECT id INTO manager_role FROM public.roles WHERE code = 'rls_scoped_manager';
  SELECT id INTO student_read_permission FROM public.permissions WHERE key = 'teaching.students.read';
  BEGIN
    INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
    VALUES (manager_role, student_read_permission, 'classroom', 'b2000000-0000-4000-8000-000000000002', 'allow');
    RAISE EXCEPTION 'direct RBAC policy write bypassed RLS';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
DO $$
BEGIN
  IF public.has_teaching_permission(
    '00000000-0000-0000-0000-000000000005',
    'teaching.students.read',
    'a1000000-0000-4000-8000-000000000001', NULL, NULL
  ) THEN
    RAISE EXCEPTION 'teaching-scoped RBAC policy leaked from Teaching B to A';
  END IF;
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
DECLARE
  owner_role uuid;
BEGIN
  SELECT id INTO owner_role FROM public.roles WHERE code = 'teaching_owner';
  PERFORM public.replace_role_permission_policies(
    'teaching.members.manage', 'teaching',
    'a1000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('role_id', owner_role, 'effect', 'allow'))
  );
  PERFORM public.replace_role_permission_policies(
    'teaching.members.manage', 'classroom',
    'a2000000-0000-4000-8000-000000000001', '[]'::jsonb
  );
  PERFORM public.replace_role_permission_policies(
    'teaching.members.manage', 'class_session',
    'a3500000-0000-4000-8000-000000000001', '[]'::jsonb
  );
  BEGIN
    PERFORM public.replace_role_permission_policies(
      'teaching.members.manage', 'classroom',
      'b2000000-0000-4000-8000-000000000002', '[]'::jsonb
    );
    RAISE EXCEPTION 'cross-teaching RBAC policy replacement unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    IF SQLERRM = 'cross-teaching RBAC policy replacement unexpectedly succeeded' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;

-- An authenticated user without RBAC-management authority must not be able
-- to use the SECURITY DEFINER scope helper as an existence oracle. Existing
-- and random scopes are intentionally indistinguishable to that caller.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000006', false);
DO $$
BEGIN
  IF public.rbac_scope_exists('teaching', 'a1000000-0000-4000-8000-000000000001')
     OR public.rbac_scope_exists('teaching', 'ffffffff-ffff-4fff-8fff-ffffffffffff') THEN
    RAISE EXCEPTION 'unauthorized RBAC scope existence oracle exposed';
  END IF;
END;
$$;
RESET ROLE;

-- A minimal teaching-scoped manager may replace a policy in its own teaching.
-- This proves scope existence is checked by the narrow authorization-aware
-- definer helper rather than requiring broad direct table reads from the
-- invoker. The same least-privilege role can manage its classroom and
-- class-session scopes without unrelated read permissions.
-- The owner replacement above intentionally replaces every policy for
-- teaching.members.manage in Teaching A. Restore the fixture-only manager
-- grant after that replacement so this test exercises the intended
-- least-privilege path rather than depending on statement order.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'teaching', 'a1000000-0000-4000-8000-000000000001', 'allow'
FROM public.roles role
CROSS JOIN public.permissions permission
WHERE role.code = 'rls_scoped_manager'
  AND permission.key = 'teaching.members.manage'
ON CONFLICT DO NOTHING;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
DO $$
DECLARE
  scoped_role uuid;
BEGIN
  SELECT id INTO scoped_role FROM public.roles WHERE code = 'rls_scoped_manager';
  BEGIN
    PERFORM public.replace_role_permission_policies(
      'teaching.students.read', 'teaching',
      'a1000000-0000-4000-8000-000000000001',
      jsonb_build_array(
        jsonb_build_object('role_id', scoped_role, 'effect', 'allow'),
        jsonb_build_object('role_id', scoped_role, 'effect', 'deny')
      )
    );
    RAISE EXCEPTION 'duplicate RBAC policy roles were accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'duplicate RBAC policy roles were accepted' THEN RAISE; END IF;
    IF SQLERRM <> 'DUPLICATE_POLICY_ROLE' THEN RAISE; END IF;
  END;
  PERFORM public.replace_role_permission_policies(
    'teaching.students.read', 'teaching',
    'a1000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('role_id', scoped_role, 'effect', 'allow'))
  );
  PERFORM public.replace_role_permission_policies(
    'teaching.students.read', 'classroom',
    'a2000000-0000-4000-8000-000000000001', '[]'::jsonb
  );
  PERFORM public.replace_role_permission_policies(
    'teaching.students.read', 'class_session',
    'a3500000-0000-4000-8000-000000000001', '[]'::jsonb
  );
  RAISE NOTICE 'teaching-scoped RBAC policy replacement succeeded';
END;
$$;
RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000007', false);
DO $$
DECLARE
  admin_role uuid;
BEGIN
  SELECT id INTO admin_role FROM public.roles WHERE code = 'rls_system_admin';
  PERFORM public.replace_role_permission_policies(
    'system.roles.manage', 'system', NULL,
    jsonb_build_array(jsonb_build_object('role_id', admin_role, 'effect', 'allow'))
  );
END;
$$;
RESET ROLE;

-- A reserved in-progress idempotency key must not be executable a second time.
DELETE FROM public.api_idempotency_keys
WHERE user_id = '00000000-0000-0000-0000-000000000003'
  AND idempotency_key = 'rls-concurrency-key';
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- A brand-new key must be reserved by the first request, and a completed
-- key must replay the stored response rather than execute again.
DO $$
DECLARE
  first_replay boolean;
  first_status integer;
  first_body jsonb;
BEGIN
  SELECT is_replay, response_status, response_body
    INTO first_replay, first_status, first_body
  FROM public.reserve_api_idempotency(
    '00000000-0000-0000-0000-000000000003',
    'rls-concurrency-key', 'POST', '/api/teachings'
  );
  IF first_replay OR first_status IS NOT NULL OR first_body IS NOT NULL THEN
    RAISE EXCEPTION 'idempotency first reservation did not proceed';
  END IF;
END;
$$;
SELECT public.complete_api_idempotency(
  '00000000-0000-0000-0000-000000000003',
  'rls-concurrency-key', 201, '{"data":{"id":"first"}}'::jsonb
);
DO $$
DECLARE
  replay boolean;
  replay_status integer;
  replay_body jsonb;
BEGIN
  SELECT is_replay, response_status, response_body
    INTO replay, replay_status, replay_body
  FROM public.reserve_api_idempotency(
    '00000000-0000-0000-0000-000000000003',
    'rls-concurrency-key', 'POST', '/api/teachings'
  );
  IF NOT replay OR replay_status <> 201 OR replay_body->'data'->>'id' <> 'first' THEN
    RAISE EXCEPTION 'idempotency completed replay failed';
  END IF;
END;
$$;
DELETE FROM public.api_idempotency_keys
WHERE user_id = '00000000-0000-0000-0000-000000000003'
  AND idempotency_key = 'rls-concurrency-key';

INSERT INTO public.api_idempotency_keys(user_id, idempotency_key, method, route, processing_started_at)
VALUES ('00000000-0000-0000-0000-000000000003', 'rls-concurrency-key', 'POST', '/api/teachings', timezone('utc'::text, now()));
DO $$
DECLARE
  replay boolean;
  replay_status integer;
  replay_body jsonb;
BEGIN
  SELECT is_replay, response_status, response_body
    INTO replay, replay_status, replay_body
  FROM public.reserve_api_idempotency(
    '00000000-0000-0000-0000-000000000003',
    'rls-concurrency-key', 'POST', '/api/teachings'
  );
  IF NOT replay OR replay_status <> 409 OR replay_body->'error'->>'code' <> 'IDEMPOTENCY_IN_PROGRESS' THEN
    RAISE EXCEPTION 'idempotency concurrent reservation unexpectedly proceeded';
  END IF;
END;
$$;
DELETE FROM public.api_idempotency_keys
WHERE user_id = '00000000-0000-0000-0000-000000000003'
  AND idempotency_key = 'rls-concurrency-key';
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.holidays WHERE id = 'a7000000-0000-4000-8000-000000000001')
     OR NOT EXISTS (SELECT 1 FROM public.holidays WHERE id = 'b7000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'holiday RLS fixture was unexpectedly mutated';
  END IF;
END;
$$;

-- Exercise the scoped class-session RPC itself, not only its source text.
-- Same-teaching create/update must work for the owner; mixed references must
-- be rejected before a row is written.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
DO $$
DECLARE
  created_session_id uuid;
BEGIN
  created_session_id := public.save_class_session_with_schedule(
    jsonb_build_object(
      'name', 'RLS Session RPC A',
      'classroom_id', 'a2000000-0000-4000-8000-000000000001',
      'course_ids', jsonb_build_array('a3000000-0000-4000-8000-000000000001'),
      'capacity', 12,
      'start_date', CURRENT_DATE::text,
      'time_zone', 'Asia/Taipei',
      'session_type', 'regular',
      'schedule_mode', 'weekly'
    ),
    jsonb_build_array(jsonb_build_object(
      'schedule_kind', 'weekly',
      'day_of_week', 1,
      'start_time', '09:00:00',
      'end_time', '10:00:00'
    )),
    NULL
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.class_sessions
    WHERE id = created_session_id
      AND teaching_id = 'a1000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'same-teaching session RPC create failed';
  END IF;
  IF (SELECT count(*) FROM public.class_session_schedule_rules
      WHERE class_session_id = created_session_id) <> 1 THEN
    RAISE EXCEPTION 'same-teaching schedule rule RPC create failed';
  END IF;

  PERFORM public.save_class_session_with_schedule(
    jsonb_build_object(
      'name', 'RLS Session RPC A Updated',
      'classroom_id', 'a2000000-0000-4000-8000-000000000001',
      'course_ids', jsonb_build_array('a3000000-0000-4000-8000-000000000001'),
      'capacity', 13,
      'start_date', CURRENT_DATE::text,
      'time_zone', 'Asia/Taipei',
      'session_type', 'regular',
      'schedule_mode', 'weekly'
    ),
    jsonb_build_array(jsonb_build_object(
      'schedule_kind', 'weekly',
      'day_of_week', 2,
      'start_time', '09:00:00',
      'end_time', '10:00:00'
    )),
    created_session_id
  );

  BEGIN
    PERFORM public.save_class_session_with_schedule(
      jsonb_build_object(
        'name', 'RLS Session RPC Mixed',
        'classroom_id', 'a2000000-0000-4000-8000-000000000001',
        'course_ids', jsonb_build_array('b3000000-0000-4000-8000-000000000002'),
        'capacity', 12,
        'start_date', CURRENT_DATE::text,
        'time_zone', 'Asia/Taipei',
        'session_type', 'regular',
        'schedule_mode', 'weekly'
      ),
      jsonb_build_array(jsonb_build_object(
        'schedule_kind', 'weekly',
        'day_of_week', 1,
        'start_time', '09:00:00',
        'end_time', '10:00:00'
      )),
      NULL
    );
    RAISE EXCEPTION 'mixed-teaching session RPC unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'mixed-teaching session RPC unexpectedly succeeded' THEN RAISE; END IF;
  END;

  IF EXISTS (
    SELECT 1 FROM public.class_session_schedule_rules
    WHERE class_session_id = 'b3500000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'cross-teaching schedule rule was visible';
  END IF;

  BEGIN
    INSERT INTO public.class_sessions(
      id, name, classroom_id, course_ids, start_time, end_time, user_id, teaching_id
    ) VALUES (
      'b3550000-0000-4000-8000-000000000002',
      'Cross-teaching session write',
      'b2000000-0000-4000-8000-000000000002',
      ARRAY['b3000000-0000-4000-8000-000000000002']::uuid[],
      '09:00:00', '10:00:00',
      '00000000-0000-0000-0000-000000000003',
      'b1000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'cross-teaching class session insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.class_session_schedule_rules(
      id, class_session_id, schedule_kind, day_of_week, start_time, end_time
    ) VALUES (
      'b3600000-0000-4000-8000-000000000002',
      'b3500000-0000-4000-8000-000000000002',
      'weekly', 3, '09:00:00', '10:00:00'
    );
    RAISE EXCEPTION 'cross-teaching schedule rule insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  DELETE FROM public.class_sessions WHERE id = created_session_id;
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
