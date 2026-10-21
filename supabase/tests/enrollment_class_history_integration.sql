-- Rollback-only fixture for 1000143: date-effective class transfers.
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_teaching_id uuid;
  owner_id uuid := '7d000000-0000-4000-8000-000000000007';
  v_classroom_id uuid := '7d000000-0000-4000-8000-000000000001';
  v_course_id uuid := '7d000000-0000-4000-8000-000000000002';
  v_student_id uuid := '7d000000-0000-4000-8000-000000000003';
  v_enrollment_id uuid := '7d000000-0000-4000-8000-000000000004';
  session_a uuid := '7d000000-0000-4000-8000-0000000000a1';
  session_b uuid := '7d000000-0000-4000-8000-0000000000b1';
  a_0926 uuid := '7d000000-0000-4000-8000-0000000000a2';
  a_1003 uuid := '7d000000-0000-4000-8000-0000000000a3';
  a_1010 uuid := '7d000000-0000-4000-8000-0000000000a4';
  b_1003 uuid := '7d000000-0000-4000-8000-0000000000b2';
  b_1010 uuid := '7d000000-0000-4000-8000-0000000000b3';
  b_1017 uuid := '7d000000-0000-4000-8000-0000000000b4';
  report_0926 uuid := '7d000000-0000-4000-8000-000000000011';
  report_1003 uuid := '7d000000-0000-4000-8000-000000000012';
  report_1010 uuid := '7d000000-0000-4000-8000-000000000013';
  result jsonb;
BEGIN
  SELECT id INTO v_teaching_id FROM public.teachings WHERE is_global LIMIT 1;
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'class-history-owner@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES (v_classroom_id, 'History classroom', owner_id, v_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES (v_course_id, 'History course', 'primary', owner_id, v_teaching_id);
  INSERT INTO public.students(id, name, user_id) VALUES (v_student_id, 'History Student', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time)
  VALUES (session_a, 'Saturday 10:00', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '10:00', '12:00'),
         (session_b, 'Saturday 13:30', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '13:30', '15:30');
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (v_enrollment_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'regular', DATE '2026-09-01');

  IF (SELECT count(*) FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_a AND effective_from = DATE '2026-09-01' AND effective_to IS NULL) <> 1 THEN
    RAISE EXCEPTION 'enrollment insert did not open a class history segment';
  END IF;

  INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
  VALUES (a_0926, session_a, DATE '2026-09-26', 'scheduled', true),
         (a_1003, session_a, DATE '2026-10-03', 'scheduled', true),
         (a_1010, session_a, DATE '2026-10-10', 'scheduled', true),
         (b_1003, session_b, DATE '2026-10-03', 'scheduled', true),
         (b_1010, session_b, DATE '2026-10-10', 'scheduled', true),
         (b_1017, session_b, DATE '2026-10-17', 'scheduled', true);
  INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content)
  VALUES (report_0926, v_enrollment_id, a_0926, 'September lesson'),
         (report_1003, v_enrollment_id, a_1003, 'Written before the transfer'),
         (report_1010, v_enrollment_id, a_1010, NULL);

  result := public.transfer_enrollment_class(v_enrollment_id, session_b, DATE '2026-10-03');

  IF (SELECT class_session_id FROM public.enrollments WHERE id = v_enrollment_id) <> session_b THEN
    RAISE EXCEPTION 'class transfer did not update the current class';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_a AND effective_to = DATE '2026-10-02')
     OR NOT EXISTS (SELECT 1 FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_b AND effective_from = DATE '2026-10-03' AND effective_to IS NULL) THEN
    RAISE EXCEPTION 'class transfer did not split the history at the effective date';
  END IF;

  IF jsonb_array_length(result->'retained_reports') <> 1 OR (result->'retained_reports'->0->>'report_id')::uuid <> report_1003 THEN
    RAISE EXCEPTION 'contentful report on the effective date was not retained: %', result;
  END IF;
  IF (SELECT class_occurrence_id FROM public.occurrence_reports WHERE id = report_1003) <> a_1003 THEN
    RAISE EXCEPTION 'contentful report moved out of the old class';
  END IF;
  -- 10/03 already holds the retained report, so the placeholder skips B's 10/03.
  IF (SELECT class_occurrence_id FROM public.occurrence_reports WHERE id = report_1010) IS DISTINCT FROM b_1010 THEN
    RAISE EXCEPTION 'blank placeholder did not move to the first free new-class date';
  END IF;
  IF (SELECT count(*) FROM public.occurrence_reports WHERE enrollment_id = v_enrollment_id) <> 3 THEN
    RAISE EXCEPTION 'class transfer changed the report count';
  END IF;

  -- Rosters follow the history.
  IF NOT EXISTS (SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(a_0926) AS r WHERE r.enrollment_id = v_enrollment_id) THEN
    RAISE EXCEPTION 'student left the old class roster before the effective date';
  END IF;
  IF EXISTS (SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(a_1010) AS r WHERE r.enrollment_id = v_enrollment_id) THEN
    RAISE EXCEPTION 'student stayed on the old class roster after the effective date';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_effective_occurrence_enrollment_ids(b_1010) AS r WHERE r.enrollment_id = v_enrollment_id) THEN
    RAISE EXCEPTION 'student missing from the new class roster after the effective date';
  END IF;

  -- A past lesson of the old class is still a valid single-lesson transfer source.
  PERFORM public.transfer_single_lesson(v_enrollment_id, a_0926, b_1017, report_0926);
  IF (SELECT class_occurrence_id FROM public.occurrence_reports WHERE id = report_0926) IS DISTINCT FROM b_1017 THEN
    RAISE EXCEPTION 'single-lesson transfer from the previous class failed';
  END IF;

  -- A direct class change (legacy path) switches from today in the class time zone.
  UPDATE public.enrollments SET class_session_id = session_a WHERE id = v_enrollment_id;
  IF NOT EXISTS (SELECT 1 FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_a AND effective_to IS NULL AND effective_from = GREATEST(private.local_today(session_a, v_enrollment_id), DATE '2026-09-01')) THEN
    RAISE EXCEPTION 'direct class update did not open a segment from today';
  END IF;
END;
$$;

ROLLBACK;
