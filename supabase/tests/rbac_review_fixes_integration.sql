\set ON_ERROR_STOP on

-- Regression for 1000166: who hears about pending accounts, the last-owner
-- guards, linking an account to a teacher, and the enrollments a student
-- profile shows.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- Other fixtures may have left owners in a shared test database.
DELETE FROM public.user_role_assignments assignment USING public.roles role
WHERE role.id = assignment.role_id AND role.domain = 'system';

INSERT INTO auth.users(id, email) VALUES
  ('16600000-0000-4000-8000-000000000001', 'review-owner-one@example.test'),
  ('16600000-0000-4000-8000-000000000002', 'review-owner-two@example.test'),
  ('16600000-0000-4000-8000-000000000003', 'review-admin@example.test'),
  ('16600000-0000-4000-8000-000000000004', 'review-teacher@example.test'),
  ('16600000-0000-4000-8000-000000000005', 'review-classroom-teacher@example.test'),
  ('16600000-0000-4000-8000-000000000006', 'review-linker@example.test'),
  ('16600000-0000-4000-8000-000000000007', 'review-unlinked@example.test');
UPDATE public.profiles SET account_status = 'active' WHERE auth_user_id::text LIKE '16600000-0000-4000-8000-%';

INSERT INTO public.classrooms(id, name) VALUES
  ('16600000-0000-4000-8000-0000000000c1', 'Review Classroom One'),
  ('16600000-0000-4000-8000-0000000000c2', 'Review Classroom Two');
INSERT INTO public.courses(id, subject, stage) VALUES
  ('16600000-0000-4000-8000-0000000000d1', 'Review Course', 'primary');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, start_date) VALUES
  ('16600000-0000-4000-8000-0000000000e1', 'Review Session One', '16600000-0000-4000-8000-0000000000c1',
   ARRAY['16600000-0000-4000-8000-0000000000d1']::uuid[], '09:00', '10:00', CURRENT_DATE - 30),
  ('16600000-0000-4000-8000-0000000000e2', 'Review Session Two', '16600000-0000-4000-8000-0000000000c2',
   ARRAY['16600000-0000-4000-8000-0000000000d1']::uuid[], '11:00', '12:00', CURRENT_DATE - 30);

-- A custom role that can link accounts to teachers but assigns no roles.
INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
VALUES ('16600000-0000-4000-8000-0000000000a1', 'review_linker', 'Review linker', false, 500, 'teaching', NULL, false, false);
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT '16600000-0000-4000-8000-0000000000a1', id, 'system', NULL, 'allow'
FROM public.permissions WHERE key IN ('teaching.teachers.update', 'teaching.teachers.update_sensitive', 'teaching.teachers.read');

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT fixture.user_id, role.id, fixture.scope_type, fixture.scope_id, DATE '2020-01-01', 'active'
FROM (VALUES
  ('16600000-0000-4000-8000-000000000001'::uuid, 'system', 'system_owner', 'system', NULL::uuid),
  ('16600000-0000-4000-8000-000000000002'::uuid, 'system', 'system_owner', 'system', NULL::uuid),
  ('16600000-0000-4000-8000-000000000003'::uuid, 'system', 'system_admin', 'system', NULL::uuid),
  ('16600000-0000-4000-8000-000000000004'::uuid, 'teaching', 'teacher', 'system', NULL::uuid),
  ('16600000-0000-4000-8000-000000000005'::uuid, 'teaching', 'teacher', 'classroom', '16600000-0000-4000-8000-0000000000c1'::uuid),
  ('16600000-0000-4000-8000-000000000006'::uuid, 'teaching', 'review_linker', 'system', NULL::uuid)
) fixture(user_id, domain, code, scope_type, scope_id)
JOIN public.roles role ON role.code = fixture.code AND role.domain = fixture.domain;

