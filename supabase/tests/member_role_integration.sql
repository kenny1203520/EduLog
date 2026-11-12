\set ON_ERROR_STOP on

-- Rollback-only fixture for 1000161: the built-in `member` role opens the
-- basic pages without granting data. A member-only user sees empty lists; a
-- member who is also a classroom-scoped teacher sees only that classroom.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('16100000-0000-4000-8000-000000000001', 'member-only@example.test'),
  ('16100000-0000-4000-8000-000000000002', 'member-classroom-teacher@example.test'),
  ('16100000-0000-4000-8000-000000000003', 'member-none@example.test');
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';

-- The member role holds exactly the six access grants at platform scope.
DO $$
BEGIN
  IF (SELECT array_agg(permission.key ORDER BY permission.key)
      FROM public.role_permission_policies policy
      JOIN public.roles role ON role.id = policy.role_id
      JOIN public.permissions permission ON permission.id = policy.permission_id
      WHERE role.code = 'member' AND role.is_builtin AND role.domain = 'teaching'
        AND policy.scope_type = 'system' AND policy.scope_id IS NULL AND policy.effect = 'allow')
     IS DISTINCT FROM ARRAY[
       'teaching.classrooms.access', 'teaching.courses.access', 'teaching.dashboard.access',
       'teaching.holidays.access', 'teaching.reports.access', 'teaching.students.access'] THEN
    RAISE EXCEPTION 'member role grants differ from the six page access permissions';
  END IF;
  -- Built-in roles that list a resource can still open its page.
  IF EXISTS (
    SELECT 1
    FROM public.roles role
    CROSS JOIN (VALUES
      ('teaching.students.list', 'teaching.students.access'),
      ('teaching.reports.list', 'teaching.dashboard.access'),
      ('teaching.reports.list', 'teaching.reports.access')
    ) mapping(list_key, access_key)
    WHERE role.is_builtin AND role.domain = 'teaching' AND role.code <> 'member'
      AND EXISTS (SELECT 1 FROM public.role_permission_policies policy
                  JOIN public.permissions permission ON permission.id = policy.permission_id
                  WHERE policy.role_id = role.id AND permission.key = mapping.list_key AND policy.effect = 'allow')
      AND NOT EXISTS (SELECT 1 FROM public.role_permission_policies policy
                      JOIN public.permissions permission ON permission.id = policy.permission_id
                      WHERE policy.role_id = role.id AND permission.key = mapping.access_key AND policy.effect = 'allow')
  ) THEN
    RAISE EXCEPTION 'a built-in role with list permission lost its page access';
  END IF;
END;
$$;

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT fixture.user_id, role.id, 'system', NULL, DATE '2020-01-01', 'active'
FROM (VALUES
  ('16100000-0000-4000-8000-000000000001'::uuid),
  ('16100000-0000-4000-8000-000000000002'::uuid)
) fixture(user_id)
JOIN public.roles role ON role.code = 'member' AND role.domain = 'teaching' AND role.is_builtin;

INSERT INTO public.classrooms(id, name) VALUES
  ('16100000-0000-4000-8000-0000000000c1', 'Member Classroom One'),
  ('16100000-0000-4000-8000-0000000000c2', 'Member Classroom Two');
INSERT INTO public.courses(id, subject, stage) VALUES
  ('16100000-0000-4000-8000-0000000000d1', 'Member Course One', 'primary'),
  ('16100000-0000-4000-8000-0000000000d2', 'Member Course Two', 'primary');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, start_date) VALUES
  ('16100000-0000-4000-8000-0000000000e1', 'Member Session One', '16100000-0000-4000-8000-0000000000c1',
   ARRAY['16100000-0000-4000-8000-0000000000d1']::uuid[], '09:00', '10:00', CURRENT_DATE - 30),
  ('16100000-0000-4000-8000-0000000000e2', 'Member Session Two', '16100000-0000-4000-8000-0000000000c2',
   ARRAY['16100000-0000-4000-8000-0000000000d2']::uuid[], '11:00', '12:00', CURRENT_DATE - 30);

-- User 2 also teaches classroom two.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '16100000-0000-4000-8000-000000000002', id, 'classroom', '16100000-0000-4000-8000-0000000000c2', DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin;

INSERT INTO public.students(id, name) VALUES
  ('16100000-0000-4000-8000-0000000000a1', 'Member Student One'),
  ('16100000-0000-4000-8000-0000000000a2', 'Member Student Two');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, start_date, lesson_number) VALUES
  ('16100000-0000-4000-8000-0000000000b1', '16100000-0000-4000-8000-0000000000a1', '16100000-0000-4000-8000-0000000000d1',
   '16100000-0000-4000-8000-0000000000c1', '16100000-0000-4000-8000-0000000000e1', 'regular', CURRENT_DATE - 30, 1),
  ('16100000-0000-4000-8000-0000000000b2', '16100000-0000-4000-8000-0000000000a2', '16100000-0000-4000-8000-0000000000d2',
   '16100000-0000-4000-8000-0000000000c2', '16100000-0000-4000-8000-0000000000e2', 'regular', CURRENT_DATE - 30, 1);
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted) VALUES
  ('16100000-0000-4000-8000-000000000011', '16100000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1, 'completed', true),
  ('16100000-0000-4000-8000-000000000012', '16100000-0000-4000-8000-0000000000e2', CURRENT_DATE - 1, 'completed', true);
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status) VALUES
  ('16100000-0000-4000-8000-000000000021', '16100000-0000-4000-8000-0000000000b1', '16100000-0000-4000-8000-000000000011', '', 1, false, 'present'),
  ('16100000-0000-4000-8000-000000000022', '16100000-0000-4000-8000-0000000000b2', '16100000-0000-4000-8000-000000000012', '', 1, false, 'present')
