-- Split the student sensitive-data permission pair into four sections.
--
-- `teaching.students.read_sensitive` / `update_sensitive` covered personal
-- fields, contacts, school records and credentials at once. Each section now
-- has its own read/update pair:
--
--   teaching.student_schools.*      student_schools rows
--   teaching.student_personal.*     students.gov_id, email, phone,
--                                   residence_address, mailing_address, birthday
--   teaching.student_contacts.*     student_contacts rows
--   teaching.student_credentials.*  student_credentials rows
--
-- Every policy row holding the old read key gains the four `.read` keys on
-- the same role, scope and effect; the old update key maps to the four
-- `.update` keys. The two old keys are then dropped. `teaching.teachers.*`
-- sensitive keys are unchanged.
--
-- The current-school summary in get_students_overview and
-- get_student_profile_page returns only `{grade}` unless the caller can read
-- school records for that student.
--
-- Rerunnable: the mapping is ON CONFLICT DO NOTHING and finds nothing once
-- the old keys are gone; functions and policies are replaced.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.has_api_permission(uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_student_profile_page(uuid)') IS NULL
     OR to_regprocedure('public.get_students_overview(integer,integer,text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = 'teaching.dashboard.access') THEN
    RAISE EXCEPTION '1000162 prerequisites missing; apply migrations through 1000161 first';
  END IF;
END;
$$;

-- 1. New permission keys.

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.student_schools.read', 'Read student school records', 'Read school names, status, class and school student IDs', 'teaching', 'student_schools', 'read'),
  ('teaching.student_schools.update', 'Update student school records', 'Create, edit and delete student school records', 'teaching', 'student_schools', 'update'),
  ('teaching.student_personal.read', 'Read student personal data', 'Read government ID, email, phone, addresses and birthday', 'teaching', 'student_personal', 'read'),
  ('teaching.student_personal.update', 'Update student personal data', 'Edit government ID, email, phone, addresses and birthday', 'teaching', 'student_personal', 'update'),
  ('teaching.student_contacts.read', 'Read student contacts', 'Read guardian and emergency contacts', 'teaching', 'student_contacts', 'read'),
  ('teaching.student_contacts.update', 'Update student contacts', 'Create, edit and delete guardian and emergency contacts', 'teaching', 'student_contacts', 'update'),
  ('teaching.student_credentials.read', 'Read student credentials', 'Read student platform accounts and passwords', 'teaching', 'student_credentials', 'read'),
  ('teaching.student_credentials.update', 'Update student credentials', 'Create, edit and delete student platform accounts', 'teaching', 'student_credentials', 'update')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- 2. Map existing grants and drop the old keys.

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT DISTINCT policy.role_id, new_permission.id, policy.scope_type, policy.scope_id, policy.effect
FROM (VALUES
  ('teaching.students.read_sensitive', 'teaching.student_schools.read'),
  ('teaching.students.read_sensitive', 'teaching.student_personal.read'),
  ('teaching.students.read_sensitive', 'teaching.student_contacts.read'),
  ('teaching.students.read_sensitive', 'teaching.student_credentials.read'),
  ('teaching.students.update_sensitive', 'teaching.student_schools.update'),
  ('teaching.students.update_sensitive', 'teaching.student_personal.update'),
  ('teaching.students.update_sensitive', 'teaching.student_contacts.update'),
  ('teaching.students.update_sensitive', 'teaching.student_credentials.update')
) mapping(old_key, new_key)
JOIN public.permissions old_permission ON old_permission.key = mapping.old_key
JOIN public.permissions new_permission ON new_permission.key = mapping.new_key
JOIN public.role_permission_policies policy ON policy.permission_id = old_permission.id
ON CONFLICT DO NOTHING;

DELETE FROM public.role_permission_policies policy
USING public.permissions permission
WHERE policy.permission_id = permission.id
  AND permission.key IN ('teaching.students.read_sensitive', 'teaching.students.update_sensitive');

DELETE FROM public.permissions
WHERE key IN ('teaching.students.read_sensitive', 'teaching.students.update_sensitive');

-- 3. Sensitive student helper accepts only the eight section keys.

CREATE OR REPLACE FUNCTION public.can_access_sensitive_student(
  p_student_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(p_permission_key IN (
    'teaching.student_schools.read', 'teaching.student_schools.update',
    'teaching.student_personal.read', 'teaching.student_personal.update',
    'teaching.student_contacts.read', 'teaching.student_contacts.update',
    'teaching.student_credentials.read', 'teaching.student_credentials.update'
  ), false)
    AND public.can_access_student(p_student_id, p_permission_key);
$$;

REVOKE ALL ON FUNCTION public.can_access_sensitive_student(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_sensitive_student(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.can_access_sensitive_student(uuid, text)
  IS 'Checks a student sensitive-section permission (schools, personal, contacts, credentials) through platform grants or authorized enrollment paths.';

-- 4. Child-table RLS uses its own section.

DROP POLICY IF EXISTS "Canonical student contacts read" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts create" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts update" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts delete" ON public.student_contacts;
CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_contacts.read'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_contacts.update'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_contacts.update'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_contacts.update'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_contacts.update'));

DROP POLICY IF EXISTS "Canonical student schools read" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools create" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools update" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools delete" ON public.student_schools;
CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_schools.read'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_schools.update'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_schools.update'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_schools.update'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_schools.update'));

DROP POLICY IF EXISTS "Canonical student credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials delete" ON public.student_credentials;
CREATE POLICY "Canonical student credentials read" ON public.student_credentials FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_credentials.read'));
CREATE POLICY "Canonical student credentials create" ON public.student_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_credentials.update'));
CREATE POLICY "Canonical student credentials update" ON public.student_credentials FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_credentials.update'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.student_credentials.update'));
CREATE POLICY "Canonical student credentials delete" ON public.student_credentials FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.student_credentials.update'));

-- 5. Personal-data RPCs. Contacts, schools and credentials are read through
-- their own tables, whose RLS applies the section permissions above.

CREATE OR REPLACE FUNCTION public.get_student_sensitive_details(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  student_row jsonb;
BEGIN
  IF NOT public.can_access_sensitive_student(p_student_id, 'teaching.student_personal.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'id', student.id,
    'gov_id', student.gov_id,
    'email', student.email,
    'phone', student.phone,
    'residence_address', student.residence_address,
    'mailing_address', student.mailing_address,
    'birthday', student.birthday
  ) INTO student_row
  FROM public.students student
  WHERE student.id = p_student_id;
  IF student_row IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object('student', student_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_student_sensitive(p_student_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_patch) key
       WHERE key NOT IN ('gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SENSITIVE_PATCH';
  END IF;
  IF NOT public.can_access_sensitive_student(p_student_id, 'teaching.student_personal.update') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  UPDATE public.students student
  SET gov_id = CASE WHEN p_patch ? 'gov_id' THEN p_patch->>'gov_id' ELSE student.gov_id END,
      email = CASE WHEN p_patch ? 'email' THEN p_patch->>'email' ELSE student.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN p_patch->>'phone' ELSE student.phone END,
      residence_address = CASE WHEN p_patch ? 'residence_address' THEN p_patch->>'residence_address' ELSE student.residence_address END,
      mailing_address = CASE WHEN p_patch ? 'mailing_address' THEN p_patch->>'mailing_address' ELSE student.mailing_address END,
      birthday = CASE WHEN p_patch ? 'birthday' THEN NULLIF(p_patch->>'birthday', '')::date ELSE student.birthday END
  WHERE student.id = p_student_id
  RETURNING to_jsonb(student) - 'user_id' INTO updated_row;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_sensitive_details(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_sensitive_details(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.update_student_sensitive(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_student_sensitive(uuid, jsonb) TO authenticated, service_role;

-- 6. Current-school summary: the full projection needs school read access,
-- otherwise only the grade is returned.

CREATE OR REPLACE FUNCTION private.student_current_school_summary(p_student_id uuid, p_full boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_full THEN jsonb_build_object(
      'name', school.name,
      'status', lower(school.status),
      'grade', school.grade,
      'class', school.class
    )
    WHEN school.grade IS NULL THEN NULL
    ELSE jsonb_build_object('grade', school.grade)
  END
  FROM public.student_schools school
  WHERE school.student_id = p_student_id
    AND lower(COALESCE(school.status, '')) = 'enrolled'
  ORDER BY school.start_date DESC NULLS LAST, school.updated_at DESC NULLS LAST, school.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.student_current_school_summary(uuid, boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_students_overview(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT '',
  p_sort text DEFAULT 'name'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_search text := btrim(COALESCE(p_search, ''));
  v_all_schools boolean;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LIMIT';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_OFFSET';
  END IF;
  IF char_length(v_search) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SEARCH';
  END IF;
  IF p_sort IS NULL OR p_sort NOT IN ('name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SORT';
  END IF;

  v_all_schools := public.has_api_permission(v_user_id, 'teaching.student_schools.read', NULL, NULL);

  WITH enrollment_scopes AS MATERIALIZED (
    SELECT enrollment.student_id,
      COALESCE(classroom.id, session.classroom_id) AS classroom_id,
      session.id AS class_session_id
    FROM public.enrollments enrollment
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
  ),
  global_student_access AS MATERIALIZED (
    SELECT public.has_api_permission(v_user_id, 'teaching.students.read', NULL, NULL) AS can_read_all
  ),
  visible_student_ids AS MATERIALIZED (
    -- Compatibility for any legacy rows not yet cleared by the scope migration.
    SELECT student.id FROM public.students student WHERE student.user_id = v_user_id
    UNION
    -- A platform-level read grant includes students without an enrollment.
    SELECT student.id
    FROM public.students student
    CROSS JOIN global_student_access access
    WHERE access.can_read_all
    UNION
    -- Local teaching roles only see students through an authorized enrollment
    -- path. The permission resolver preserves classroom/session deny precedence.
    SELECT enrollment.student_id
    FROM enrollment_scopes enrollment
    WHERE public.has_api_permission(
      v_user_id,
      'teaching.students.read',
      enrollment.classroom_id,
      enrollment.class_session_id
    )
  ),
  filtered_students AS MATERIALIZED (
    SELECT student.id, student.name, student.notes, student.notes_document,
      student.external_link, student.created_at, student.updated_at
    FROM public.students student
    JOIN visible_student_ids visible ON visible.id = student.id
    WHERE v_search = '' OR strpos(lower(student.name), lower(v_search)) > 0
  ),
  ordered_students AS MATERIALIZED (
    SELECT student.*, row_number() OVER (
      ORDER BY
        CASE WHEN p_sort = 'name' THEN lower(student.name) END ASC NULLS LAST,
        CASE WHEN p_sort = '-name' THEN lower(student.name) END DESC NULLS LAST,
        CASE WHEN p_sort = 'created_at' THEN student.created_at END ASC NULLS LAST,
        CASE WHEN p_sort = '-created_at' THEN student.created_at END DESC NULLS LAST,
        CASE WHEN p_sort = 'updated_at' THEN student.updated_at END ASC NULLS LAST,
        CASE WHEN p_sort = '-updated_at' THEN student.updated_at END DESC NULLS LAST,
        student.id ASC
    ) AS page_ordinal
    FROM filtered_students student
  ),
  page_rows AS MATERIALIZED (
    SELECT page_row.*,
      private.student_current_school_summary(
        page_row.id,
        v_all_schools OR public.can_access_sensitive_student(page_row.id, 'teaching.student_schools.read')
      ) AS current_school
    FROM (SELECT * FROM ordered_students ORDER BY page_ordinal LIMIT p_limit OFFSET p_offset) page_row
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(page_row) - 'page_ordinal' ORDER BY page_row.page_ordinal)
      FROM page_rows page_row
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered_students)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_students_overview(integer,integer,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_students_overview(integer,integer,text,text) TO authenticated;
COMMENT ON FUNCTION public.get_students_overview(integer,integer,text,text)
  IS 'Returns paginated students readable through platform, classroom, or class-session teaching permissions; the current school shows only the grade without school read access.';

CREATE OR REPLACE FUNCTION public.get_student_profile_page(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile jsonb;
BEGIN
  IF v_user_id IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_student_id IS NULL OR NOT public.can_access_student(p_student_id, 'teaching.students.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'STUDENT_ACCESS_DENIED';
  END IF;

  SELECT jsonb_build_object(
    'id', student.id,
    'name', student.name,
    'notes', student.notes,
    'notes_document', student.notes_document,
    'external_link', student.external_link,
    'created_at', student.created_at,
    'updated_at', student.updated_at,
    'current_school', private.student_current_school_summary(student.id, capability.schools_read),
    'enrollments', COALESCE(enrollments.items, '[]'::jsonb),
    'capabilities', jsonb_build_object(
      'schools', jsonb_build_object('read', capability.schools_read, 'update', capability.schools_update),
      'personal', jsonb_build_object('read', capability.personal_read, 'update', capability.personal_update),
      'contacts', jsonb_build_object('read', capability.contacts_read, 'update', capability.contacts_update),
      'credentials', jsonb_build_object('read', capability.credentials_read, 'update', capability.credentials_update)
    )
  ) INTO v_profile
  FROM public.students student
  CROSS JOIN LATERAL (
    SELECT
      public.can_access_sensitive_student(student.id, 'teaching.student_schools.read') AS schools_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_schools.update') AS schools_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_personal.read') AS personal_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_personal.update') AS personal_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_contacts.read') AS contacts_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_contacts.update') AS contacts_update,
      public.can_access_sensitive_student(student.id, 'teaching.student_credentials.read') AS credentials_read,
      public.can_access_sensitive_student(student.id, 'teaching.student_credentials.update') AS credentials_update
  ) capability
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', enrollment.id,
      'student_id', enrollment.student_id,
      'course_id', enrollment.course_id,
      'classroom_id', enrollment.classroom_id,
      'class_session_id', enrollment.class_session_id,
      'status', enrollment.status,
      'start_date', enrollment.start_date,
      'lesson_number', enrollment.lesson_number,
      'external_link', enrollment.external_link,
      'time_zone', enrollment.time_zone,
      'koding_admission_id', enrollment.koding_admission_id,
      'created_at', enrollment.created_at,
      'updated_at', enrollment.updated_at,
      'courses', CASE WHEN course.id IS NULL THEN NULL ELSE jsonb_build_object('subject', course.subject, 'stage', course.stage, 'display_name', course.display_name) END,
      'classrooms', CASE WHEN classroom.id IS NULL THEN NULL ELSE jsonb_build_object('name', classroom.name) END,
      'class_sessions', CASE WHEN session.id IS NULL THEN NULL ELSE jsonb_build_object(
        'name', session.name,
        'day_of_week', session.day_of_week,
        'start_time', session.start_time,
        'end_time', session.end_time,
        'time_zone', session.time_zone,
        'session_type', session.session_type,
        'schedule_mode', session.schedule_mode,
        'class_session_schedule_rules', COALESCE(schedule_rules.items, '[]'::jsonb)
      ) END
    ) ORDER BY enrollment.created_at, enrollment.id) AS items
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
        'id', rule.id,
        'schedule_kind', rule.schedule_kind,
        'day_of_week', rule.day_of_week,
        'day_of_month', rule.day_of_month,
        'occurrence_date', rule.occurrence_date,
        'start_time', rule.start_time,
        'end_time', rule.end_time
      ) ORDER BY rule.occurrence_date NULLS LAST, rule.day_of_week NULLS LAST, rule.day_of_month NULLS LAST, rule.id) AS items
      FROM public.class_session_schedule_rules rule
      WHERE rule.class_session_id = session.id
    ) schedule_rules ON TRUE
    WHERE enrollment.student_id = student.id
  ) enrollments ON TRUE
  WHERE student.id = p_student_id;

  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_profile_page(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_profile_page(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_student_profile_page(uuid)
  IS 'Returns a safe Student Page API profile, a current-school summary limited by school read access, and per-section sensitive capabilities.';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.permissions
      WHERE key IN (
        'teaching.student_schools.read', 'teaching.student_schools.update',
        'teaching.student_personal.read', 'teaching.student_personal.update',
        'teaching.student_contacts.read', 'teaching.student_contacts.update',
        'teaching.student_credentials.read', 'teaching.student_credentials.update'
      )) <> 8 THEN
    RAISE EXCEPTION '1000162 student sensitive permission catalogue is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM public.permissions
             WHERE key IN ('teaching.students.read_sensitive', 'teaching.students.update_sensitive')) THEN
    RAISE EXCEPTION '1000162 old student sensitive permissions were not removed';
  END IF;
  IF (SELECT count(*) FROM public.permissions
      WHERE key IN ('teaching.teachers.read_sensitive', 'teaching.teachers.update_sensitive')) <> 2 THEN
    RAISE EXCEPTION '1000162 must not change teacher sensitive permissions';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
