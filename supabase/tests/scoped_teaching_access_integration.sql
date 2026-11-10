\set ON_ERROR_STOP on

-- Rollback-only fixture for 1000158: teachers who hold a teaching role only in
-- a class session (class roster) or a classroom can use the pages, see only
-- their own scope, and can create and update reports there.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('15800000-0000-4000-8000-000000000001', 'scope-owner@example.test'),
  ('15800000-0000-4000-8000-000000000002', 'scope-session-teacher@example.test'),
  ('15800000-0000-4000-8000-000000000003', 'scope-classroom-teacher@example.test'),
  ('15800000-0000-4000-8000-000000000004', 'scope-outsider@example.test'),
  ('15800000-0000-4000-8000-000000000005', 'scope-co-teacher@example.test'),
  ('15800000-0000-4000-8000-000000000006', 'scope-other-teacher@example.test'),
  ('15800000-0000-4000-8000-000000000007', 'scope-platform-teacher@example.test'),
  ('15800000-0000-4000-8000-000000000008', 'scope-unassigned-teacher@example.test');
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';

-- Platform teacher role for user 7 only.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '15800000-0000-4000-8000-000000000007', id, 'system', NULL, DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin;

INSERT INTO public.classrooms(id, name) VALUES
  ('15800000-0000-4000-8000-0000000000c1', 'Scope Classroom One'),
  ('15800000-0000-4000-8000-0000000000c2', 'Scope Classroom Two');
INSERT INTO public.courses(id, subject, stage) VALUES
  ('15800000-0000-4000-8000-0000000000d1', 'Scope Course One', 'primary'),
  ('15800000-0000-4000-8000-0000000000d2', 'Scope Course Two', 'primary');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, start_date) VALUES
  ('15800000-0000-4000-8000-0000000000e1', 'Scope Session One', '15800000-0000-4000-8000-0000000000c1',
   ARRAY['15800000-0000-4000-8000-0000000000d1']::uuid[], '09:00', '10:00', CURRENT_DATE - 30),
  ('15800000-0000-4000-8000-0000000000e2', 'Scope Session Two', '15800000-0000-4000-8000-0000000000c2',
   ARRAY['15800000-0000-4000-8000-0000000000d2']::uuid[], '11:00', '12:00', CURRENT_DATE - 30);

-- Classroom-level teacher role for user 3 in classroom two.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
SELECT '15800000-0000-4000-8000-000000000003', id, 'classroom', '15800000-0000-4000-8000-0000000000c2', DATE '2020-01-01', 'active'
FROM public.roles WHERE code = 'teacher' AND domain = 'teaching' AND is_builtin;

-- Teacher records: 2 and 5 teach session one, 6 teaches session two, 8 has no class.
INSERT INTO public.teacher_records(id, profile_id)
SELECT ('15800000-0000-4000-8000-0000000000f' || right(profile.auth_user_id::text, 1))::uuid, profile.id
FROM public.profiles profile
WHERE profile.auth_user_id IN ('15800000-0000-4000-8000-000000000002', '15800000-0000-4000-8000-000000000005',
                               '15800000-0000-4000-8000-000000000006', '15800000-0000-4000-8000-000000000008');

SELECT set_config('request.jwt.claim.sub', '15800000-0000-4000-8000-000000000001', true);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT fixture.session_id, fixture.teacher_id, role.id, CURRENT_DATE - 30, NULL
FROM (VALUES
  ('15800000-0000-4000-8000-0000000000e1'::uuid, '15800000-0000-4000-8000-0000000000f2'::uuid),
  ('15800000-0000-4000-8000-0000000000e1'::uuid, '15800000-0000-4000-8000-0000000000f5'::uuid),
  ('15800000-0000-4000-8000-0000000000e2'::uuid, '15800000-0000-4000-8000-0000000000f6'::uuid)
) AS fixture(session_id, teacher_id)
CROSS JOIN public.roles role
WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.students(id, name) VALUES
  ('15800000-0000-4000-8000-0000000000a1', 'Scope Student One'),
  ('15800000-0000-4000-8000-0000000000a2', 'Scope Student Two');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, start_date, lesson_number) VALUES
  ('15800000-0000-4000-8000-0000000000b1', '15800000-0000-4000-8000-0000000000a1', '15800000-0000-4000-8000-0000000000d1',
   '15800000-0000-4000-8000-0000000000c1', '15800000-0000-4000-8000-0000000000e1', 'regular', CURRENT_DATE - 30, 1),
  ('15800000-0000-4000-8000-0000000000b2', '15800000-0000-4000-8000-0000000000a2', '15800000-0000-4000-8000-0000000000d2',
   '15800000-0000-4000-8000-0000000000c2', '15800000-0000-4000-8000-0000000000e2', 'regular', CURRENT_DATE - 30, 1);
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted) VALUES
  ('15800000-0000-4000-8000-000000000011', '15800000-0000-4000-8000-0000000000e1', CURRENT_DATE - 1, 'completed', true),
  ('15800000-0000-4000-8000-000000000012', '15800000-0000-4000-8000-0000000000e2', CURRENT_DATE - 1, 'completed', true);
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version, is_completed, attendance_status) VALUES
  ('15800000-0000-4000-8000-000000000021', '15800000-0000-4000-8000-0000000000b1', '15800000-0000-4000-8000-000000000011', '', 1, false, 'present'),
  ('15800000-0000-4000-8000-000000000022', '15800000-0000-4000-8000-0000000000b2', '15800000-0000-4000-8000-000000000012', '', 1, false, 'present')
