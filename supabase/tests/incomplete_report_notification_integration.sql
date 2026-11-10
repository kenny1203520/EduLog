\set ON_ERROR_STOP on

-- Rollback-only fixture for 1000152: incomplete-report notifications resolve
-- through the teaching RBAC, require an effective class assignment, and the
-- Page API presence filter matches teacher_attendance keyed by teacher-record
-- id for a user without a user_preferences row.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('15200000-0000-4000-8000-000000000001', 'n-owner@example.test'),
  ('15200000-0000-4000-8000-000000000002', 'n-teacher@example.test'),
  ('15200000-0000-4000-8000-000000000003', 'n-session-only@example.test'),
  ('15200000-0000-4000-8000-000000000004', 'n-unassigned@example.test');
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';

-- Teacher A: platform teacher role + session assignment (the normal shape).
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '15200000-0000-4000-8000-000000000002', id, 'system', NULL, DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin;
-- Unassigned user holds the platform teacher role but teaches no session.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '15200000-0000-4000-8000-000000000004', id, 'system', NULL, DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin;

INSERT INTO public.classrooms(id, name, user_id, teaching_id)
SELECT '15200000-0000-4000-8000-0000000000c1', 'N Classroom', '15200000-0000-4000-8000-000000000001', NULL;
INSERT INTO public.courses(id, subject, stage, user_id, teaching_id)
SELECT '15200000-0000-4000-8000-0000000000d1', 'N Course', 'primary', '15200000-0000-4000-8000-000000000001', NULL;
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, start_date, teaching_id)
SELECT '15200000-0000-4000-8000-0000000000e1', 'N Session', '15200000-0000-4000-8000-0000000000c1',
       ARRAY['15200000-0000-4000-8000-0000000000d1']::uuid[], '09:00', '10:00',
       '15200000-0000-4000-8000-000000000001', CURRENT_DATE - 30, NULL;

INSERT INTO public.teacher_records(id, profile_id)
SELECT ('15200000-0000-4000-8000-0000000000f' || right(profile.auth_user_id::text, 1))::uuid, profile.id
FROM public.profiles profile
WHERE profile.auth_user_id IN ('15200000-0000-4000-8000-000000000002', '15200000-0000-4000-8000-000000000003');

SELECT set_config('request.jwt.claim.sub', '15200000-0000-4000-8000-000000000001', true);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT '15200000-0000-4000-8000-0000000000e1', teacher.id, role.id, CURRENT_DATE - 30, NULL
FROM public.teacher_records teacher
CROSS JOIN public.roles role
WHERE teacher.id IN ('15200000-0000-4000-8000-0000000000f2', '15200000-0000-4000-8000-0000000000f3')
  AND role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.students(id, name, user_id)
VALUES ('15200000-0000-4000-8000-0000000000a1', 'N Student', '15200000-0000-4000-8000-000000000001');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, user_id, start_date, lesson_number)
VALUES ('15200000-0000-4000-8000-0000000000b1', '15200000-0000-4000-8000-0000000000a1', '15200000-0000-4000-8000-0000000000d1',
        '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', 'regular',
        '15200000-0000-4000-8000-000000000001', CURRENT_DATE - 30, 1);
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted, teacher_ids, teacher_attendance)
VALUES ('15200000-0000-4000-8000-0000000000b2', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1, 'completed', true,
        ARRAY['15200000-0000-4000-8000-0000000000f2']::uuid[],
        jsonb_build_object('15200000-0000-4000-8000-0000000000f2', true));
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status)
VALUES ('15200000-0000-4000-8000-0000000000b3', '15200000-0000-4000-8000-0000000000b1', '15200000-0000-4000-8000-0000000000b2', '', 1, false, 'present')
ON CONFLICT (enrollment_id, class_occurrence_id) DO UPDATE SET attendance_status = 'present', content = '', is_completed = false;

