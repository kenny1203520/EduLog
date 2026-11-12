\set ON_ERROR_STOP on

-- Rollback-only coverage for 1000170. It exercises scoped source/target grants,
-- roster validation, atomic placeholder replacement, report history, and
-- ordinary occurrence rescheduling.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO auth.users(id, email) VALUES
  ('91000000-0000-4000-8000-000000000100', 'correction-owner@example.test'),
  ('91000000-0000-4000-8000-000000000101', 'correction-teacher@example.test'),
  ('91000000-0000-4000-8000-000000000102', 'correction-source-only@example.test'),
  ('91000000-0000-4000-8000-000000000103', 'correction-outsider@example.test');
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to, status)
SELECT '91000000-0000-4000-8000-000000000100', role.id, 'system', NULL, DATE '2020-01-01', NULL, 'active'
FROM public.roles AS role WHERE role.code = 'teaching_owner' AND role.domain = 'teaching';

INSERT INTO public.classrooms(id, name, user_id, teaching_id) VALUES
  ('93000000-0000-4000-8000-000000000101', 'Correction Classroom A', '91000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000101'),
  ('93000000-0000-4000-8000-000000000102', 'Correction Classroom B', '91000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000101');
INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES
  ('94000000-0000-4000-8000-000000000101', 'Correction Course A', 'primary', '91000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000101'),
  ('94000000-0000-4000-8000-000000000102', 'Correction Course B', 'primary', '91000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000101'),
  ('94000000-0000-4000-8000-000000000103', 'Correction Course C', 'primary', '91000000-0000-4000-8000-000000000101', '92000000-0000-4000-8000-000000000101');
INSERT INTO public.lessons(id, course_id, title, sequence, user_id) VALUES
  ('95000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000101', 'A Lesson 1', 1, '91000000-0000-4000-8000-000000000101'),
  ('95000000-0000-4000-8000-000000000102', '94000000-0000-4000-8000-000000000101', 'A Lesson 2', 2, '91000000-0000-4000-8000-000000000101'),
  ('97000000-0000-4000-8000-000000000103', '94000000-0000-4000-8000-000000000102', 'B Lesson 1', 1, '91000000-0000-4000-8000-000000000101');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, start_date, end_date, teaching_id) VALUES
  ('96000000-0000-4000-8000-000000000101', 'Correction Session A', '93000000-0000-4000-8000-000000000101', ARRAY['94000000-0000-4000-8000-000000000101']::uuid[], '09:00', '10:00', '91000000-0000-4000-8000-000000000101', DATE '2026-01-01', DATE '2026-12-31', '92000000-0000-4000-8000-000000000101'),
  ('96000000-0000-4000-8000-000000000102', 'Correction Session B', '93000000-0000-4000-8000-000000000102', ARRAY['94000000-0000-4000-8000-000000000102','94000000-0000-4000-8000-000000000103']::uuid[], '11:00', '12:00', '91000000-0000-4000-8000-000000000101', DATE '2026-01-01', DATE '2026-12-31', '92000000-0000-4000-8000-000000000101');
INSERT INTO public.teacher_records(id, profile_id)
SELECT fixture.teacher_id, profile.id
FROM (VALUES
  ('9c000000-0000-4000-8000-000000000101'::uuid, '91000000-0000-4000-8000-000000000101'::uuid),
  ('9c000000-0000-4000-8000-000000000102'::uuid, '91000000-0000-4000-8000-000000000102'::uuid)
) AS fixture(teacher_id, user_id)
JOIN public.profiles AS profile ON profile.auth_user_id = fixture.user_id;
SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000100', true);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT session_id, '9c000000-0000-4000-8000-000000000101', role.id, DATE '2020-01-01', NULL
FROM (VALUES
  ('96000000-0000-4000-8000-000000000101'::uuid),
  ('96000000-0000-4000-8000-000000000102'::uuid)
) AS fixture(session_id)
CROSS JOIN public.roles AS role
WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
SELECT set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000102', true);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT '96000000-0000-4000-8000-000000000101', '9c000000-0000-4000-8000-000000000102', role.id, DATE '2020-01-01', NULL
FROM public.roles AS role WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin;
SELECT set_config('request.jwt.claim.sub', '', true);

INSERT INTO public.students(id, name, user_id)
VALUES ('98000000-0000-4000-8000-000000000101', 'Correction Student', '91000000-0000-4000-8000-000000000101');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, user_id, start_date, lesson_number) VALUES
  ('99000000-0000-4000-8000-000000000101', '98000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000101', '93000000-0000-4000-8000-000000000101', '96000000-0000-4000-8000-000000000101', 'regular', '91000000-0000-4000-8000-000000000101', DATE '2026-01-01', 1),
  ('99000000-0000-4000-8000-000000000102', '98000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000102', '93000000-0000-4000-8000-000000000102', '96000000-0000-4000-8000-000000000102', 'regular', '91000000-0000-4000-8000-000000000101', DATE '2026-01-01', 1),
  ('99000000-0000-4000-8000-000000000301', '98000000-0000-4000-8000-000000000101', '94000000-0000-4000-8000-000000000103', '93000000-0000-4000-8000-000000000102', '96000000-0000-4000-8000-000000000102', 'regular', '91000000-0000-4000-8000-000000000101', DATE '2026-01-01', 1);

INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted)
SELECT fixture.id, fixture.session_id, fixture.occurrence_date, 'completed', true
FROM (VALUES
  ('9a000000-0000-4000-8000-000000000101'::uuid, '96000000-0000-4000-8000-000000000101'::uuid, DATE '2026-01-05'),
  ('9a000000-0000-4000-8000-000000000102'::uuid, '96000000-0000-4000-8000-000000000101'::uuid, DATE '2026-01-12'),
  ('9a000000-0000-4000-8000-000000000103'::uuid, '96000000-0000-4000-8000-000000000101'::uuid, DATE '2026-01-19'),
  ('9a000000-0000-4000-8000-000000000104'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-20'),
  ('9a000000-0000-4000-8000-000000000105'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-21'),
  ('9a000000-0000-4000-8000-000000000106'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-22'),
  ('9a000000-0000-4000-8000-000000000107'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-23'),
  ('9a000000-0000-4000-8000-000000000108'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-24'),
  ('9a000000-0000-4000-8000-000000000109'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-25'),
  ('9a000000-0000-4000-8000-000000000110'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-26'),
  ('9a000000-0000-4000-8000-000000000111'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-27'),
  ('9a000000-0000-4000-8000-000000000112'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-28'),
  ('9a000000-0000-4000-8000-000000000113'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-29'),
  ('9a000000-0000-4000-8000-000000000114'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-30'),
  ('9a000000-0000-4000-8000-000000000115'::uuid, '96000000-0000-4000-8000-000000000101'::uuid, DATE '2026-02-01'),
  ('9a000000-0000-4000-8000-000000000116'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-01-31'),
  ('9a000000-0000-4000-8000-000000000117'::uuid, '96000000-0000-4000-8000-000000000102'::uuid, DATE '2026-02-01')
) AS fixture(id, session_id, occurrence_date);

INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version, lesson_id, is_completed, progress_letter, lesson_entries, primary_lesson_entry_id, attendance_status, class_participation, contact_notes, class_notes) VALUES
  ('9b000000-0000-4000-8000-000000000101', '99000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000101', 'same-class taught report', 1, '95000000-0000-4000-8000-000000000102', false, 'B', '[{"id":"9d000000-0000-4000-8000-000000000101","enrollment_id":"99000000-0000-4000-8000-000000000101","course_id":"94000000-0000-4000-8000-000000000101","lesson_id":"95000000-0000-4000-8000-000000000102","is_completed":false,"progress_letter":"B"}]', '9d000000-0000-4000-8000-000000000101', 'present', 4, 'Parent note', 'Internal note'),
  ('9b000000-0000-4000-8000-000000000102', '99000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000103', 'cross-class source report', 1, '95000000-0000-4000-8000-000000000101', true, 'A', '[{"id":"9d000000-0000-4000-8000-000000000102","enrollment_id":"99000000-0000-4000-8000-000000000101","course_id":"94000000-0000-4000-8000-000000000101","lesson_id":"95000000-0000-4000-8000-000000000101","is_completed":true,"progress_letter":"A"},{"id":"9d000000-0000-4000-8000-000000000103","enrollment_id":"99000000-0000-4000-8000-000000000102","course_id":"94000000-0000-4000-8000-000000000102","lesson_id":"95000000-0000-4000-8000-000000000103","is_completed":false,"progress_letter":null}]', '9d000000-0000-4000-8000-000000000102', 'present', 5, 'Cross parent note', 'Cross internal note');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, attendance_status) VALUES
  ('9b000000-0000-4000-8000-000000000103', '99000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000102', '', 'pending'),
  ('9b000000-0000-4000-8000-000000000104', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000104', '', 'pending'),
  ('9b000000-0000-4000-8000-000000000115', '99000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000115', 'ordinary date-change history', 'present');

-- Each row below represents one reason a target is not a pristine system
-- placeholder: official content/version, lesson progress, score, attendance,
-- comments/documents, external link, prior snapshot, collaboration, or sync.
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, content, version, last_edited_by) VALUES
  ('9b000000-0000-4000-8000-000000000105', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000105', 'official report', 2, '91000000-0000-4000-8000-000000000101');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, lesson_id, is_completed, progress_letter, lesson_entries, primary_lesson_entry_id) VALUES
  ('9b000000-0000-4000-8000-000000000106', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000106', '95000000-0000-4000-8000-000000000103', true, 'A', '[{"id":"9d000000-0000-4000-8000-000000000106","enrollment_id":"99000000-0000-4000-8000-000000000102","course_id":"94000000-0000-4000-8000-000000000102","lesson_id":"95000000-0000-4000-8000-000000000103","is_completed":true,"progress_letter":"A"}]', '9d000000-0000-4000-8000-000000000106');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, class_participation) VALUES
  ('9b000000-0000-4000-8000-000000000107', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000107', 4);
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, attendance_status, absence_reason) VALUES
  ('9b000000-0000-4000-8000-000000000108', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000108', 'absent', 'teacher_note');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, contact_notes, class_notes, content_document, contact_notes_document, class_notes_document) VALUES
  ('9b000000-0000-4000-8000-000000000109', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000109', 'contact comment', 'internal comment', '{"type":"doc"}', '{"type":"doc"}', '{"type":"doc"}');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, external_link) VALUES
  ('9b000000-0000-4000-8000-000000000110', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000110', 'https://example.test/report');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id) VALUES
  ('9b000000-0000-4000-8000-000000000111', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000111'),
  ('9b000000-0000-4000-8000-000000000112', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000112');
INSERT INTO public.report_versions(occurrence_report_id, version, content, edited_by)
VALUES ('9b000000-0000-4000-8000-000000000111', 1, 'prior snapshot', '91000000-0000-4000-8000-000000000101');
INSERT INTO public.report_collab_docs(occurrence_report_id, snapshot_base64, last_updated_by)
VALUES ('9b000000-0000-4000-8000-000000000112', 'c25hcHNob3Q=', '91000000-0000-4000-8000-000000000101');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, source_origin, source_admission_id, source_report_id, source_synced_at, source_synced_version, source_synced_fields) VALUES
  ('9b000000-0000-4000-8000-000000000113', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000113', 'https://corp.orangeapple.co', '78113', '99113', now(), 1, '{"content":"source"}');
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, version)
VALUES ('9b000000-0000-4000-8000-000000000116', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000116', 2);
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, last_edited_at)
VALUES ('9b000000-0000-4000-8000-000000000117', '99000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000117', now() + interval '1 second');

-- Ordinary rescheduling updates the occurrence in place; its report stays on
-- that occurrence, preserving the taught lesson's identity.
UPDATE public.class_occurrences SET occurrence_date = DATE '2026-02-02'
WHERE id = '9a000000-0000-4000-8000-000000000115';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_reports, public.enrollments, public.class_occurrences TO authenticated;
GRANT SELECT ON public.report_versions, public.report_collab_docs TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_target uuid;
  v_id uuid;
  v_progress_count integer;
BEGIN
  -- An unrelated account cannot use the source report as an existence oracle.
  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000103', true);
  BEGIN
    PERFORM public.correct_occurrence_report('9b000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000102', 1, NULL);
    RAISE EXCEPTION 'source permission failure was expected';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A source-only class teacher is authorized on the report but not its target.
  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000102', true);
  BEGIN
    PERFORM public.correct_occurrence_report('9b000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000104', 1, '99000000-0000-4000-8000-000000000102');
    RAISE EXCEPTION 'target permission failure was expected';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000101', true);
  BEGIN
    PERFORM public.correct_occurrence_report('9b000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000104', 1, '99000000-0000-4000-8000-000000000101');
    RAISE EXCEPTION 'target roster mismatch was expected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REPORT_TARGET_NOT_ON_ROSTER' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.correct_occurrence_report('9b000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000104', 1, NULL);
    RAISE EXCEPTION 'ambiguous target enrollment was expected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'REPORT_TARGET_ENROLLMENT_REQUIRED' THEN RAISE; END IF;
  END;
  FOREACH v_target IN ARRAY ARRAY[
    '9a000000-0000-4000-8000-000000000105'::uuid,
    '9a000000-0000-4000-8000-000000000106'::uuid,
    '9a000000-0000-4000-8000-000000000107'::uuid,
    '9a000000-0000-4000-8000-000000000108'::uuid,
    '9a000000-0000-4000-8000-000000000109'::uuid,
    '9a000000-0000-4000-8000-000000000110'::uuid,
    '9a000000-0000-4000-8000-000000000111'::uuid,
    '9a000000-0000-4000-8000-000000000112'::uuid,
    '9a000000-0000-4000-8000-000000000113'::uuid,
    '9a000000-0000-4000-8000-000000000116'::uuid,
    '9a000000-0000-4000-8000-000000000117'::uuid
  ] LOOP
    BEGIN
      PERFORM public.correct_occurrence_report('9b000000-0000-4000-8000-000000000102', v_target, 1, '99000000-0000-4000-8000-000000000102');
      RAISE EXCEPTION 'target % should have been rejected', v_target;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM NOT LIKE 'REPORT_CORRECTION_TARGET_CONFLICT%' THEN RAISE; END IF;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000102' AND class_occurrence_id = '9a000000-0000-4000-8000-000000000103')
       OR NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE enrollment_id = '99000000-0000-4000-8000-000000000102' AND class_occurrence_id = v_target) THEN
      RAISE EXCEPTION 'failed correction did not preserve both reports for target %', v_target;
    END IF;
  END LOOP;

  -- A same-class date correction keeps the report ID, attendance, notes, and
  -- progress while removing only the target's pristine pending placeholder.
  PERFORM public.correct_occurrence_report(
    '9b000000-0000-4000-8000-000000000101', '9a000000-0000-4000-8000-000000000102', 1, NULL
  );
  IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000101' AND enrollment_id = '99000000-0000-4000-8000-000000000101' AND class_occurrence_id = '9a000000-0000-4000-8000-000000000102' AND version = 2 AND attendance_status = 'present' AND contact_notes = 'Parent note' AND class_notes = 'Internal note' AND class_participation = 4)
     OR EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000103')
     OR NOT EXISTS (SELECT 1 FROM public.report_versions WHERE occurrence_report_id = '9b000000-0000-4000-8000-000000000101' AND version = 1 AND snapshot->>'class_occurrence_id' = '9a000000-0000-4000-8000-000000000101') THEN
    RAISE EXCEPTION 'same-class correction lost report identity, shared fields, placeholder safety, or snapshot history';
  END IF;

  -- Cross-class correction selects the matching target enrollment, keeps the
  -- source binding so extension preview notices version drift, and exposes the
  -- same report in both enrollment histories through the lesson entries.
  PERFORM public.correct_occurrence_report(
    '9b000000-0000-4000-8000-000000000102', '9a000000-0000-4000-8000-000000000104', 1, '99000000-0000-4000-8000-000000000102'
  );
  IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000102' AND enrollment_id = '99000000-0000-4000-8000-000000000102' AND class_occurrence_id = '9a000000-0000-4000-8000-000000000104' AND version = 2 AND source_synced_version = 1 AND source_report_id = '99113' AND content = 'cross-class source report' AND contact_notes = 'Cross parent note' AND class_notes = 'Cross internal note')
     OR EXISTS (SELECT 1 FROM public.occurrence_reports WHERE id = '9b000000-0000-4000-8000-000000000104') THEN
    RAISE EXCEPTION 'cross-class correction did not retain source identity or shared report data';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports report WHERE report.id = '9b000000-0000-4000-8000-000000000102' AND report.lesson_entries @> '[{"enrollment_id":"99000000-0000-4000-8000-000000000101"}]'::jsonb)
     OR NOT EXISTS (SELECT 1 FROM public.occurrence_reports report WHERE report.id = '9b000000-0000-4000-8000-000000000102' AND report.lesson_entries @> '[{"enrollment_id":"99000000-0000-4000-8000-000000000102"}]'::jsonb) THEN
    RAISE EXCEPTION 'cross-class report is not discoverable from both lesson histories';
  END IF;
  SELECT count(*) INTO v_progress_count
  FROM public.occurrence_reports AS report
  CROSS JOIN LATERAL jsonb_array_elements(report.lesson_entries) AS entry(value)
  WHERE entry.value->>'enrollment_id' = '99000000-0000-4000-8000-000000000101'
    AND entry.value->>'lesson_id' = '95000000-0000-4000-8000-000000000101'
    AND entry.value->>'is_completed' = 'true';
  IF v_progress_count <> 1
     OR (SELECT lesson_number FROM public.enrollments WHERE id = '99000000-0000-4000-8000-000000000101') <> 2
     OR (SELECT lesson_number FROM public.enrollments WHERE id = '99000000-0000-4000-8000-000000000102') <> 1 THEN
    RAISE EXCEPTION 'cross-class lesson progress was duplicated or recalculated incorrectly: count %, lessons % / %', v_progress_count,
      (SELECT lesson_number FROM public.enrollments WHERE id = '99000000-0000-4000-8000-000000000101'),
      (SELECT lesson_number FROM public.enrollments WHERE id = '99000000-0000-4000-8000-000000000102');
  END IF;

  -- The ordinary reschedule above leaves the already-taught report attached
  -- to the same occurrence ID.
  IF NOT EXISTS (SELECT 1 FROM public.occurrence_reports report JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id WHERE report.id = '9b000000-0000-4000-8000-000000000115' AND report.class_occurrence_id = '9a000000-0000-4000-8000-000000000115' AND occurrence.occurrence_date = DATE '2026-02-02' AND report.content = 'ordinary date-change history') THEN
    RAISE EXCEPTION 'ordinary rescheduling detached taught report history';
  END IF;
END;
$$;

ROLLBACK;
