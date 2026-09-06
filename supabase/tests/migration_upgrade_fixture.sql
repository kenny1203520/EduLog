\set ON_ERROR_STOP on

-- Represents rows already present before the teaching-domain reconciliation.
INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-0000000000aa', 'legacy-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000bb', 'course-owner@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.classrooms(id, name, user_id) VALUES
  ('30000000-0000-0000-0000-0000000000aa', 'Legacy classroom', '00000000-0000-0000-0000-0000000000aa')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.courses(id, subject, stage, user_id) VALUES
  ('50000000-0000-0000-0000-0000000000bb', 'Course owned by B', 'primary', '00000000-0000-0000-0000-0000000000bb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, user_id) VALUES
  ('60000000-0000-0000-0000-0000000000aa', 'Classroom wins', '30000000-0000-0000-0000-0000000000aa', ARRAY['50000000-0000-0000-0000-0000000000bb']::uuid[], '09:00', '10:00', '00000000-0000-0000-0000-0000000000aa'),
  ('60000000-0000-0000-0000-0000000000ab', 'Course fallback', NULL, ARRAY['50000000-0000-0000-0000-0000000000bb']::uuid[], '10:00', '11:00', '00000000-0000-0000-0000-0000000000bb'),
  ('60000000-0000-0000-0000-0000000000ac', 'Quarantine fallback', NULL, ARRAY['70000000-0000-0000-0000-0000000000dd']::uuid[], '11:00', '12:00', '00000000-0000-0000-0000-0000000000aa')
ON CONFLICT (id) DO NOTHING;