ON CONFLICT (enrollment_id, class_occurrence_id) DO UPDATE SET attendance_status = 'present', content = '', is_completed = false;
INSERT INTO public.holidays(id, name, start_date, end_date) VALUES
  ('16100000-0000-4000-8000-000000000031', 'Member Platform Holiday', CURRENT_DATE + 10, CURRENT_DATE + 11);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Member only: every page opens, every list is empty.
SELECT set_config('request.jwt.claim.sub', '16100000-0000-4000-8000-000000000001', true);
DO $$
DECLARE v jsonb; v_key text;
BEGIN
  FOREACH v_key IN ARRAY ARRAY['dashboard', 'students', 'courses', 'classrooms', 'holidays', 'reports'] LOOP
    IF NOT public.has_teaching_permission_any_scope(auth.uid(), 'teaching.' || v_key || '.access') THEN
      RAISE EXCEPTION 'member cannot open the % page', v_key;
    END IF;
  END LOOP;
  IF public.has_teaching_permission_any_scope(auth.uid(), 'teaching.teachers.list')
     OR public.has_teaching_permission_any_scope(auth.uid(), 'teaching.students.list')
     OR public.has_teaching_permission_any_scope(auth.uid(), 'teaching.reports.list') THEN
    RAISE EXCEPTION 'member must not grant any data permission';
  END IF;

  v := public.get_my_teaching_capabilities();
  IF (v #>> '{teaching.students.access,any}')::boolean IS NOT TRUE
     OR (v #>> '{teaching.dashboard.access,platform}')::boolean IS NOT TRUE
     OR (v #>> '{teaching.students.list,any}')::boolean IS NOT FALSE
     OR (v #>> '{teaching.teachers.list,any}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'member capability summary wrong: %', v;
  END IF;

  v := public.get_dashboard_counts();
  IF (v ->> 'totalStudents')::int <> 0 OR (v ->> 'activeCourses')::int <> 0 THEN
    RAISE EXCEPTION 'member dashboard counts must be zero: %', v;
  END IF;
  v := public.get_students_overview(25, 0, 'Member', 'name');
  IF (v ->> 'total')::int <> 0 OR jsonb_array_length(v -> 'items') <> 0 THEN
    RAISE EXCEPTION 'member students overview must be empty: %', v;
  END IF;
  v := public.get_classrooms_overview(25, 0, 'Member', 'all', 50, 0, NULL);
  IF jsonb_array_length(COALESCE(v -> 'classrooms', '[]')) <> 0
     OR jsonb_array_length(COALESCE(v -> 'classSessions', '[]')) <> 0 THEN
    RAISE EXCEPTION 'member classrooms overview must be empty: %', v;
  END IF;
  v := public.get_courses_overview(25, 0, 'Member Course', 'display_name');
  IF (v ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'member courses overview must be empty: %', v; END IF;
  v := public.get_holidays_overview(100, 0, 'Member Platform', '-start_date', false);
  IF (v ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'member holidays overview must be empty: %', v; END IF;
  v := public.get_incomplete_reports_page(90, 'all', 25, 0, 'Member', '-date');
  IF (v ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'member incomplete reports must be empty: %', v; END IF;
END;
$$;

-- Member plus classroom-two teacher: only classroom two's data.
SELECT set_config('request.jwt.claim.sub', '16100000-0000-4000-8000-000000000002', true);
DO $$
DECLARE v jsonb; v_ids uuid[];
BEGIN
  v := public.get_students_overview(25, 0, 'Member', 'name');
  SELECT array_agg((item ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(v -> 'items') item;
  IF v_ids IS DISTINCT FROM ARRAY['16100000-0000-4000-8000-0000000000a2']::uuid[] THEN
    RAISE EXCEPTION 'students overview not limited to classroom two: %', v_ids;
  END IF;
  v := public.get_classrooms_overview(25, 0, 'Member', 'all', 50, 0, NULL);
  SELECT array_agg((item ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(v -> 'classrooms') item;
  IF v_ids IS DISTINCT FROM ARRAY['16100000-0000-4000-8000-0000000000c2']::uuid[] THEN
    RAISE EXCEPTION 'classrooms overview not limited to classroom two: %', v_ids;
  END IF;
  v := public.get_incomplete_reports_page(90, 'all', 25, 0, 'Member', '-date');
  IF (v ->> 'total')::int <> 1 OR v #>> '{items,0,reportId}' <> '16100000-0000-4000-8000-000000000022' THEN
    RAISE EXCEPTION 'incomplete reports not limited to classroom two: %', v;
  END IF;
  v := public.get_dashboard_counts();
  IF (v ->> 'totalStudents')::int <> 1 THEN
    RAISE EXCEPTION 'dashboard student count not limited to classroom two: %', v;
  END IF;
END;
$$;

-- No role at all: no page opens and the RPCs still return empty data.
SELECT set_config('request.jwt.claim.sub', '16100000-0000-4000-8000-000000000003', true);
DO $$
DECLARE v jsonb;
BEGIN
  IF public.has_teaching_permission_any_scope(auth.uid(), 'teaching.students.access') THEN
    RAISE EXCEPTION 'unassigned user must not open pages';
  END IF;
  v := public.get_students_overview(25, 0, 'Member', 'name');
  IF (v ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'unassigned user sees students: %', v; END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