ON CONFLICT (enrollment_id, class_occurrence_id) DO UPDATE SET attendance_status = 'present', content = '', is_completed = false;
INSERT INTO public.holidays(id, name, start_date, end_date) VALUES
  ('15800000-0000-4000-8000-000000000031', 'Scope Platform Holiday', CURRENT_DATE + 10, CURRENT_DATE + 11);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Session-only teacher (class roster grant in session one).
SELECT set_config('request.jwt.claim.sub', '15800000-0000-4000-8000-000000000002', true);
DO $$
DECLARE v jsonb; v_ids uuid[];
BEGIN
  IF NOT public.has_active_teaching_role(auth.uid()) THEN
    RAISE EXCEPTION 'class roster grant must count as an active teaching role';
  END IF;
  IF public.has_api_permission(auth.uid(), 'teaching.students.read', NULL, NULL) THEN
    RAISE EXCEPTION 'session teacher must not hold platform student read';
  END IF;
  IF NOT public.has_teaching_permission_any_scope(auth.uid(), 'teaching.students.read')
     OR NOT public.has_teaching_permission_any_scope(auth.uid(), 'teaching.reports.list') THEN
    RAISE EXCEPTION 'session teacher must hold scoped student/report permissions';
  END IF;
  IF public.has_teaching_permission_any_scope(auth.uid(), 'teaching.reports.delete') THEN
    RAISE EXCEPTION 'teacher role has no report delete permission';
  END IF;

  v := public.get_dashboard_counts();
  IF (v ->> 'totalStudents')::int <> 1 OR (v ->> 'activeCourses')::int < 2 THEN
    RAISE EXCEPTION 'dashboard counts not scoped: %', v;
  END IF;

  v := public.get_classrooms_overview(25, 0, 'Scope', 'all', 50, 0, NULL);
  SELECT array_agg((item ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(v -> 'classrooms') item;
  IF v_ids IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000c1']::uuid[] THEN
    RAISE EXCEPTION 'classroom overview not scoped: %', v_ids;
  END IF;
  SELECT array_agg((item ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(v -> 'classSessions') item;
  IF v_ids IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000e1']::uuid[] THEN
    RAISE EXCEPTION 'session overview not scoped: %', v_ids;
  END IF;

  v := public.get_courses_overview(25, 0, 'Scope Course', 'display_name');
  IF (v ->> 'total')::int <> 2 THEN RAISE EXCEPTION 'courses are platform data readable from any scope: %', v; END IF;

  v := public.get_incomplete_reports_page(90, 'all', 25, 0, 'Scope', '-date');
  IF (v ->> 'total')::int <> 1 OR v #>> '{items,0,reportId}' <> '15800000-0000-4000-8000-000000000021' THEN
    RAISE EXCEPTION 'incomplete reports not scoped: %', v;
  END IF;

  v := public.get_teachers_overview(25, 0, '', 'name');
  SELECT array_agg((item ->> 'id')::uuid ORDER BY item ->> 'id') INTO v_ids FROM jsonb_array_elements(v -> 'items') item;
  IF v_ids IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000f2', '15800000-0000-4000-8000-0000000000f5']::uuid[] THEN
    RAISE EXCEPTION 'teacher overview must list only co-teachers: %', v_ids;
  END IF;

  v := public.get_holidays_overview(100, 0, 'Scope Platform', '-start_date', false);
  IF (v ->> 'total')::int <> 1 THEN RAISE EXCEPTION 'platform holidays readable from any scope: %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.holidays WHERE id = '15800000-0000-4000-8000-000000000031') THEN
    RAISE EXCEPTION 'platform holiday RLS read must accept a scoped grant';
  END IF;

  v := public.get_my_teaching_capabilities();
  IF (v #>> '{teaching.students.list,any}')::boolean IS NOT TRUE
     OR (v #>> '{teaching.students.list,platform}')::boolean IS NOT FALSE
     OR (v #>> '{teaching.courses.create,platform}')::boolean IS NOT FALSE
     OR (v #>> '{teaching.reports.delete,any}')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'capability summary wrong: %', v;
  END IF;

  IF NOT public.can_create_occurrence_report('15800000-0000-4000-8000-0000000000b1', '15800000-0000-4000-8000-000000000011') THEN
    RAISE EXCEPTION 'session teacher must create reports in own session';
  END IF;
  IF public.can_create_occurrence_report('15800000-0000-4000-8000-0000000000b2', '15800000-0000-4000-8000-000000000012') THEN
    RAISE EXCEPTION 'session teacher must not create reports in another session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_occurrence_report_mutation_context('15800000-0000-4000-8000-000000000021', 'teaching.reports.update')) THEN
    RAISE EXCEPTION 'session teacher must update reports in own session';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_occurrence_report_mutation_context('15800000-0000-4000-8000-000000000022', 'teaching.reports.update')) THEN
    RAISE EXCEPTION 'session teacher must not update reports in another session';
  END IF;

  -- RLS on direct table reads.
  IF (SELECT array_agg(id) FROM public.classrooms WHERE name LIKE 'Scope%') IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000c1']::uuid[]
     OR (SELECT array_agg(id) FROM public.class_sessions WHERE name LIKE 'Scope%') IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000e1']::uuid[]
     OR (SELECT count(*) FROM public.courses WHERE subject LIKE 'Scope Course%') <> 2 THEN
    RAISE EXCEPTION 'RLS reads not scoped';
  END IF;
END;
$$;

-- Classroom-level teacher in classroom two.
SELECT set_config('request.jwt.claim.sub', '15800000-0000-4000-8000-000000000003', true);
DO $$
DECLARE v jsonb; v_ids uuid[];
BEGIN
  v := public.get_classrooms_overview(25, 0, 'Scope', 'all', 50, 0, NULL);
  SELECT array_agg((item ->> 'id')::uuid) INTO v_ids FROM jsonb_array_elements(v -> 'classSessions') item;
  IF v_ids IS DISTINCT FROM ARRAY['15800000-0000-4000-8000-0000000000e2']::uuid[] THEN
    RAISE EXCEPTION 'classroom teacher must see sessions of own classroom: %', v_ids;
  END IF;
  IF NOT public.can_create_occurrence_report('15800000-0000-4000-8000-0000000000b2', '15800000-0000-4000-8000-000000000012') THEN
    RAISE EXCEPTION 'classroom teacher must create reports in own classroom';
  END IF;
  IF NOT public.can_teaching_scope_action('classrooms', 'update', '15800000-0000-4000-8000-0000000000c2', NULL)
     OR public.can_teaching_scope_action('classrooms', 'update', '15800000-0000-4000-8000-0000000000c1', NULL) THEN
    RAISE EXCEPTION 'classroom update must follow classroom scope';
  END IF;
END;
$$;

-- Outsider without any teaching role.
SELECT set_config('request.jwt.claim.sub', '15800000-0000-4000-8000-000000000004', true);
DO $$
DECLARE v jsonb;
BEGIN
  IF public.has_active_teaching_role(auth.uid())
     OR public.has_teaching_permission_any_scope(auth.uid(), 'teaching.students.read') THEN
    RAISE EXCEPTION 'outsider must hold nothing';
  END IF;
  v := public.get_classrooms_overview(25, 0, 'Scope', 'all', 50, 0, NULL);
  IF (v ->> 'classroomTotal')::int <> 0 OR (v ->> 'sessionTotal')::int <> 0 THEN RAISE EXCEPTION 'outsider sees classrooms: %', v; END IF;
  v := public.get_courses_overview(25, 0, 'Scope Course', 'display_name');
  IF (v ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'outsider sees courses: %', v; END IF;
  IF EXISTS (SELECT 1 FROM public.class_sessions WHERE name LIKE 'Scope%') THEN RAISE EXCEPTION 'outsider reads sessions'; END IF;
  -- Asking about another user is refused.
  IF public.has_teaching_permission_any_scope('15800000-0000-4000-8000-000000000007', 'teaching.students.read') THEN
    RAISE EXCEPTION 'any-scope check must only answer for the caller';
  END IF;
END;
$$;

-- Platform teacher sees every teacher, including one with no class yet.
SELECT set_config('request.jwt.claim.sub', '15800000-0000-4000-8000-000000000007', true);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.get_teachers_overview(100, 0, '', 'name');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v -> 'items') item WHERE item ->> 'id' = '15800000-0000-4000-8000-0000000000f8') THEN
    RAISE EXCEPTION 'unassigned teacher missing from platform teacher list: %', v;
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
