\set ON_ERROR_STOP on

-- Rollback-only fixture for 1000159: archiving teachers, the teacher
-- directory read model and a teacher's class assignments.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('15900000-0000-4000-8000-000000000001', 'archive-manager@example.test'),
  ('15900000-0000-4000-8000-000000000002', 'archive-assigned@example.test'),
  ('15900000-0000-4000-8000-000000000003', 'archive-free@example.test'),
  ('15900000-0000-4000-8000-000000000004', 'archive-session-teacher@example.test');
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';

-- Earlier fixtures in the same CI database may grant the built-in teacher
-- role teaching.roles.manage; this test relies on the shipped defaults.
DELETE FROM public.role_permission_policies policy
USING public.roles role, public.permissions permission
WHERE policy.role_id = role.id AND policy.permission_id = permission.id
  AND role.code = 'teacher' AND role.domain = 'teaching' AND permission.key = 'teaching.roles.manage';

-- User 1 manages teaching platform-wide (includes teachers.read_sensitive).
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '15900000-0000-4000-8000-000000000001', id, 'system', NULL, DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teaching_owner' AND domain = 'teaching' AND is_builtin;

UPDATE public.profiles SET contact_email = 'assigned.teacher@example.test', phone = '0912-345-678'
WHERE auth_user_id = '15900000-0000-4000-8000-000000000002';
UPDATE public.profiles SET full_name = 'Archive Free Teacher' WHERE auth_user_id = '15900000-0000-4000-8000-000000000003';
UPDATE public.profiles SET full_name = 'Archive Assigned Teacher' WHERE auth_user_id = '15900000-0000-4000-8000-000000000002';

INSERT INTO public.classrooms(id, name) VALUES ('15900000-0000-4000-8000-0000000000c1', 'Archive Classroom');
INSERT INTO public.class_sessions(id, name, classroom_id, start_time, end_time, start_date) VALUES
  ('15900000-0000-4000-8000-0000000000e1', 'Archive Session', '15900000-0000-4000-8000-0000000000c1', '09:00', '10:00', CURRENT_DATE - 30);

INSERT INTO public.teacher_records(id, profile_id)
SELECT ('15900000-0000-4000-8000-0000000000f' || right(profile.auth_user_id::text, 1))::uuid, profile.id
FROM public.profiles profile
WHERE profile.auth_user_id IN ('15900000-0000-4000-8000-000000000002', '15900000-0000-4000-8000-000000000003', '15900000-0000-4000-8000-000000000004');

SELECT set_config('request.jwt.claim.sub', '15900000-0000-4000-8000-000000000001', true);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from)
SELECT '15900000-0000-4000-8000-0000000000e1', teacher_id, role.id, CURRENT_DATE - 10
FROM (VALUES ('15900000-0000-4000-8000-0000000000f2'::uuid), ('15900000-0000-4000-8000-0000000000f4'::uuid)) AS fixture(teacher_id)
CROSS JOIN public.roles role WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '15900000-0000-4000-8000-000000000001', true);
DO $$
DECLARE v jsonb; v_item jsonb;
BEGIN
  -- Directory: contact details, class count and search by email and phone.
  v := public.get_teachers_overview(100, 0, 'Archive', 'name', 'active');
  IF (v ->> 'total')::int <> 2 THEN RAISE EXCEPTION 'expected two active Archive teachers: %', v; END IF;
  SELECT item INTO v_item FROM jsonb_array_elements(v -> 'items') item WHERE item ->> 'id' = '15900000-0000-4000-8000-0000000000f2';
  IF v_item ->> 'email' <> 'assigned.teacher@example.test' OR (v_item ->> 'class_count')::int <> 1 THEN
    RAISE EXCEPTION 'directory row missing contact or class count: %', v_item;
  END IF;
  v := public.get_teachers_overview(100, 0, 'assigned.teacher@', 'name', 'all');
  IF (v ->> 'total')::int <> 1 THEN RAISE EXCEPTION 'email search failed: %', v; END IF;
  v := public.get_teachers_overview(100, 0, '0912345', 'name', 'all');
  IF (v ->> 'total')::int <> 1 THEN RAISE EXCEPTION 'phone search failed: %', v; END IF;

  -- Assignments list.
  v := public.get_teacher_assignments('15900000-0000-4000-8000-0000000000f2');
  IF jsonb_array_length(v) <> 1 OR v #>> '{0,class_session_name}' <> 'Archive Session'
     OR (v #>> '{0,can_manage}')::boolean IS NOT TRUE OR (v #>> '{0,is_current}')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'assignment list wrong: %', v;
  END IF;

  -- A teacher with a current class cannot be archived.
  BEGIN
    PERFORM public.set_teacher_archived('15900000-0000-4000-8000-0000000000f2', true);
    RAISE EXCEPTION 'archiving a teacher with a current class must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TEACHER_HAS_ACTIVE_ASSIGNMENTS' THEN RAISE; END IF;
  END;

  -- A teacher without classes is archived, hidden by default and cannot be assigned.
  v := public.set_teacher_archived('15900000-0000-4000-8000-0000000000f3', true);
  IF v ->> 'archived_at' IS NULL THEN RAISE EXCEPTION 'archive did not stamp archived_at'; END IF;
  v := public.get_teachers_overview(100, 0, 'Archive', 'name', 'active');
  IF (v ->> 'total')::int <> 1 OR (v #>> '{statistics,archivedTeachers}')::int < 1 THEN RAISE EXCEPTION 'archived teacher still listed as active: %', v; END IF;
  v := public.get_teachers_overview(100, 0, 'Archive Free', 'name', 'archived');
  IF (v ->> 'total')::int <> 1 THEN RAISE EXCEPTION 'archived filter failed: %', v; END IF;
END;
$$;

RESET ROLE;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from)
    SELECT '15900000-0000-4000-8000-0000000000e1', '15900000-0000-4000-8000-0000000000f3', role.id, CURRENT_DATE
    FROM public.roles role WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
    RAISE EXCEPTION 'archived teacher must not be assignable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TEACHER_ARCHIVED' THEN RAISE; END IF;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '15900000-0000-4000-8000-000000000001', true);
  v := public.set_teacher_archived('15900000-0000-4000-8000-0000000000f3', false);
  IF v ->> 'archived_at' IS NOT NULL THEN RAISE EXCEPTION 'restore did not clear archived_at'; END IF;

  -- A class-level teacher sees co-teachers without contact details and cannot archive.
  PERFORM set_config('request.jwt.claim.sub', '15900000-0000-4000-8000-000000000004', true);
  v := public.get_teachers_overview(100, 0, '', 'name', 'all');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'items') item WHERE item ->> 'id' = '15900000-0000-4000-8000-0000000000f3') THEN
    RAISE EXCEPTION 'class teacher must not see an unrelated teacher: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'items') item WHERE item ->> 'id' = '15900000-0000-4000-8000-0000000000f2' AND item ->> 'email' IS NOT NULL) THEN
    RAISE EXCEPTION 'class teacher must not see co-teacher contact details: %', v;
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v -> 'items') item WHERE item ->> 'id' = '15900000-0000-4000-8000-0000000000f2') <> 1 THEN
    RAISE EXCEPTION 'class teacher should see the co-teacher: %', v;
  END IF;
  IF (public.get_teacher_assignments('15900000-0000-4000-8000-0000000000f2') #>> '{0,can_manage}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'class teacher must not manage the roster';
  END IF;
  BEGIN
    PERFORM public.set_teacher_archived('15900000-0000-4000-8000-0000000000f2', true);
    RAISE EXCEPTION 'class teacher must not archive';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
ROLLBACK;
