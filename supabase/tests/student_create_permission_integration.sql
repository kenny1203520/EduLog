\set ON_ERROR_STOP on

-- Transactional fixture: exercise authenticated RLS, including INSERT
-- RETURNING (the API's insert().select().single() contract).
BEGIN;

-- The plain PostgreSQL bootstrap omits Supabase's default table INSERT grant.
-- Supply it inside this rollback-only fixture; RLS still governs every write.
GRANT INSERT ON public.students TO authenticated;

INSERT INTO auth.users(id, email) VALUES
  ('a8000000-0000-4000-8000-000000000001', 'student-create-global@example.test'),
  ('a8000000-0000-4000-8000-000000000002', 'student-create-local@example.test'),
  ('a8000000-0000-4000-8000-000000000003', 'student-create-unassigned@example.test'),
  ('a8000000-0000-4000-8000-000000000004', 'student-create-denied@example.test'),
  ('a8000000-0000-4000-8000-000000000005', 'student-create-only@example.test');
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';

INSERT INTO public.roles(id, name, domain)
VALUES
  ('a8100000-0000-4000-8000-000000000001', 'Student create deny fixture', 'teaching'),
  ('a8100000-0000-4000-8000-000000000002', 'Student create only fixture', 'teaching');

INSERT INTO public.classrooms(id, name)
VALUES ('a8200000-0000-4000-8000-000000000001', 'Student create local fixture');

-- Set only fixture grants; rollback restores all original role policies.
DELETE FROM public.role_permission_policies policy
USING public.roles role, public.permissions permission
WHERE policy.role_id = role.id AND policy.permission_id = permission.id
  AND role.code = 'teacher' AND role.domain = 'teaching'
  AND policy.scope_type = 'system'
  AND permission.key IN ('teaching.students.create', 'teaching.students.read');
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles role CROSS JOIN public.permissions permission
WHERE role.code = 'teacher' AND role.domain = 'teaching'
  AND permission.key IN ('teaching.students.create', 'teaching.students.read');
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT 'a8100000-0000-4000-8000-000000000001', id, 'system', NULL, 'deny'
FROM public.permissions WHERE key = 'teaching.students.create';
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT 'a8100000-0000-4000-8000-000000000002', id, 'system', NULL, 'allow'
FROM public.permissions WHERE key = 'teaching.students.create';

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
SELECT fixture.user_id, role.id, fixture.scope_type, fixture.scope_id
FROM (VALUES
  ('a8000000-0000-4000-8000-000000000001'::uuid, 'system', NULL::uuid),
  ('a8000000-0000-4000-8000-000000000002'::uuid, 'classroom', 'a8200000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000004'::uuid, 'system', NULL::uuid)
) AS fixture(user_id, scope_type, scope_id)
CROSS JOIN public.roles role WHERE role.code = 'teacher' AND role.domain = 'teaching';
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
VALUES ('a8000000-0000-4000-8000-000000000004', 'a8100000-0000-4000-8000-000000000001', 'system', NULL);
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
VALUES ('a8000000-0000-4000-8000-000000000005', 'a8100000-0000-4000-8000-000000000002', 'system', NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000001', true);
DO $$
DECLARE created record;
BEGIN
  IF NOT public.has_api_permission(auth.uid(), 'teaching.students.create', NULL, NULL) THEN
    RAISE EXCEPTION 'global teacher fixture lacks student create permission';
  END IF;
  INSERT INTO public.students(id, name)
  VALUES ('a8300000-0000-4000-8000-000000000001', 'Standalone student')
  RETURNING id, name, user_id INTO created;
  IF created.id IS NULL OR created.name <> 'Standalone student' OR created.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'student INSERT RETURNING or ownership normalization failed';
  END IF;
END;
$$;

DO $$
DECLARE fixture_user uuid;
BEGIN
  FOREACH fixture_user IN ARRAY ARRAY[
    'a8000000-0000-4000-8000-000000000002'::uuid,
    'a8000000-0000-4000-8000-000000000003'::uuid,
    'a8000000-0000-4000-8000-000000000004'::uuid
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', fixture_user::text, true);
    IF public.has_api_permission(auth.uid(), 'teaching.students.create', NULL, NULL) THEN
      RAISE EXCEPTION 'local/unassigned/denied account unexpectedly has global create permission';
    END IF;
    BEGIN
      INSERT INTO public.students(name, user_id) VALUES ('Forbidden student', fixture_user);
      RAISE EXCEPTION 'student INSERT allowed for local/unassigned/denied account %', fixture_user;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'a8000000-0000-4000-8000-000000000005', true);
DO $$
DECLARE created_id uuid;
BEGIN
  IF NOT public.has_api_permission(auth.uid(), 'teaching.students.create', NULL, NULL)
     OR public.has_api_permission(auth.uid(), 'teaching.students.read', NULL, NULL) THEN
    RAISE EXCEPTION 'create-only fixture has incorrect permissions';
  END IF;
  BEGIN
    INSERT INTO public.students(name) VALUES ('Create-only returning forbidden') RETURNING id INTO created_id;
    RAISE EXCEPTION 'create permission alone must not authorize INSERT RETURNING';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.students(id, name)
  VALUES ('a8300000-0000-4000-8000-000000000002', 'Create-only student');
  IF EXISTS (SELECT 1 FROM public.students WHERE id IN (
    'a8300000-0000-4000-8000-000000000001', 'a8300000-0000-4000-8000-000000000002'
  )) THEN
    RAISE EXCEPTION 'create-only account can read student data';
  END IF;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.students WHERE id = 'a8300000-0000-4000-8000-000000000001' AND user_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'standalone student was not persisted with null legacy ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM public.enrollments WHERE student_id = 'a8300000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'fixture student must remain unenrolled';
  END IF;
  IF has_column_privilege('authenticated', 'public.students', 'email', 'SELECT')
     OR has_column_privilege('authenticated', 'public.students', 'email', 'UPDATE') THEN
    RAISE EXCEPTION 'student sensitive column privileges were widened';
  END IF;
END;
$$;

ROLLBACK;
