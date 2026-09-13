\set ON_ERROR_STOP on

-- Behavioural regression for 1000062. The fixture is transactional so the
-- clean-install, upgrade and rerun jobs can execute it repeatedly.
BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('91000000-0000-4000-8000-000000000001', 'lifecycle-owner@example.test'),
  ('91000000-0000-4000-8000-000000000002', 'lifecycle-other@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teachings(id, name, owner_user_id, is_quarantine) VALUES
  ('92000000-0000-4000-8000-000000000001', 'Lifecycle Teaching A', '91000000-0000-4000-8000-000000000001', false),
  ('92000000-0000-4000-8000-000000000002', 'Lifecycle Teaching B', '91000000-0000-4000-8000-000000000002', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', id
FROM public.roles WHERE code = 'teaching_owner'
ON CONFLICT (teaching_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active';

INSERT INTO public.classrooms(id, name, user_id, teaching_id)
VALUES ('93000000-0000-4000-8000-000000000001', 'Lifecycle Classroom', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.courses(id, subject, stage, user_id, teaching_id)
VALUES ('94000000-0000-4000-8000-000000000001', 'Lifecycle Course', 'primary', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.lessons(id, course_id, title, sequence, user_id)
VALUES
  ('95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'Lesson 1', 1, '91000000-0000-4000-8000-000000000001'),
  ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', 'Lesson 2', 2, '91000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, start_date, end_date, teaching_id)
VALUES ('96000000-0000-4000-8000-000000000001', 'Lifecycle Session', '93000000-0000-4000-8000-000000000001', ARRAY['94000000-0000-4000-8000-000000000001']::uuid[], '09:00', '10:00', '91000000-0000-4000-8000-000000000001', DATE '2026-01-01', DATE '2026-03-31', '92000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.class_session_schedule_rules(id, class_session_id, schedule_kind, day_of_week, start_time, end_time)
VALUES ('97000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'weekly', 1, '09:00', '10:00')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.students(id, name, user_id)
VALUES ('98000000-0000-4000-8000-000000000001', 'Lifecycle Student', '91000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, user_id, start_date, lesson_number)
VALUES ('99000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'regular', '91000000-0000-4000-8000-000000000001', DATE '2026-01-01', 1)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
VALUES ('9a000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', DATE '2026-01-05', 'completed', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, lesson_id, content, version, is_completed, attendance_status)
VALUES ('9b000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'before', 1, false, 'pending')
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_reports, public.enrollments, public.class_occurrences TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_report public.occurrence_reports%ROWTYPE;
  v_next_count integer;
  v_version integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.get_occurrence_report_mutation_context(
      '9b000000-0000-4000-8000-000000000001', 'teaching.reports.update'
    )
  ) THEN
    RAISE EXCEPTION 'strict report mutation context denied owner';
  END IF;
  IF NOT public.can_mutate_occurrence_report('9b000000-0000-4000-8000-000000000001', 'teaching.reports.update') THEN
    RAISE EXCEPTION 'owner cannot pass strict report permission';
  END IF;
  SELECT * INTO v_report FROM public.apply_occurrence_report_lifecycle('9b000000-0000-4000-8000-000000000001', 1, '{"is_completed":false,"content":"incomplete"}'::jsonb);
  IF v_report.version <> 2 OR v_report.is_completed IS TRUE THEN RAISE EXCEPTION 'incomplete lifecycle regression'; END IF;
  SELECT count(*) INTO v_next_count FROM public.occurrence_reports WHERE enrollment_id = '99000000-0000-4000-8000-000000000001';
  IF v_next_count <> 2 THEN RAISE EXCEPTION 'incomplete report did not provision a next report'; END IF;
  IF (SELECT lesson_number FROM public.enrollments WHERE id = '99000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'incomplete report advanced enrollment progress';
  END IF;

  SELECT * INTO v_report FROM public.apply_occurrence_report_lifecycle('9b000000-0000-4000-8000-000000000001', 2, jsonb_build_object('is_completed', true, 'lesson_id', '95000000-0000-4000-8000-000000000001'));
  IF v_report.version <> 3 OR v_report.is_completed IS NOT TRUE THEN RAISE EXCEPTION 'completed lifecycle regression'; END IF;
  SELECT count(*) INTO v_next_count FROM public.occurrence_reports WHERE enrollment_id = '99000000-0000-4000-8000-000000000001';
  IF v_next_count <> 2 THEN RAISE EXCEPTION 'next report was not provisioned'; END IF;
  SELECT version INTO v_version FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.apply_occurrence_report_lifecycle('9b000000-0000-4000-8000-000000000001', 2, '{"content":"retry"}'::jsonb);
    RAISE EXCEPTION 'stale retry unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'VERSION_CONFLICT' THEN RAISE; END IF;
  END;
  IF (SELECT version FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000001') <> v_version THEN RAISE EXCEPTION 'stale retry mutated data'; END IF;

  BEGIN
    PERFORM public.apply_occurrence_report_lifecycle('9b000000-0000-4000-8000-000000000001', 3, '{"content_document":null,"progress_letter":"not-valid"}'::jsonb);
    RAISE EXCEPTION 'invalid lifecycle patch unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_REPORT_PATCH' THEN RAISE; END IF;
  END;
  IF (SELECT version FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000001') <> 3 THEN RAISE EXCEPTION 'failed lifecycle patch did not rollback'; END IF;

  BEGIN
    PERFORM public.apply_occurrence_report_lifecycle(
      '9b000000-0000-4000-8000-000000000001', 3, '{"unknown_field":true}'::jsonb
    );
    RAISE EXCEPTION 'unknown lifecycle patch field unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_REPORT_PATCH_FIELD' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.apply_occurrence_report_lifecycle(
      '9b000000-0000-4000-8000-000000000001', 3, '{"is_completed":"yes"}'::jsonb
    );
    RAISE EXCEPTION 'wrong lifecycle patch type unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_REPORT_PATCH' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.apply_occurrence_report_lifecycle(
      '9b000000-0000-4000-8000-000000000001', 3, '{"class_participation":6}'::jsonb
    );
    RAISE EXCEPTION 'out-of-range lifecycle patch unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_REPORT_PATCH' THEN RAISE; END IF;
  END;
  IF (SELECT version FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'rejected lifecycle patch mutated report';
  END IF;

  SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
  IF public.can_mutate_occurrence_report('9b000000-0000-4000-8000-000000000001', 'teaching.reports.update') THEN
    RAISE EXCEPTION 'cross-teaching report write was authorized';
  END IF;
  SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
  PERFORM public.apply_occurrence_report_lifecycle('9b000000-0000-4000-8000-000000000001', 3, '{}'::jsonb, auth.uid(), 'delete');
  IF EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'delete lifecycle regression'; END IF;
END;
$$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.api_idempotency_keys(
  user_id, idempotency_key, method, route, response_status, response_body,
  resource_id, teaching_id, classroom_id, class_session_id, permission_key
) VALUES (
  '91000000-0000-4000-8000-000000000001',
  'lifecycle-delete-replay-001', 'DELETE', '/api/reports/9b00000', 200,
  '{"data":{"deleted":true},"meta":{},"request_id":"first","trace_id":"first"}'::jsonb,
  '9b000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'teaching.reports.delete'
)
ON CONFLICT (user_id, idempotency_key) DO UPDATE SET response_status = EXCLUDED.response_status, response_body = EXCLUDED.response_body;
DO $$
DECLARE
  v_replay record;
BEGIN
  SELECT * INTO v_replay FROM public.replay_deleted_report_idempotency(
    '91000000-0000-4000-8000-000000000001', 'lifecycle-delete-replay-001',
    'DELETE', '/api/reports/9b00000', '9b000000-0000-4000-8000-000000000001', 'teaching.reports.delete'
  );
  IF v_replay.is_replay IS DISTINCT FROM true OR v_replay.response_status <> 200 THEN
    RAISE EXCEPTION 'delete replay was not authorized';
  END IF;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT member.role_id, permission.id, 'teaching', teaching.id, 'deny'
  FROM public.teaching_members member
  JOIN public.permissions permission ON permission.key = 'teaching.reports.delete'
  JOIN public.teachings teaching ON teaching.id = '92000000-0000-4000-8000-000000000001'
  WHERE member.teaching_id = teaching.id
    AND member.user_id = '91000000-0000-4000-8000-000000000001'
  ON CONFLICT DO NOTHING;
  IF EXISTS (SELECT 1 FROM public.replay_deleted_report_idempotency(
    '91000000-0000-4000-8000-000000000001', 'lifecycle-delete-replay-001',
    'DELETE', '/api/reports/9b00000', '9b000000-0000-4000-8000-000000000001', 'teaching.reports.delete'
  )) THEN
    RAISE EXCEPTION 'delete replay survived explicit permission deny';
  END IF;
  DELETE FROM public.teaching_members
  WHERE teaching_id = '92000000-0000-4000-8000-000000000001'
    AND user_id = '91000000-0000-4000-8000-000000000001';
  IF EXISTS (SELECT 1 FROM public.replay_deleted_report_idempotency(
    '91000000-0000-4000-8000-000000000001', 'lifecycle-delete-replay-001',
    'DELETE', '/api/reports/9b00000', '9b000000-0000-4000-8000-000000000001', 'teaching.reports.delete'
  )) THEN
    RAISE EXCEPTION 'delete replay survived membership revocation';
  END IF;
END;
$$;
RESET ROLE;

RESET ROLE;
ROLLBACK;

DO $$
BEGIN
  IF to_regprocedure('public.can_mutate_occurrence_report(uuid,text)') IS NULL
     OR to_regprocedure('public.apply_occurrence_report_lifecycle(uuid,integer,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'report lifecycle functions are missing';
  END IF;
END;
$$;
