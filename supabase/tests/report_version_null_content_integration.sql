\set ON_ERROR_STOP on

-- Regression for 1000150: a report whose learning report was cleared (stored
-- as NULL) can be edited again. Transactional, so it can run repeatedly.
BEGIN;

INSERT INTO auth.users(id, email) VALUES ('a1500000-0000-4000-8000-000000000001', 'null-content@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.classrooms(id, name, user_id, teaching_id)
SELECT 'a1500000-0000-4000-8000-000000000011', 'Null Content Classroom', 'a1500000-0000-4000-8000-000000000001', NULL;
INSERT INTO public.courses(id, subject, stage, user_id, teaching_id)
SELECT 'a1500000-0000-4000-8000-000000000021', 'Null Content Course', 'primary', 'a1500000-0000-4000-8000-000000000001', NULL;
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, start_date, teaching_id)
SELECT 'a1500000-0000-4000-8000-000000000031', 'Null Content Session', 'a1500000-0000-4000-8000-000000000011',
  ARRAY['a1500000-0000-4000-8000-000000000021']::uuid[], '09:00', '10:00', 'a1500000-0000-4000-8000-000000000001', DATE '2026-01-01', NULL;
INSERT INTO public.students(id, name, user_id) VALUES ('a1500000-0000-4000-8000-000000000041', 'Null Content Student', 'a1500000-0000-4000-8000-000000000001');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, user_id, start_date)
VALUES ('a1500000-0000-4000-8000-000000000051', 'a1500000-0000-4000-8000-000000000041', 'a1500000-0000-4000-8000-000000000021',
  'a1500000-0000-4000-8000-000000000011', 'a1500000-0000-4000-8000-000000000031', 'regular', 'a1500000-0000-4000-8000-000000000001', DATE '2026-01-01');
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status)
VALUES ('a1500000-0000-4000-8000-000000000061', 'a1500000-0000-4000-8000-000000000031', DATE '2026-01-05', 'scheduled');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version)
VALUES ('a1500000-0000-4000-8000-000000000071', 'a1500000-0000-4000-8000-000000000051', 'a1500000-0000-4000-8000-000000000061', 'first draft', 1);

-- Clearing the body stores NULL (as the lifecycle RPC does)...
UPDATE public.occurrence_reports SET content = NULL, version = 2 WHERE id = 'a1500000-0000-4000-8000-000000000071';
-- ...and the next edit snapshots that NULL version instead of failing.
UPDATE public.occurrence_reports SET content = 'written again', version = 3 WHERE id = 'a1500000-0000-4000-8000-000000000071';

DO $$
BEGIN
  IF (SELECT content FROM public.occurrence_reports WHERE id = 'a1500000-0000-4000-8000-000000000071') IS DISTINCT FROM 'written again' THEN
    RAISE EXCEPTION 'report was not updated after its content was cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.report_versions
    WHERE occurrence_report_id = 'a1500000-0000-4000-8000-000000000071' AND version = 2 AND content = ''
      AND snapshot->>'content' IS NULL
  ) THEN
    RAISE EXCEPTION 'cleared version was not snapshotted as an empty string';
  END IF;
END;
$$;

ROLLBACK;
