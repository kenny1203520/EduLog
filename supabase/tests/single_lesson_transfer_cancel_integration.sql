-- Rollback-only fixture for 1000142: cancelling single-lesson transfers.
-- Covers the plain move-back, blank/contentful source reports, chained
-- transfers, conflict-tool merges restored from the archive, and the
-- occurrence transfer listing used by the class page.
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_teaching_id uuid;
  v_classroom_id uuid := '7c000000-0000-4000-8000-000000000001';
  v_course_id uuid := '7c000000-0000-4000-8000-000000000002';
  v_student_id uuid := '7c000000-0000-4000-8000-000000000003';
  v_enrollment_id uuid := '7c000000-0000-4000-8000-000000000004';
  session_a uuid := '7c000000-0000-4000-8000-0000000000a1';
  session_b uuid := '7c000000-0000-4000-8000-0000000000b1';
  session_c uuid := '7c000000-0000-4000-8000-0000000000c1';
  occ_a uuid := '7c000000-0000-4000-8000-0000000000a2';
  occ_b uuid := '7c000000-0000-4000-8000-0000000000b2';
  occ_c uuid := '7c000000-0000-4000-8000-0000000000c2';
  report_id uuid := '7c000000-0000-4000-8000-000000000005';
  standalone_id uuid := '7c000000-0000-4000-8000-000000000006';
  owner_id uuid := '7c000000-0000-4000-8000-000000000007';
  transfer_ab uuid;
  transfer_bc uuid;
  result jsonb;
  failed boolean;
  row_count integer;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'transfer-cancel-owner@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES (v_classroom_id, 'Cancel fixture classroom', owner_id, v_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES (v_course_id, 'Cancel fixture', 'primary', owner_id, v_teaching_id);
  INSERT INTO public.students(id, name, user_id) VALUES (v_student_id, 'Cancel Fixture Student', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time)
  VALUES
    (session_a, 'Session A', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '10:00', '12:00'),
    (session_b, 'Session B', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '13:30', '15:30'),
    (session_c, 'Session C', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '16:00', '18:00');
  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (v_enrollment_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'regular', DATE '2026-09-01');
  INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
  VALUES (occ_a, session_a, DATE '2026-10-03', 'scheduled', false),
         (occ_b, session_b, DATE '2026-10-03', 'scheduled', false),
         (occ_c, session_c, DATE '2026-10-03', 'scheduled', false);
  INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content)
  VALUES (report_id, v_enrollment_id, occ_a, 'original report');

  -- 1. Plain move-back, with a blank placeholder that appeared on the source.
  transfer_ab := public.transfer_single_lesson(v_enrollment_id, occ_a, occ_b, report_id);
  INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id) VALUES (v_enrollment_id, occ_a);
  IF NOT EXISTS (SELECT 1 FROM public.get_occurrence_lesson_transfers(occ_a) AS t WHERE t.direction = 'out' AND t.transfer_id = transfer_ab AND t.other_session_name = 'Session B') THEN
    RAISE EXCEPTION 'source occurrence did not list the outgoing transfer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_occurrence_lesson_transfers(occ_b) AS t WHERE t.direction = 'in' AND t.transfer_id = transfer_ab) THEN
    RAISE EXCEPTION 'target occurrence did not list the incoming transfer';
  END IF;
  result := public.cancel_single_lesson_transfer(transfer_ab);
  IF (SELECT class_occurrence_id FROM public.occurrence_reports WHERE id = report_id) <> occ_a THEN
    RAISE EXCEPTION 'cancel did not move the report back to the source occurrence';
  END IF;
  SELECT count(*) INTO row_count FROM public.occurrence_reports WHERE enrollment_id = v_enrollment_id AND class_occurrence_id = occ_a;
  IF row_count <> 1 THEN RAISE EXCEPTION 'blank source placeholder was not replaced (% reports)', row_count; END IF;
  IF (SELECT cancelled_at FROM public.single_lesson_transfers WHERE id = transfer_ab) IS NULL THEN
    RAISE EXCEPTION 'cancel did not mark the transfer cancelled';
  END IF;
  IF (result->>'restored_report_id')::uuid <> report_id THEN RAISE EXCEPTION 'unexpected cancel result %', result; END IF;

  -- 2. A source report with content blocks the cancel.
  transfer_ab := public.transfer_single_lesson(v_enrollment_id, occ_a, occ_b, report_id);
  INSERT INTO public.occurrence_reports(enrollment_id, class_occurrence_id, content) VALUES (v_enrollment_id, occ_a, 'written later');
  failed := false;
  BEGIN
    PERFORM public.cancel_single_lesson_transfer(transfer_ab);
  EXCEPTION WHEN OTHERS THEN
    failed := SQLERRM = 'SOURCE_REPORT_HAS_CONTENT';
  END;
  IF NOT failed THEN RAISE EXCEPTION 'cancel ignored a contentful source report'; END IF;
  DELETE FROM public.occurrence_reports WHERE enrollment_id = v_enrollment_id AND class_occurrence_id = occ_a;

  -- 3. Cancelling the head of A -> B -> C returns the report from C to A.
  transfer_bc := public.transfer_single_lesson(v_enrollment_id, occ_b, occ_c, report_id);
  result := public.cancel_single_lesson_transfer(transfer_ab);
  IF (SELECT class_occurrence_id FROM public.occurrence_reports WHERE id = report_id) <> occ_a THEN
    RAISE EXCEPTION 'chain cancel did not return the report to the head source';
  END IF;
  IF EXISTS (SELECT 1 FROM public.single_lesson_transfers WHERE id IN (transfer_ab, transfer_bc) AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'chain cancel left an onward link active';
  END IF;

  -- 4. A conflict-tool merge is undone from the archive.
  INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content)
  VALUES (standalone_id, v_enrollment_id, occ_b, 'standalone target');
  result := public.resolve_single_lesson_transfer_conflict(
    v_enrollment_id, occ_a, occ_b,
    report_id, (SELECT COALESCE(version, 1) FROM public.occurrence_reports WHERE id = report_id),
    standalone_id, (SELECT COALESCE(version, 1) FROM public.occurrence_reports WHERE id = standalone_id),
    jsonb_build_object(
      'lesson_id', 'target', 'is_completed', 'target', 'progress_letter', 'target', 'attendance', 'target',
      'class_participation', 'target', 'classroom_behavior', 'target', 'contact_notes', 'target',
      'class_notes', 'target', 'content', 'source', 'external_link', 'target'
    )
  );
  IF EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = report_id) THEN
    RAISE EXCEPTION 'merge fixture did not archive the source report';
  END IF;
  result := public.cancel_single_lesson_transfer((result->>'transfer_id')::uuid);
  IF (SELECT content FROM public.occurrence_reports WHERE id = report_id AND class_occurrence_id = occ_a) IS DISTINCT FROM 'original report' THEN
    RAISE EXCEPTION 'merged cancel did not restore the archived source report';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = standalone_id AND class_occurrence_id = occ_b) THEN
    RAISE EXCEPTION 'merged cancel moved or removed the target report';
  END IF;
  IF (result->>'target_report_retained')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'merged cancel did not report the retained target report: %', result;
  END IF;
END;
$$;

ROLLBACK;
