-- Rollback-only fixture for 1000155: class transfer log, retroactive
-- transfers, report count, closures and the timeline read models.
BEGIN;

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_teaching_id uuid;
  owner_id uuid := '7f000000-0000-4000-8000-000000000007';
  v_classroom_id uuid := '7f000000-0000-4000-8000-000000000001';
  v_course_id uuid := '7f000000-0000-4000-8000-000000000002';
  v_student_id uuid := '7f000000-0000-4000-8000-000000000003';
  v_enrollment_id uuid := '7f000000-0000-4000-8000-000000000004';
  session_a uuid := '7f000000-0000-4000-8000-0000000000a1';
  session_b uuid := '7f000000-0000-4000-8000-0000000000b1';
  session_c uuid := '7f000000-0000-4000-8000-0000000000c1';
  v_session uuid;
  week integer;
  result jsonb;
  timeline jsonb;
  flags jsonb;
  dates date[];
  v_report public.occurrence_reports%ROWTYPE;
BEGIN
  SELECT id INTO v_teaching_id FROM public.teachings WHERE is_global LIMIT 1;
  INSERT INTO auth.users(id, email) VALUES (owner_id, 'transfer-log-owner@example.test');
  INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES (v_classroom_id, 'Log classroom', owner_id, v_teaching_id);
  INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES (v_course_id, 'Log course', 'primary', owner_id, v_teaching_id);
  INSERT INTO public.students(id, name, user_id) VALUES (v_student_id, 'Log Student', NULL);
  INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, user_id, teaching_id, start_time, end_time)
  VALUES (session_a, 'Class A', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '10:00', '12:00'),
         (session_b, 'Class B', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '13:00', '15:00'),
         (session_c, 'Class C', v_classroom_id, ARRAY[v_course_id], owner_id, v_teaching_id, '16:00', '18:00');
  -- Thirteen Saturdays from 2027-01-02 in every class.
  FOREACH v_session IN ARRAY ARRAY[session_a, session_b, session_c] LOOP
    FOR week IN 0..12 LOOP
      INSERT INTO public.class_occurrences(class_session_id, occurrence_date, status, is_conducted)
      VALUES (v_session, DATE '2027-01-02' + week * 7, 'scheduled', true);
    END LOOP;
  END LOOP;

  INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, user_id, status, start_date)
  VALUES (v_enrollment_id, v_student_id, v_course_id, v_classroom_id, session_a, owner_id, 'regular', DATE '2027-01-02');
  PERFORM public.sync_enrollment_reports(v_enrollment_id, 8);

  -- Plain text on 01-30, rich text only on 02-13.
  UPDATE public.occurrence_reports AS report SET content = 'written'
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = report.class_occurrence_id AND report.enrollment_id = v_enrollment_id AND occurrence.occurrence_date = DATE '2027-01-30';
  UPDATE public.occurrence_reports AS report
  SET content_document = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"rich only"}]}]}'::jsonb
  FROM public.class_occurrences AS occurrence
  WHERE occurrence.id = report.class_occurrence_id AND report.enrollment_id = v_enrollment_id AND occurrence.occurrence_date = DATE '2027-02-13';

  -- Blank checks.
  SELECT * INTO v_report FROM public.occurrence_reports AS report
  JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
  WHERE report.enrollment_id = v_enrollment_id AND occurrence.occurrence_date = DATE '2027-02-13';
  IF private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'rich-text-only report counted as blank'; END IF;
  v_report.content_document := '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"   "}]}]}'::jsonb;
  IF NOT private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'whitespace-only document counted as content'; END IF;
  v_report.content_document := '{"type":"doc","content":[{"type":"image","attrs":{"src":"x"}}]}'::jsonb;
  IF private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'image document counted as blank'; END IF;
  v_report.content_document := NULL; v_report.class_participation := 3;
  IF private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'participation score counted as blank'; END IF;
  v_report.class_participation := NULL; v_report.attendance_status := 'absent'; v_report.absence_reason := 'holiday'; v_report.version := 2;
  IF NOT private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'holiday-marked report counted as content'; END IF;
  v_report.absence_reason := 'sick';
  IF private.is_blank_occurrence_report(v_report) THEN RAISE EXCEPTION 'absence with a reason counted as blank'; END IF;

  -- A -> B from 02-06: the rich-text report stays in A; blanks move to B.
  result := public.transfer_enrollment_class(v_enrollment_id, session_b, DATE '2027-02-06', 'Schedule change');
  IF (result->>'moved_reports')::integer <> 2 OR jsonb_array_length(result->'retained_reports') <> 1 THEN
    RAISE EXCEPTION 'first transfer summary: %', result;
  END IF;

  -- C is closed on 02-06; C's 02-27 is the source of a single-lesson transfer.
  INSERT INTO public.holidays(name, kind, start_date, end_date, class_session_ids)
  VALUES ('C closed', 'closure', DATE '2027-02-06', DATE '2027-02-06', ARRAY[session_c]);
  INSERT INTO public.single_lesson_transfers(enrollment_id, source_occurrence_id, target_occurrence_id, created_by)
  SELECT v_enrollment_id, source.id, target.id, owner_id
  FROM public.class_occurrences AS source, public.class_occurrences AS target
  WHERE source.class_session_id = session_c AND source.occurrence_date = DATE '2027-02-27'
    AND target.class_session_id = session_a AND target.occurrence_date = DATE '2027-03-06';

  -- Retroactive: C from 01-23 replaces the A/B history after that date.
  result := public.transfer_enrollment_class(v_enrollment_id, session_c, DATE '2027-01-23', NULL);

  IF (SELECT count(*) FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_a AND effective_from = DATE '2027-01-02' AND effective_to = DATE '2027-01-22')
     OR NOT EXISTS (SELECT 1 FROM public.enrollment_class_history WHERE enrollment_id = v_enrollment_id AND class_session_id = session_c AND effective_from = DATE '2027-01-23' AND effective_to IS NULL) THEN
    RAISE EXCEPTION 'retroactive transfer left overlapping history: %',
      (SELECT jsonb_agg(to_jsonb(history) ORDER BY effective_from) FROM public.enrollment_class_history AS history WHERE enrollment_id = v_enrollment_id);
  END IF;

  SELECT array_agg(occurrence.occurrence_date ORDER BY occurrence.occurrence_date) INTO dates
  FROM public.occurrence_reports AS report JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
  WHERE report.enrollment_id = v_enrollment_id;
  IF dates <> ARRAY[DATE '2027-01-02', DATE '2027-01-09', DATE '2027-01-16', DATE '2027-01-23', DATE '2027-01-30',
                    DATE '2027-02-13', DATE '2027-02-20', DATE '2027-03-06'] THEN
    RAISE EXCEPTION 'retroactive transfer placed reports on % (%)', dates, result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.occurrence_reports AS report JOIN public.class_occurrences AS occurrence ON occurrence.id = report.class_occurrence_id
    WHERE report.enrollment_id = v_enrollment_id AND occurrence.occurrence_date = DATE '2027-03-06' AND occurrence.class_session_id <> session_c
  ) THEN
    RAISE EXCEPTION 'placeholder landed outside the new class';
  END IF;

  -- Audit trail.
  IF (SELECT count(*) FROM public.enrollment_class_transfers WHERE enrollment_id = v_enrollment_id AND source = 'transfer') <> 2 THEN
    RAISE EXCEPTION 'transfers were not logged';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollment_class_transfers
    WHERE enrollment_id = v_enrollment_id AND to_class_session_id = session_b
      AND from_class_session_id = session_a AND note = 'Schedule change' AND effective_date = DATE '2027-02-06'
  ) THEN
    RAISE EXCEPTION 'first transfer details missing';
  END IF;
  SELECT to_jsonb(transfer) INTO result FROM public.enrollment_class_transfers AS transfer
  WHERE enrollment_id = v_enrollment_id AND to_class_session_id = session_c;
  IF jsonb_array_length(result->'replaced_segments') <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(result->'report_changes') AS change WHERE change->>'action' = 'moved') <> 3
     OR (SELECT count(*) FROM jsonb_array_elements(result->'report_changes') AS change WHERE change->>'action' = 'retained') <> 2 THEN
    RAISE EXCEPTION 'retroactive transfer log is incomplete: %', result;
  END IF;

  BEGIN
    UPDATE public.enrollment_class_transfers SET note = 'edited' WHERE enrollment_id = v_enrollment_id;
    RAISE EXCEPTION 'transfer log accepted an update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ENROLLMENT_CLASS_TRANSFER_APPEND_ONLY' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.enrollment_class_transfers WHERE enrollment_id = v_enrollment_id;
    RAISE EXCEPTION 'transfer log accepted a delete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ENROLLMENT_CLASS_TRANSFER_APPEND_ONLY' THEN RAISE; END IF;
  END;

  -- Timeline placements.
  timeline := public.get_enrollment_class_timeline(v_enrollment_id);
  IF jsonb_array_length(timeline->'segments') <> 2 OR jsonb_array_length(timeline->'transfers') <> 2 THEN
    RAISE EXCEPTION 'timeline segments/transfers: %', timeline;
  END IF;
  IF (SELECT report->>'placement' FROM jsonb_array_elements(timeline->'reports') AS report WHERE report->>'occurrence_date' = '2027-01-30') <> 'retained_after_transfer'
     OR (SELECT report->>'placement' FROM jsonb_array_elements(timeline->'reports') AS report WHERE report->>'occurrence_date' = '2027-01-02') <> 'regular'
     OR (SELECT report->>'placement' FROM jsonb_array_elements(timeline->'reports') AS report WHERE report->>'occurrence_date' = '2027-01-23') <> 'regular' THEN
    RAISE EXCEPTION 'timeline placements: %', timeline->'reports';
  END IF;

  flags := public.get_class_session_roster_flags(session_c, DATE '2027-01-01', DATE '2027-02-28');
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(flags) AS flag WHERE flag->>'flag' = 'transfer_in' AND flag->>'date' = '2027-01-23')
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(flags) AS flag WHERE flag->>'flag' = 'makeup_out' AND flag->>'date' = '2027-02-27') THEN
    RAISE EXCEPTION 'roster flags: %', flags;
  END IF;

  -- "Today" follows the class time zone.
  UPDATE public.class_sessions SET time_zone = 'Pacific/Kiritimati' WHERE id = session_c;
  IF private.local_today(session_c, v_enrollment_id) <> (now() AT TIME ZONE 'Pacific/Kiritimati')::date THEN
    RAISE EXCEPTION 'local_today ignored the class time zone';
  END IF;
END;
$$;

ROLLBACK;
