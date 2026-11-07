-- Rollback-only fixture for 1000147: per-class dashboard schedule modes.
-- Most specific scope wins per role, the strictest explicit mode wins across
-- teaching roles, roles without a policy never restrict, and system roles no
-- longer widen the schedule.
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_teaching_id uuid;
  owner_id uuid := '7e000000-0000-4000-8000-000000000001';
  admin_user uuid := '7e000000-0000-4000-8000-000000000002';
  plain_user uuid := '7e000000-0000-4000-8000-000000000003';
  manager_user uuid := '7e000000-0000-4000-8000-000000000004';
  hide_role uuid := '7e000000-0000-4000-8000-000000000005';
  classroom_a uuid := '7e000000-0000-4000-8000-0000000000a0';
  classroom_b uuid := '7e000000-0000-4000-8000-0000000000b0';
  session_a1 uuid := '7e000000-0000-4000-8000-0000000000a1';
  session_a2 uuid := '7e000000-0000-4000-8000-0000000000a2';
  session_b1 uuid := '7e000000-0000-4000-8000-0000000000b1';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (owner_id, 'schedule-owner@example.test'),
    (admin_user, 'schedule-admin@example.test'),
    (plain_user, 'schedule-plain@example.test'),
    (manager_user, 'schedule-manager@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES
    (classroom_a, 'Schedule classroom A', owner_id, v_teaching_id),
    (classroom_b, 'Schedule classroom B', owner_id, v_teaching_id);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time) VALUES
    (session_a1, 'A1', classroom_a, '{}'::uuid[], owner_id, v_teaching_id, '10:00', '12:00'),
    (session_a2, 'A2', classroom_a, '{}'::uuid[], owner_id, v_teaching_id, '13:00', '15:00'),
    (session_b1, 'B1', classroom_b, '{}'::uuid[], owner_id, v_teaching_id, '10:00', '12:00');

  -- admin_user: system admin who also holds a teaching role hidden in
  -- classroom A and lifted to "all" in class A2; nothing set for classroom B.
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  SELECT admin_user, role.id, 'system', NULL, DATE '2026-01-01', 'active'
  FROM public.roles role WHERE role.code = 'system_admin' AND role.domain = 'system' AND role.is_builtin;
  INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
  VALUES (hide_role, 'schedule_fixture_hidden', 'Schedule Fixture Hidden', false, 951, 'teaching', NULL, false, false);
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT hide_role, permission.id, scope.scope_type, scope.scope_id, scope.effect
  FROM (VALUES
    ('teaching.dashboard.schedule.view', 'classroom', classroom_a, 'deny'),
    ('teaching.dashboard.schedule.view', 'class_session', session_a2, 'allow'),
    ('teaching.dashboard.schedule.all', 'class_session', session_a2, 'allow')
  ) AS scope(permission_key, scope_type, scope_id, effect)
  JOIN public.permissions permission ON permission.key = scope.permission_key;
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  VALUES (admin_user, hide_role, 'system', NULL, DATE '2026-01-01', 'active');

  -- manager_user: built-in teaching manager (seeded schedule.all = allow).
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  SELECT manager_user, role.id, 'system', NULL, DATE '2026-01-01', 'active'
  FROM public.roles role WHERE role.code = 'teaching_manager' AND role.domain = 'teaching' AND role.is_builtin;
END;
$$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  sessions uuid[] := ARRAY['7e000000-0000-4000-8000-0000000000a1', '7e000000-0000-4000-8000-0000000000a2', '7e000000-0000-4000-8000-0000000000b1']::uuid[];
  modes text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000002', true);
  SELECT string_agg(mode, ',' ORDER BY class_session_id) INTO modes
  FROM public.resolve_dashboard_schedule_modes('7e000000-0000-4000-8000-000000000002', sessions, DATE '2026-10-17');
  IF modes IS DISTINCT FROM 'hidden,all,assigned' THEN
    RAISE EXCEPTION 'only the teaching role should decide the admin''s schedule (hidden,all,assigned), got %', modes;
  END IF;
  IF EXISTS (SELECT 1 FROM public.permissions WHERE key = 'system.dashboard.schedule.all') THEN
    RAISE EXCEPTION 'system.dashboard.schedule.all should be removed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000003', true);
  SELECT string_agg(mode, ',' ORDER BY class_session_id) INTO modes
  FROM public.resolve_dashboard_schedule_modes('7e000000-0000-4000-8000-000000000003', sessions, DATE '2026-10-17');
  IF modes IS DISTINCT FROM 'assigned,assigned,assigned' THEN
    RAISE EXCEPTION 'a user without explicit modes should only see assigned classes, got %', modes;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000004', true);
  SELECT string_agg(mode, ',' ORDER BY class_session_id) INTO modes
  FROM public.resolve_dashboard_schedule_modes('7e000000-0000-4000-8000-000000000004', sessions, DATE '2026-10-17');
  IF modes IS DISTINCT FROM 'all,all,all' THEN
    RAISE EXCEPTION 'teaching manager should keep seeing every class, got %', modes;
  END IF;

  -- Another user's modes are never revealed.
  SELECT count(*)::text INTO modes
  FROM public.resolve_dashboard_schedule_modes('7e000000-0000-4000-8000-000000000002', sessions, DATE '2026-10-17');
  IF modes <> '0' THEN RAISE EXCEPTION 'resolver leaked another user''s modes'; END IF;
END;
$$;

ROLLBACK;
