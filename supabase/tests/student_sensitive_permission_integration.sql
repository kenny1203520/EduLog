\set ON_ERROR_STOP on

-- All fixture data, role policies and Supabase-compatible table grants roll
-- back. Use the authenticated role throughout the assertions to exercise RLS.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_contacts, public.student_schools, public.student_credentials TO authenticated;

INSERT INTO auth.users(id, email)
SELECT ('b9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'student-sensitive-' || n || '@example.test'
FROM generate_series(1, 16) AS n;
-- Accounts start pending (1000163) and hold no permission until active (1000165).
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';
INSERT INTO public.roles(id, name, domain) VALUES
  ('b9100000-0000-4000-8000-000000000001', 'Sensitive fixture basic reader', 'teaching'),
  ('b9100000-0000-4000-8000-000000000002', 'Sensitive fixture private reader', 'teaching'),
  ('b9100000-0000-4000-8000-000000000003', 'Sensitive fixture private editor', 'teaching'),
  ('b9100000-0000-4000-8000-000000000004', 'Sensitive fixture deny', 'teaching'),
  ('b9100000-0000-4000-8000-000000000005', 'Sensitive fixture inherited reader', 'teaching'),
  ('b9100000-0000-4000-8000-000000000006', 'Sensitive fixture schools only', 'teaching'),
  ('b9100000-0000-4000-8000-000000000007', 'Sensitive fixture personal only', 'teaching'),
  ('b9100000-0000-4000-8000-000000000008', 'Sensitive fixture contacts only', 'teaching'),
  ('b9100000-0000-4000-8000-000000000009', 'Sensitive fixture credentials only', 'teaching');
INSERT INTO public.role_inheritance(role_id, parent_role_id) VALUES
  ('b9100000-0000-4000-8000-000000000005', 'b9100000-0000-4000-8000-000000000002');
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT fixture.role_id, permission.id, 'system', NULL, fixture.effect
FROM (VALUES
  ('b9100000-0000-4000-8000-000000000001'::uuid, 'teaching.students.read', 'allow'),
  ('b9100000-0000-4000-8000-000000000002'::uuid, 'teaching.student\_%.read', 'allow'),
  ('b9100000-0000-4000-8000-000000000003'::uuid, 'teaching.student\_%.update', 'allow'),
  ('b9100000-0000-4000-8000-000000000004'::uuid, 'teaching.student\_%', 'deny'),
  ('b9100000-0000-4000-8000-000000000006'::uuid, 'teaching.student\_schools.%', 'allow'),
  ('b9100000-0000-4000-8000-000000000007'::uuid, 'teaching.student\_personal.%', 'allow'),
  ('b9100000-0000-4000-8000-000000000008'::uuid, 'teaching.student\_contacts.%', 'allow'),
  ('b9100000-0000-4000-8000-000000000009'::uuid, 'teaching.student\_credentials.%', 'allow')
) fixture(role_id, permission_pattern, effect)
JOIN public.permissions permission ON permission.key LIKE fixture.permission_pattern;
-- The four sections replace the old pair; teacher sensitive keys are separate.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permissions
             WHERE key IN ('teaching.students.read_sensitive', 'teaching.students.update_sensitive')) THEN
    RAISE EXCEPTION 'old student sensitive permission keys still exist';
  END IF;
  IF (SELECT count(*) FROM public.role_permission_policies
      WHERE role_id = 'b9100000-0000-4000-8000-000000000004') <> 8 THEN
    RAISE EXCEPTION 'fixture deny role must deny all eight section permissions';
  END IF;
END;
$$;
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
SELECT id, 'b9100000-0000-4000-8000-000000000001', 'system', NULL
FROM auth.users WHERE email LIKE 'student-sensitive-%@example.test';

INSERT INTO public.classrooms(id, name) VALUES
  ('b9200000-0000-4000-8000-000000000001', 'Sensitive classroom A'),
  ('b9200000-0000-4000-8000-000000000002', 'Sensitive classroom B'),
  ('b9200000-0000-4000-8000-000000000003', 'Unrelated classroom');