-- A teacher with a class job and no account, and a student enrolled in both classrooms.
INSERT INTO public.profiles(id, full_name) VALUES ('16600000-0000-4000-8000-0000000000f0', 'Review Unlinked Teacher');
INSERT INTO public.teacher_records(id, profile_id) VALUES ('16600000-0000-4000-8000-0000000000f1', '16600000-0000-4000-8000-0000000000f0');
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT '16600000-0000-4000-8000-0000000000e1', '16600000-0000-4000-8000-0000000000f1', id, CURRENT_DATE - 30, NULL
FROM public.roles WHERE domain = 'teaching' AND code = 'teaching_manager';
INSERT INTO public.students(id, name) VALUES ('16600000-0000-4000-8000-0000000000b0', 'Review Student');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, start_date, lesson_number) VALUES
  ('16600000-0000-4000-8000-0000000000b1', '16600000-0000-4000-8000-0000000000b0', '16600000-0000-4000-8000-0000000000d1',
   '16600000-0000-4000-8000-0000000000c1', '16600000-0000-4000-8000-0000000000e1', 'regular', CURRENT_DATE - 30, 1),
  ('16600000-0000-4000-8000-0000000000b2', '16600000-0000-4000-8000-0000000000b0', '16600000-0000-4000-8000-0000000000d1',
   '16600000-0000-4000-8000-0000000000c2', '16600000-0000-4000-8000-0000000000e2', 'regular', CURRENT_DATE - 30, 1);

