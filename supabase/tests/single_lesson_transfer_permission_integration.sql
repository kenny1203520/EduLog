-- Rollback-only fixture for 1000146: who may make a single-lesson transfer.
-- A user with teaching.enrollments.update in both classes may transfer, an
-- assigned teacher of both lessons still may, and anyone else is refused,
-- including on an enrollment without an owner (user_id NULL).
BEGIN;

SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_teaching_id uuid;
  owner_id uuid := '7f000000-0000-4000-8000-000000000001';
  rbac_user uuid := '7f000000-0000-4000-8000-000000000002';
  teacher_user uuid := '7f000000-0000-4000-8000-000000000003';
  plain_user uuid := '7f000000-0000-4000-8000-000000000004';
  v_role_id uuid := '7f000000-0000-4000-8000-000000000005';
  v_teacher_id uuid := '7f000000-0000-4000-8000-000000000006';
  v_classroom_id uuid := '7f000000-0000-4000-8000-000000000010';
  v_course_id uuid := '7f000000-0000-4000-8000-000000000011';
  v_student_id uuid := '7f000000-0000-4000-8000-000000000012';
  v_enrollment_id uuid := '7f000000-0000-4000-8000-000000000013';
  session_a uuid := '7f000000-0000-4000-8000-0000000000a1';
  session_b uuid := '7f000000-0000-4000-8000-0000000000b1';
  week integer;
BEGIN
  SELECT id INTO v_teaching_id FROM public.teachings WHERE is_global LIMIT 1;
  INSERT INTO auth.users(id, email) VALUES
    (owner_id, 'permission-owner@example.test'),
    (rbac_user, 'permission-rbac@example.test'),
    (teacher_user, 'permission-teacher@example.test'),
    (plain_user, 'permission-plain@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES (v_classroom_id, 'Permission classroom', owner_id, v_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES (v_course_id, 'Permission course', 'primary', owner_id, v_teaching_id);
  INSERT INTO public.students(id, name, user_id) VALUES (v_student_id, 'Permission Student', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time)
  VALUES (session_a, 'Saturday 10:00', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '10:00', '12:00'),
         (session_b, 'Saturday 13:30', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '13:30', '15:30');
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (v_enrollment_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'regular', DATE '2026-09-01');
  FOR week IN 0..2 LOOP
    INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
    VALUES (('7f000000-0000-4000-8000-0000000001a' || week)::uuid, session_a, DATE '2026-10-03' + week * 7, 'scheduled', true),
           (('7f000000-0000-4000-8000-0000000001b' || week)::uuid, session_b, DATE '2026-10-03' + week * 7, 'scheduled', true);
  END LOOP;

  -- rbac_user: enrollment update allowed on the classroom (covers both sessions).
  INSERT INTO public.roles(id, code, name, is_system, sort_order, domain, teaching_id, is_builtin, is_protected)
  VALUES (v_role_id, 'permission_fixture_enrollment_editor', 'Permission Fixture Enrollment Editor', false, 950, 'teaching', NULL, false, false);
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT v_role_id, permission.id, 'classroom', v_classroom_id, 'allow'
  FROM public.permissions AS permission WHERE permission.key = 'teaching.enrollments.update';
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
  VALUES (rbac_user, v_role_id, 'classroom', v_classroom_id, DATE '2026-01-01', 'active');

  -- teacher_user: assigned teacher of both sessions, without the RBAC grant.
  INSERT INTO public.teacher_records(id, profile_id)
  SELECT v_teacher_id, profile.id FROM public.profiles AS profile WHERE profile.auth_user_id = teacher_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'fixture teacher profile missing'; END IF;
  INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from)
  SELECT session_id, v_teacher_id, role.id, DATE '2026-01-01'
  FROM unnest(ARRAY[session_a, session_b]) AS session_id
  CROSS JOIN public.roles AS role
  WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
END;
$$;

SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- An RBAC editor who teaches neither class may transfer.
SELECT set_config('request.jwt.claim.sub', '7f000000-0000-4000-8000-000000000002', true);
SELECT public.transfer_single_lesson('7f000000-0000-4000-8000-000000000013', '7f000000-0000-4000-8000-0000000001a0', '7f000000-0000-4000-8000-0000000001b0', NULL);

-- An assigned teacher of both lessons still may.
SELECT set_config('request.jwt.claim.sub', '7f000000-0000-4000-8000-000000000003', true);
SELECT public.transfer_single_lesson('7f000000-0000-4000-8000-000000000013', '7f000000-0000-4000-8000-0000000001a1', '7f000000-0000-4000-8000-0000000001b1', NULL);

-- Anyone else is refused.
SELECT set_config('request.jwt.claim.sub', '7f000000-0000-4000-8000-000000000004', true);
DO $$
DECLARE
  v_error text;
BEGIN
  -- The enrollment has no owner (user_id NULL); that must not skip the check.
  BEGIN
    PERFORM public.transfer_single_lesson('7f000000-0000-4000-8000-000000000013', '7f000000-0000-4000-8000-0000000001a2', '7f000000-0000-4000-8000-0000000001b2', NULL);
    v_error := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error <> 'SINGLE_LESSON_TRANSFER_FORBIDDEN' THEN
    RAISE EXCEPTION 'transfer by an unauthorized user: expected SINGLE_LESSON_TRANSFER_FORBIDDEN, got %', v_error;
  END IF;

  BEGIN
    PERFORM public.repair_single_lesson_transfer_report('7f000000-0000-4000-8000-000000000013', '7f000000-0000-4000-8000-0000000001b0');
    v_error := 'allowed';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error <> 'SINGLE_LESSON_TRANSFER_FORBIDDEN' THEN
    RAISE EXCEPTION 'report repair by an unauthorized user: expected SINGLE_LESSON_TRANSFER_FORBIDDEN, got %', v_error;
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.single_lesson_transfers
      WHERE enrollment_id = '7f000000-0000-4000-8000-000000000013' AND cancelled_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the two permitted transfers';
  END IF;
END;
$$;

ROLLBACK;
