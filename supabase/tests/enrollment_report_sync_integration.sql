-- Rollback-only fixture for 1000144: sync_enrollment_reports.
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_teaching_id uuid;
  owner_id uuid := '7e000000-0000-4000-8000-000000000007';
  v_classroom_id uuid := '7e000000-0000-4000-8000-000000000001';
  v_course_id uuid := '7e000000-0000-4000-8000-000000000002';
  v_student_id uuid := '7e000000-0000-4000-8000-000000000003';
  v_enrollment_id uuid := '7e000000-0000-4000-8000-000000000004';
  trial_id uuid := '7e000000-0000-4000-8000-000000000005';
  session_a uuid := '7e000000-0000-4000-8000-0000000000a1';
  result jsonb;
  dates date[];
  week integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'report-sync-owner@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES (v_classroom_id, 'Sync classroom', owner_id, v_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES (v_course_id, 'Sync course', 'primary', owner_id, v_teaching_id);
  INSERT INTO public.students(id, name, user_id) VALUES (v_student_id, 'Sync Student', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time)
  VALUES (session_a, 'Saturday', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '10:00', '12:00');
  -- Ten Saturdays from 2026-09-05; the third one is cancelled.
  FOR week IN 0..9 LOOP
    INSERT INTO public.class_occurrences(class_session_id, occurrence_date, status, is_conducted)
    VALUES (session_a, DATE '2026-09-05' + week * 7, CASE WHEN week = 2 THEN 'cancelled' ELSE 'scheduled' END, true);
  END LOOP;

  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (v_enrollment_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'regular', DATE '2026-09-05');

  -- Create: four reports on the first four non-cancelled lessons.
  result := public.sync_enrollment_reports(v_enrollment_id, 4);
  SELECT array_agg(occurrence.occurrence_date ORDER BY occurrence.occurrence_date) INTO dates
  FROM public.occurrence_reports AS report JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
  WHERE report.enrollment_id = v_enrollment_id;
  IF dates <> ARRAY[DATE '2026-09-05', DATE '2026-09-12', DATE '2026-09-26', DATE '2026-10-03'] THEN
    RAISE EXCEPTION 'create placed reports on %', dates;
  END IF;

  -- Write content on the 09-12 report, then move the start date later.
  UPDATE public.occurrence_reports AS report SET content = 'kept'
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = report.class_occurrence_id AND report.enrollment_id = v_enrollment_id AND occurrence.occurrence_date = DATE '2026-09-12';

  result := public.sync_enrollment_reports(v_enrollment_id, NULL, DATE '2026-09-26', true);
  IF result->'fixed_before_start_dates' <> '["2026-09-12"]'::jsonb OR result->'removed_dates' <> '["2026-09-05"]'::jsonb
     OR result->'created_dates' <> '["2026-10-10"]'::jsonb THEN
    RAISE EXCEPTION 'dry run reported an unexpected plan: %', result;
  END IF;
  IF (SELECT count(*) FROM public.occurrence_reports WHERE enrollment_id = v_enrollment_id) <> 4 THEN
    RAISE EXCEPTION 'dry run changed reports';
  END IF;

  UPDATE public.enrollments SET start_date = DATE '2026-09-26' WHERE id = v_enrollment_id;
  result := public.sync_enrollment_reports(v_enrollment_id);
  SELECT array_agg(occurrence.occurrence_date ORDER BY occurrence.occurrence_date) INTO dates
  FROM public.occurrence_reports AS report JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
  WHERE report.enrollment_id = v_enrollment_id;
  IF dates <> ARRAY[DATE '2026-09-12', DATE '2026-09-26', DATE '2026-10-03', DATE '2026-10-10'] THEN
    RAISE EXCEPTION 'moving the start later produced %', dates;
  END IF;

  -- Move the start date earlier again: the same count shifts back.
  UPDATE public.enrollments SET start_date = DATE '2026-09-05' WHERE id = v_enrollment_id;
  result := public.sync_enrollment_reports(v_enrollment_id);
  SELECT array_agg(occurrence.occurrence_date ORDER BY occurrence.occurrence_date) INTO dates
  FROM public.occurrence_reports AS report JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
  WHERE report.enrollment_id = v_enrollment_id;
  IF dates <> ARRAY[DATE '2026-09-05', DATE '2026-09-12', DATE '2026-09-26', DATE '2026-10-03'] THEN
    RAISE EXCEPTION 'moving the start earlier produced %', dates;
  END IF;

  -- Asking for more reports than lessons reports the shortfall.
  result := public.sync_enrollment_reports(v_enrollment_id, 12, NULL, true);
  IF (result->>'missing_count')::integer <> 3 THEN
    RAISE EXCEPTION 'expected 3 missing lessons, got %', result;
  END IF;

  -- Trial enrollments get their report too, and only their own.
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (trial_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'trial', DATE '2026-10-03');
  result := public.sync_enrollment_reports(trial_id, 1);
  IF (SELECT count(*) FROM public.occurrence_reports WHERE enrollment_id = trial_id) <> 1 THEN
    RAISE EXCEPTION 'trial enrollment did not get one report';
  END IF;
  IF (SELECT count(*) FROM public.occurrence_reports WHERE enrollment_id = v_enrollment_id) <> 4 THEN
    RAISE EXCEPTION 'syncing one enrollment touched another';
  END IF;
END;
$$;

ROLLBACK;