CREATE FUNCTION pg_temp.attempt(p_user uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  BEGIN
    EXECUTE replace(p_sql, ':epoch', public.current_rbac_policy_epoch()::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    RETURN SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN 'OK';
END;
$$;
CREATE FUNCTION pg_temp.expect(p_label text, p_actual text, p_expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN RAISE EXCEPTION '%: expected %, got %', p_label, p_expected, p_actual; END IF;
END;
$$;

-- The pending-account notice goes to accounts that can review, nobody else.
DO $$
BEGIN
  IF (SELECT array_agg(email ORDER BY email) FROM public.list_account_approver_emails())
     IS DISTINCT FROM ARRAY['review-admin@example.test', 'review-owner-one@example.test', 'review-owner-two@example.test'] THEN
    RAISE EXCEPTION 'approver emails are wrong: %', (SELECT array_agg(email ORDER BY email) FROM public.list_account_approver_emails());
  END IF;
END;
$$;

DO $$
DECLARE
  owner_one constant uuid := '16600000-0000-4000-8000-000000000001';
  owner_two constant uuid := '16600000-0000-4000-8000-000000000002';
  admin constant uuid := '16600000-0000-4000-8000-000000000003';
  v_owner_one_assignment uuid; v_owner_two_assignment uuid; v_owner_role uuid;
BEGIN
  SELECT id INTO v_owner_role FROM public.roles WHERE domain = 'system' AND code = 'system_owner';
  SELECT id INTO v_owner_one_assignment FROM public.user_role_assignments WHERE user_id = owner_one AND role_id = v_owner_role;
  SELECT id INTO v_owner_two_assignment FROM public.user_role_assignments WHERE user_id = owner_two AND role_id = v_owner_role;

  -- An administrator manages users but not owners.
  PERFORM pg_temp.expect('admin disables an owner', pg_temp.attempt(admin,
    format('SELECT public.set_system_user_status(%L, ''disabled'', ''not allowed'', :epoch)', owner_two)), 'OWNER_ROLE_REQUIRED');
  PERFORM pg_temp.expect('admin removes an owner assignment', pg_temp.attempt(admin,
    format('SELECT public.rbac_delete_system_assignment(%L, :epoch)', v_owner_two_assignment)), 'OWNER_ROLE_REQUIRED');

  -- With owner two disabled, owner one is the last active owner.
  PERFORM pg_temp.expect('owner disables the other owner', pg_temp.attempt(owner_one,
    format('SELECT public.set_system_user_status(%L, ''disabled'', ''on leave'', :epoch)', owner_two)), 'OK');
  PERFORM pg_temp.expect('last active owner removes itself', pg_temp.attempt(owner_one,
    format('SELECT public.rbac_delete_system_assignment(%L, :epoch)', v_owner_one_assignment)), 'LAST_SYSTEM_OWNER');
  PERFORM pg_temp.expect('last active owner disables itself', pg_temp.attempt(owner_one,
    format('SELECT public.set_system_user_status(%L, ''disabled'', ''mistake'', :epoch)', owner_one)), 'LAST_SYSTEM_OWNER');
  PERFORM pg_temp.expect('last active owner demotes itself', pg_temp.attempt(owner_one,
    format('SELECT public.rbac_upsert_system_assignment(%L, %L, %L, CURRENT_DATE, NULL, :epoch)', v_owner_one_assignment, owner_one,
      (SELECT id FROM public.roles WHERE domain = 'system' AND code = 'system_admin'))), 'LAST_SYSTEM_OWNER');
  IF EXISTS (SELECT 1 FROM public.list_account_approver_emails() WHERE email = 'review-owner-two@example.test') THEN
    RAISE EXCEPTION 'a disabled owner is still told about pending accounts';
  END IF;

  -- Recovery: no bootstrap while an active owner exists, bootstrap once none is left.
  BEGIN
    PERFORM public.bootstrap_system_owner(admin);
    RAISE EXCEPTION 'bootstrap ran while an active owner exists';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SYSTEM_OWNER_ALREADY_EXISTS' THEN RAISE; END IF;
  END;
  UPDATE public.profiles SET account_status = 'disabled', disabled_at = now(), disabled_by = owner_two, disabled_reason = 'test'
  WHERE auth_user_id = owner_one;
  PERFORM public.bootstrap_system_owner(admin);
  IF NOT EXISTS (SELECT 1 FROM private.active_system_owner_ids() owner_id WHERE owner_id = admin) THEN
    RAISE EXCEPTION 'bootstrap did not make an active owner';
  END IF;
END;
$$;

-- Linking an account to a teacher hands over the teacher's class roles.
DO $$
DECLARE
  linker constant uuid := '16600000-0000-4000-8000-000000000006';
  unlinked_account constant uuid := '16600000-0000-4000-8000-000000000007';
  link constant text := $sql$UPDATE public.teacher_records SET profile_id = (SELECT id FROM public.profiles WHERE auth_user_id = '16600000-0000-4000-8000-000000000007') WHERE id = '16600000-0000-4000-8000-0000000000f1'$sql$;
BEGIN
  PERFORM pg_temp.expect('linker hands a class manager role to an account', pg_temp.attempt(linker, link), 'RBAC_MANAGE_REQUIRED');
  IF EXISTS (SELECT 1 FROM public.class_session_teacher_role_grants WHERE user_id = unlinked_account) THEN
    RAISE EXCEPTION 'a refused link still granted the class role';
  END IF;
  -- The service role (migrations, the API after its own checks) is not limited.
  EXECUTE link;
  IF NOT EXISTS (SELECT 1 FROM public.class_session_teacher_role_grants WHERE user_id = unlinked_account) THEN
    RAISE EXCEPTION 'a permitted link did not grant the class role';
  END IF;
END;
$$;

-- A student profile shows the enrollments the caller may read students in.
DO $$
DECLARE v_ids text[];
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '16600000-0000-4000-8000-000000000005', true);
  SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO v_ids
  FROM jsonb_array_elements(public.get_student_profile_page('16600000-0000-4000-8000-0000000000b0')->'enrollments') item;
  IF v_ids IS DISTINCT FROM ARRAY['16600000-0000-4000-8000-0000000000b1'] THEN
    RAISE EXCEPTION 'classroom teacher sees enrollments %', v_ids;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '16600000-0000-4000-8000-000000000004', true);
  SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO v_ids
  FROM jsonb_array_elements(public.get_student_profile_page('16600000-0000-4000-8000-0000000000b0')->'enrollments') item;
  IF v_ids IS DISTINCT FROM ARRAY['16600000-0000-4000-8000-0000000000b1', '16600000-0000-4000-8000-0000000000b2'] THEN
    RAISE EXCEPTION 'platform teacher sees enrollments %', v_ids;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
END;
$$;

ROLLBACK;