INSERT INTO public.courses(id, subject, stage) VALUES ('b9300000-0000-4000-8000-000000000001', 'Sensitive course', 'primary');
INSERT INTO public.class_sessions(id, name, classroom_id, course_ids, start_time, end_time, start_date)
VALUES ('b9400000-0000-4000-8000-000000000001', 'Sensitive session A', 'b9200000-0000-4000-8000-000000000001',
        ARRAY['b9300000-0000-4000-8000-000000000001']::uuid[], '09:00', '10:00', DATE '2026-01-01'),
       ('b9400000-0000-4000-8000-000000000002', 'Sensitive session B', 'b9200000-0000-4000-8000-000000000002',
        ARRAY['b9300000-0000-4000-8000-000000000001']::uuid[], '11:00', '12:00', DATE '2026-01-01');

-- Users 1/7/9 have platform read+write; 2 is read-only, 3 write-only,
-- 4 ordinary-only, 5 classroom-only, 6 session-only, 8 legacy-owner-only,
-- 10 has one denied and one allowed classroom, 11 has an unrelated classroom.
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
SELECT ('b9000000-0000-4000-8000-' || lpad(fixture.n::text, 12, '0'))::uuid,
       ('b9100000-0000-4000-8000-' || lpad(role_n::text, 12, '0'))::uuid,
       fixture.scope_type, fixture.scope_id