DO $$
DECLARE r record; v_epoch bigint; v_page jsonb;
BEGIN
  IF (SELECT count(*) FROM public.role_permission_policies policy
      JOIN public.roles role ON role.id = policy.role_id
      JOIN public.permissions permission ON permission.id = policy.permission_id
      WHERE permission.key = 'reports.incomplete.receive' AND policy.scope_type = 'system'
        AND policy.effect = 'allow' AND role.is_builtin AND role.code IN ('teacher', 'assistant')) <> 2 THEN
    RAISE EXCEPTION 'teacher/assistant system allow policies missing';
  END IF;

  SELECT * INTO r FROM public.resolve_incomplete_report_notification_permission(
    '15200000-0000-4000-8000-000000000002', '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1);
  IF NOT (r.is_allowed AND NOT r.is_denied AND r.policy_configured) THEN RAISE EXCEPTION 'teacher A should be allowed: %', r; END IF;

  -- Only the class-session assignment (role grant source), no platform role.
  SELECT * INTO r FROM public.resolve_incomplete_report_notification_permission(
    '15200000-0000-4000-8000-000000000003', '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1);
  IF NOT (r.is_allowed AND NOT r.is_denied AND r.policy_configured) THEN RAISE EXCEPTION 'session-only teacher should be allowed: %', r; END IF;

  SELECT * INTO r FROM public.resolve_incomplete_report_notification_permission(
    '15200000-0000-4000-8000-000000000004', '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1);
  IF r.is_allowed OR r.is_denied OR r.policy_configured THEN RAISE EXCEPTION 'unassigned user must get (f,f,f): %', r; END IF;

  -- Before the assignment starts.
  SELECT * INTO r FROM public.resolve_incomplete_report_notification_permission(
    '15200000-0000-4000-8000-000000000002', '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 60);
  IF r.is_allowed OR r.policy_configured THEN RAISE EXCEPTION 'pre-assignment date must be (f,f,f): %', r; END IF;

  -- A class-session deny on teacher overrides the system allow.
  SELECT public.current_rbac_policy_epoch() INTO v_epoch;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT role.id, permission.id, 'class_session', '15200000-0000-4000-8000-0000000000e1', 'deny'
  FROM public.roles role, public.permissions permission
  WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin AND permission.key = 'reports.incomplete.receive';
  IF public.current_rbac_policy_epoch() <= v_epoch THEN RAISE EXCEPTION 'policy insert did not bump the RBAC epoch'; END IF;
  SELECT * INTO r FROM public.resolve_incomplete_report_notification_permission(
    '15200000-0000-4000-8000-000000000002', '15200000-0000-4000-8000-0000000000c1', '15200000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1);
  IF r.is_allowed OR NOT r.is_denied THEN RAISE EXCEPTION 'session deny should win: %', r; END IF;
  DELETE FROM public.role_permission_policies WHERE scope_type = 'class_session' AND scope_id = '15200000-0000-4000-8000-0000000000e1';

  -- End to end through the Page API read model as teacher A.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '15200000-0000-4000-8000-000000000002', true);
  v_page := public.get_incomplete_reports_page(90, 'my_present', 25, 0, '', '-date');
  v_page := public.get_incomplete_reports_page(90, 'my_notifications', 25, 0, '', '-date');
  IF (v_page ->> 'total')::int < 1 THEN RAISE EXCEPTION 'my_notifications should include the present teacher''s incomplete report: %', v_page; END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.class_occurrences SET teacher_attendance = jsonb_build_object('15200000-0000-4000-8000-0000000000f2', false)
  WHERE id = '15200000-0000-4000-8000-0000000000b2';
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_page := public.get_incomplete_reports_page(90, 'my_notifications', 25, 0, '', '-date');
  IF (v_page ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'teacher marked absent should get no notifications: %', v_page; END IF;

  PERFORM set_config('request.jwt.claim.sub', '15200000-0000-4000-8000-000000000003', true);
  v_page := public.get_incomplete_reports_page(90, 'my_notifications', 25, 0, '', '-date');
  IF (v_page ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'absent teacher should get no notifications: %', v_page; END IF;
END;
$$;

ROLLBACK;
