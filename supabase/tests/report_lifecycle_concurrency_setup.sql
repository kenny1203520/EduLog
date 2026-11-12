\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users(id, email) VALUES
  ('a1100000-0000-4000-8000-000000000001', 'report-race-owner@example.test')
ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET account_status = 'active'
WHERE auth_user_id = 'a1100000-0000-4000-8000-000000000001';

INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, effective_to, status)
SELECT 'a1100000-0000-4000-8000-000000000001', id, 'system', NULL, DATE '2020-01-01', NULL, 'active'
FROM public.roles WHERE code = 'teaching_owner' AND domain = 'teaching'
ON CONFLICT DO NOTHING;

INSERT INTO public.classrooms(id, name, user_id, teaching_id)
VALUES ('a1300000-0000-4000-8000-000000000001', 'Report Race Classroom', 'a1100000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001');
INSERT INTO public.courses(id, subject, stage, user_id, teaching_id) VALUES
  ('a1400000-0000-4000-8000-000000000001', 'Report Race Anchor', 'primary', 'a1100000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001'),
  ('a1400000-0000-4000-8000-000000000002', 'Report Race Linked One', 'primary', 'a1100000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001'),
  ('a1400000-0000-4000-8000-000000000003', 'Report Race Linked Two', 'primary', 'a1100000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001');
INSERT INTO public.lessons(id, course_id, title, sequence, user_id) VALUES
  ('a1500000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000001', 'Anchor Lesson', 1, 'a1100000-0000-4000-8000-000000000001'),
  ('a1500000-0000-4000-8000-000000000002', 'a1400000-0000-4000-8000-000000000002', 'Linked Lesson One', 1, 'a1100000-0000-4000-8000-000000000001'),
  ('a1500000-0000-4000-8000-000000000003', 'a1400000-0000-4000-8000-000000000003', 'Linked Lesson Two', 1, 'a1100000-0000-4000-8000-000000000001');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id, start_date, end_date, teaching_id) VALUES
  ('a1600000-0000-4000-8000-000000000001', 'Report Race Anchor Session', 'a1300000-0000-4000-8000-000000000001', ARRAY['a1400000-0000-4000-8000-000000000001']::uuid[], '09:00', '10:00', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', DATE '2026-12-31', 'a1200000-0000-4000-8000-000000000001'),
  ('a1600000-0000-4000-8000-000000000002', 'Report Race Linked Session One', 'a1300000-0000-4000-8000-000000000001', ARRAY['a1400000-0000-4000-8000-000000000002']::uuid[], '11:00', '12:00', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', DATE '2026-12-31', 'a1200000-0000-4000-8000-000000000001'),
  ('a1600000-0000-4000-8000-000000000003', 'Report Race Linked Session Two', 'a1300000-0000-4000-8000-000000000001', ARRAY['a1400000-0000-4000-8000-000000000003']::uuid[], '13:00', '14:00', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', DATE '2026-12-31', 'a1200000-0000-4000-8000-000000000001');

INSERT INTO public.teacher_records(id, profile_id)
SELECT 'a1c00000-0000-4000-8000-000000000001', profile.id
FROM public.profiles profile
WHERE profile.auth_user_id = 'a1100000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', false);
INSERT INTO public.class_session_teachers(class_session_id, teacher_id, role_id, effective_from, effective_to)
SELECT 'a1600000-0000-4000-8000-000000000001', 'a1c00000-0000-4000-8000-000000000001', role.id, DATE '2020-01-01', NULL
FROM public.roles role
WHERE role.code = 'teacher' AND role.domain = 'teaching' AND role.is_builtin
ON CONFLICT (class_session_id, teacher_id, effective_from) DO NOTHING;
SELECT set_config('request.jwt.claim.sub', '', false);

INSERT INTO public.students(id, name, user_id) VALUES
  ('a1700000-0000-4000-8000-000000000001', 'Report Race Student', 'a1100000-0000-4000-8000-000000000001'),
  ('a1700000-0000-4000-8000-000000000002', 'Changed Report Race Student', 'a1100000-0000-4000-8000-000000000001');
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id, status, user_id, start_date, lesson_number) VALUES
  ('a1800000-0000-4000-8000-000000000001', 'a1700000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000001', 'a1300000-0000-4000-8000-000000000001', 'a1600000-0000-4000-8000-000000000001', 'regular', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', 1),
  ('a1800000-0000-4000-8000-000000000002', 'a1700000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000002', 'a1300000-0000-4000-8000-000000000001', 'a1600000-0000-4000-8000-000000000002', 'regular', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', 1),
  ('a1800000-0000-4000-8000-000000000003', 'a1700000-0000-4000-8000-000000000001', 'a1400000-0000-4000-8000-000000000003', 'a1300000-0000-4000-8000-000000000001', 'a1600000-0000-4000-8000-000000000003', 'regular', 'a1100000-0000-4000-8000-000000000001', DATE '2026-01-01', 1);
INSERT INTO public.class_occurrences(id, class_session_id, occurrence_date, status, is_conducted) VALUES
  ('a1a00000-0000-4000-8000-000000000001', 'a1600000-0000-4000-8000-000000000001', DATE '2026-04-06', 'completed', true),
  ('a1a00000-0000-4000-8000-000000000002', 'a1600000-0000-4000-8000-000000000001', DATE '2026-04-13', 'completed', true);
INSERT INTO public.occurrence_reports(id, enrollment_id, class_occurrence_id, lesson_id, content, version, is_completed, attendance_status) VALUES
  ('a1b00000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000001', 'a1500000-0000-4000-8000-000000000001', 'race-one-before', 1, false, 'present'),
  ('a1b00000-0000-4000-8000-000000000002', 'a1800000-0000-4000-8000-000000000001', 'a1a00000-0000-4000-8000-000000000002', 'a1500000-0000-4000-8000-000000000001', 'race-two-before', 1, false, 'present');

CREATE OR REPLACE FUNCTION public.test_pause_report_lifecycle_save()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.content IN ('race-one-save', 'race-two-save') THEN
    PERFORM pg_sleep(5);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_test_pause_report_lifecycle_save
AFTER UPDATE ON public.occurrence_reports
FOR EACH ROW EXECUTE FUNCTION public.test_pause_report_lifecycle_save();

CREATE OR REPLACE FUNCTION public.test_pause_enrollment_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.id = 'a1800000-0000-4000-8000-000000000003'
     AND NEW.student_id = 'a1700000-0000-4000-8000-000000000002' THEN
    PERFORM pg_sleep(5);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER zz_test_pause_enrollment_identity_change
BEFORE UPDATE OF student_id ON public.enrollments
FOR EACH ROW EXECUTE FUNCTION public.test_pause_enrollment_identity_change();

COMMIT;