FROM (VALUES
  (1, 'system', NULL::uuid), (7, 'system', NULL::uuid), (9, 'system', NULL::uuid),
  (5, 'classroom', 'b9200000-0000-4000-8000-000000000001'::uuid),
  (6, 'class_session', 'b9400000-0000-4000-8000-000000000001'::uuid),
  (10, 'classroom', 'b9200000-0000-4000-8000-000000000001'::uuid),
  (10, 'classroom', 'b9200000-0000-4000-8000-000000000002'::uuid),
  (11, 'classroom', 'b9200000-0000-4000-8000-000000000003'::uuid)
) fixture(n, scope_type, scope_id)
CROSS JOIN generate_series(2, 3) AS role_n;
INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id) VALUES
  ('b9000000-0000-4000-8000-000000000002', 'b9100000-0000-4000-8000-000000000002', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000003', 'b9100000-0000-4000-8000-000000000003', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000007', 'b9100000-0000-4000-8000-000000000004', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000009', 'b9100000-0000-4000-8000-000000000004', 'classroom', 'b9200000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-000000000010', 'b9100000-0000-4000-8000-000000000004', 'classroom', 'b9200000-0000-4000-8000-000000000001'),
  ('b9000000-0000-4000-8000-000000000012', 'b9100000-0000-4000-8000-000000000005', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000012', 'b9100000-0000-4000-8000-000000000003', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000013', 'b9100000-0000-4000-8000-000000000006', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000014', 'b9100000-0000-4000-8000-000000000007', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000015', 'b9100000-0000-4000-8000-000000000008', 'system', NULL),
  ('b9000000-0000-4000-8000-000000000016', 'b9100000-0000-4000-8000-000000000009', 'system', NULL);

INSERT INTO public.students(id, name, email) VALUES
  ('b9500000-0000-4000-8000-000000000001', 'Initially unenrolled', 'private@example.test');
-- Model a persisted legacy row without changing production ownership rules.
ALTER TABLE public.students DISABLE TRIGGER clear_legacy_owner_before_write;
UPDATE public.students SET user_id = 'b9000000-0000-4000-8000-000000000008'
WHERE id = 'b9500000-0000-4000-8000-000000000001';
ALTER TABLE public.students ENABLE TRIGGER clear_legacy_owner_before_write;
INSERT INTO public.student_contacts(student_id, name, email)
VALUES ('b9500000-0000-4000-8000-000000000001', 'Contact', 'contact@example.test');
INSERT INTO public.student_schools(student_id, name, status, grade)
VALUES ('b9500000-0000-4000-8000-000000000001', 'School', 'enrolled', '3');
INSERT INTO public.student_credentials(student_id, platform, username, password)
VALUES ('b9500000-0000-4000-8000-000000000001', 'fixture', 'username', 'private-password');

CREATE FUNCTION pg_temp.assert_sensitive(n integer, expected_read boolean, expected_write boolean)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_student_id uuid := 'b9500000-0000-4000-8000-000000000001';
  profile jsonb;
  details jsonb;
  changed integer;
  section text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-' || lpad(n::text, 12, '0'), true);
  IF n = 8 AND (SELECT user_id FROM public.students WHERE id = v_student_id) IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'legacy owner fixture was cleared before checking its permissions';
  END IF;
  FOREACH section IN ARRAY ARRAY['schools', 'personal', 'contacts', 'credentials'] LOOP
    IF public.can_access_sensitive_student(v_student_id, 'teaching.student_' || section || '.read') IS DISTINCT FROM expected_read
       OR public.can_access_sensitive_student(v_student_id, 'teaching.student_' || section || '.update') IS DISTINCT FROM expected_write THEN
      RAISE EXCEPTION 'sensitive helper permissions differ for user % section %', n, section;
    END IF;
  END LOOP;
  profile := public.get_student_profile_page(v_student_id);
  FOREACH section IN ARRAY ARRAY['schools', 'personal', 'contacts', 'credentials'] LOOP
    IF (profile->'capabilities'->section->>'read')::boolean IS DISTINCT FROM expected_read
       OR (profile->'capabilities'->section->>'update')::boolean IS DISTINCT FROM expected_write THEN
      RAISE EXCEPTION 'profile capabilities differ for user % section %', n, section;
    END IF;
  END LOOP;
  IF profile->'capabilities' ? 'read_sensitive' THEN
    RAISE EXCEPTION 'profile still exposes the old sensitive capabilities';
  END IF;
  -- Without school read access the current-school summary is only the grade.
  IF expected_read AND profile->'current_school' IS DISTINCT FROM
       '{"name":"School","status":"enrolled","grade":"3","class":null}'::jsonb THEN
    RAISE EXCEPTION 'full current school summary missing for user %: %', n, profile->'current_school';
  END IF;
  IF NOT expected_read AND profile->'current_school' IS DISTINCT FROM '{"grade":"3"}'::jsonb THEN
    RAISE EXCEPTION 'current school summary leaks school data for user %: %', n, profile->'current_school';
  END IF;
  IF profile ? 'email' OR profile ? 'student_contacts' OR profile ? 'student_credentials' THEN
    RAISE EXCEPTION 'public profile exposes private data';
  END IF;
  IF expected_read THEN
    details := public.get_student_sensitive_details(v_student_id);
    IF details->'student'->>'email' <> 'private@example.test'
       OR details ? 'contacts' OR details ? 'schools' THEN
      RAISE EXCEPTION 'private details missing for user %', n;
    END IF;
  ELSE
    BEGIN
      PERFORM public.get_student_sensitive_details(v_student_id);
      RAISE EXCEPTION 'private RPC incorrectly allowed user %', n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  IF (SELECT count(*) FROM public.student_contacts WHERE student_id = 'b9500000-0000-4000-8000-000000000001') <> expected_read::integer
     OR (SELECT count(*) FROM public.student_schools WHERE student_id = 'b9500000-0000-4000-8000-000000000001') <> expected_read::integer
     OR (SELECT count(*) FROM public.student_credentials WHERE student_id = 'b9500000-0000-4000-8000-000000000001') <> expected_read::integer THEN
    RAISE EXCEPTION 'sensitive child RLS differs for user %', n;
  END IF;
  IF expected_write THEN
    PERFORM public.update_student_sensitive(v_student_id, jsonb_build_object('phone', 'updated-by-' || n));
  ELSE
    BEGIN
      PERFORM public.update_student_sensitive(v_student_id, '{"phone":"forbidden"}');
      RAISE EXCEPTION 'sensitive update RPC incorrectly allowed user %', n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.student_contacts(student_id, name) VALUES (v_student_id, 'Forbidden contact');
      RAISE EXCEPTION 'contact insert incorrectly allowed user %', n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  -- Updating child rows requires their SELECT visibility as well as the
  -- separate update-sensitive grant. A read-only caller updates zero rows.
  UPDATE public.student_contacts SET phone = 'child-update-' || n WHERE student_id = v_student_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> (expected_read AND expected_write)::integer THEN
    RAISE EXCEPTION 'contact update RLS differs for user %', n;
  END IF;
  UPDATE public.student_schools SET school_student_id = 'child-update-' || n WHERE student_id = v_student_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> (expected_read AND expected_write)::integer THEN
    RAISE EXCEPTION 'school update RLS differs for user %', n;
  END IF;
  UPDATE public.student_credentials SET username = 'child-update-' || n WHERE student_id = v_student_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> (expected_read AND expected_write)::integer THEN
    RAISE EXCEPTION 'credential update RLS differs for user %', n;
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
-- No enrollment: global grants work and local grants/legacy ownership do not.
-- Check ownership before an authorized update clears the legacy user_id.
SELECT pg_temp.assert_sensitive(8, false, false);
SELECT pg_temp.assert_sensitive(1, true, true);
SELECT pg_temp.assert_sensitive(2, true, false);
SELECT pg_temp.assert_sensitive(3, false, true);
SELECT pg_temp.assert_sensitive(4, false, false);
SELECT pg_temp.assert_sensitive(5, false, false);
SELECT pg_temp.assert_sensitive(6, false, false);
SELECT pg_temp.assert_sensitive(7, false, false);
SELECT pg_temp.assert_sensitive(9, true, true);
SELECT pg_temp.assert_sensitive(10, false, false);
SELECT pg_temp.assert_sensitive(11, false, false);
SELECT pg_temp.assert_sensitive(12, true, true);

-- Reject ordinary permission keys, nulls and unknown student IDs even for an
-- authorized platform user; table-level PII privileges stay blocked.
SELECT set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  IF public.can_access_sensitive_student('b9500000-0000-4000-8000-000000000001', 'teaching.students.read')
     OR public.can_access_sensitive_student('b9500000-0000-4000-8000-000000000001', NULL)
     OR public.can_access_sensitive_student('b9500000-0000-4000-8000-000000000001', 'teaching.students.read_sensitive')
     OR public.can_access_sensitive_student('b9500000-0000-4000-8000-000000000001', 'teaching.teachers.read_sensitive')
     OR public.can_access_sensitive_student(NULL, 'teaching.student_personal.read')
     OR public.can_access_sensitive_student('b9500000-0000-4000-8000-000000000099', 'teaching.student_personal.read') THEN
    RAISE EXCEPTION 'sensitive helper does not fail closed';
  END IF;
  BEGIN
    PERFORM email FROM public.students;
    RAISE EXCEPTION 'direct student PII read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.students SET email = 'forbidden@example.test';
    RAISE EXCEPTION 'direct student PII update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET ROLE;
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id)
VALUES ('b9600000-0000-4000-8000-000000000001', 'b9500000-0000-4000-8000-000000000001',
        'b9300000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-000000000001', 'b9400000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
-- One enrollment: classroom/session paths work; its deny blocks local user
-- 10 while global user 9 remains authorized independently of that local deny.
SELECT pg_temp.assert_sensitive(1, true, true);
SELECT pg_temp.assert_sensitive(5, true, true);
SELECT pg_temp.assert_sensitive(6, true, true);
SELECT pg_temp.assert_sensitive(7, false, false);
SELECT pg_temp.assert_sensitive(9, true, true);
SELECT pg_temp.assert_sensitive(10, false, false);
SELECT pg_temp.assert_sensitive(11, false, false);

RESET ROLE;
INSERT INTO public.enrollments(id, student_id, course_id, classroom_id, class_session_id)
VALUES ('b9600000-0000-4000-8000-000000000002', 'b9500000-0000-4000-8000-000000000001',
        'b9300000-0000-4000-8000-000000000001', 'b9200000-0000-4000-8000-000000000002', 'b9400000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_sensitive(10, true, true);
SELECT pg_temp.assert_sensitive(7, false, false);

RESET ROLE;
DELETE FROM public.enrollments WHERE student_id = 'b9500000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
-- Removing all enrollments revokes local access without changing global access.
SELECT pg_temp.assert_sensitive(1, true, true);
SELECT pg_temp.assert_sensitive(5, false, false);
SELECT pg_temp.assert_sensitive(6, false, false);
SELECT pg_temp.assert_sensitive(10, false, false);

RESET ROLE;
-- One section each: users 13-16 read and update only their own section.
CREATE FUNCTION pg_temp.assert_single_section(n integer, granted text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_student_id uuid := 'b9500000-0000-4000-8000-000000000001';
  profile jsonb;
  section text;
  changed integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-' || lpad(n::text, 12, '0'), true);
  profile := public.get_student_profile_page(v_student_id);
  FOREACH section IN ARRAY ARRAY['schools', 'personal', 'contacts', 'credentials'] LOOP
    IF (profile->'capabilities'->section->>'read')::boolean IS DISTINCT FROM (section = granted)
       OR (profile->'capabilities'->section->>'update')::boolean IS DISTINCT FROM (section = granted) THEN
      RAISE EXCEPTION 'user % section % capability differs', n, section;
    END IF;
  END LOOP;
  IF (profile->'current_school' ? 'name') IS DISTINCT FROM (granted = 'schools') THEN
    RAISE EXCEPTION 'user % current school visibility differs: %', n, profile->'current_school';
  END IF;
  IF (SELECT count(*) FROM public.student_schools WHERE student_id = v_student_id) <> (granted = 'schools')::integer
     OR (SELECT count(*) FROM public.student_contacts WHERE student_id = v_student_id) <> (granted = 'contacts')::integer
     OR (SELECT count(*) FROM public.student_credentials WHERE student_id = v_student_id) <> (granted = 'credentials')::integer THEN
    RAISE EXCEPTION 'user % child-table RLS differs from section %', n, granted;
  END IF;
  IF granted = 'personal' THEN
    IF public.get_student_sensitive_details(v_student_id)->'student'->>'email' <> 'private@example.test' THEN
      RAISE EXCEPTION 'personal reader % cannot read personal data', n;
    END IF;
    PERFORM public.update_student_sensitive(v_student_id, jsonb_build_object('phone', 'section-' || n));
  ELSE
    BEGIN
      PERFORM public.get_student_sensitive_details(v_student_id);
      RAISE EXCEPTION 'personal RPC incorrectly allowed section user %', n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.update_student_sensitive(v_student_id, '{"phone":"forbidden"}');
      RAISE EXCEPTION 'personal update incorrectly allowed section user %', n;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END IF;
  UPDATE public.student_contacts SET phone = 'section-' || n WHERE student_id = v_student_id;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> (granted = 'contacts')::integer THEN
    RAISE EXCEPTION 'contact update differs for section user %', n;
  END IF;
  BEGIN
    INSERT INTO public.student_credentials(student_id, platform, username, password)
    VALUES (v_student_id, 'section-' || n, 'u', 'p');
    IF granted <> 'credentials' THEN
      RAISE EXCEPTION 'credential insert incorrectly allowed section user %', n;
    END IF;
    DELETE FROM public.student_credentials WHERE student_id = v_student_id AND platform = 'section-' || n;
  EXCEPTION WHEN insufficient_privilege THEN
    IF granted = 'credentials' THEN
      RAISE EXCEPTION 'credential insert denied for credential user %', n;
    END IF;
  END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.assert_single_section(13, 'schools');
SELECT pg_temp.assert_single_section(14, 'personal');
SELECT pg_temp.assert_single_section(15, 'contacts');
SELECT pg_temp.assert_single_section(16, 'credentials');

-- The students overview applies the same school rule per row.
SELECT set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000004', true);
DO $$
DECLARE item jsonb;
BEGIN
  SELECT value INTO item FROM jsonb_array_elements(public.get_students_overview(100, 0, 'Initially', 'name')->'items')
  WHERE value->>'id' = 'b9500000-0000-4000-8000-000000000001';
  IF item->'current_school' IS DISTINCT FROM '{"grade":"3"}'::jsonb THEN
    RAISE EXCEPTION 'overview leaks school data without school read: %', item->'current_school';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000013', true);
  SELECT value INTO item FROM jsonb_array_elements(public.get_students_overview(100, 0, 'Initially', 'name')->'items')
  WHERE value->>'id' = 'b9500000-0000-4000-8000-000000000001';
  IF item->'current_school'->>'name' IS DISTINCT FROM 'School' THEN
    RAISE EXCEPTION 'overview hides school name from a school reader: %', item->'current_school';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
