-- Move teaching data into one RBAC-governed system scope and establish a
-- single canonical person record shared by account and teacher identities.
-- Legacy owner columns are cleared and made nullable in this compatibility
-- migration; their physical removal follows after all API projections have
-- moved to the new profile relation.

CREATE TABLE IF NOT EXISTS public.person_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text,
  contact_email text,
  phone text,
  government_id text,
  address text,
  mailing_address text,
  birthday date,
  bio text,
  bio_document jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT person_profiles_display_name_not_blank CHECK (display_name IS NULL OR length(btrim(display_name)) > 0)
);
ALTER TABLE public.person_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.person_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.person_profiles TO service_role;

CREATE TABLE IF NOT EXISTS public.global_scope_migration_report (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  source_id uuid,
  row_count bigint NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.global_scope_migration_report ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.global_scope_migration_report FROM anon, authenticated;

-- Capture an ID-free row-count baseline before any scope rewrite or owner
-- cleanup so operators can compare the cutover result with the source state.
DO $$
DECLARE target_table text; entity_count bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'students','teachers','classrooms','courses','lessons','class_sessions',
    'enrollments','class_occurrences','occurrence_reports','report_templates'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', target_table) INTO entity_count;
    INSERT INTO public.global_scope_migration_report(category, row_count, detail)
    VALUES ('source_entity_count', entity_count, jsonb_build_object('table', target_table));
  END LOOP;
  SELECT count(*) INTO entity_count FROM public.class_sessions WHERE classroom_id IS NULL;
  INSERT INTO public.global_scope_migration_report(category, row_count, detail)
  VALUES ('sessions_missing_classroom', entity_count, jsonb_build_object('field', 'classroom_id'));
END;
$$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS person_profile_id uuid;
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS person_profile_id uuid;

DO $$
DECLARE account_row record; person_id uuid;
BEGIN
  FOR account_row IN
    SELECT id, display_name FROM public.profiles
    WHERE person_profile_id IS NULL ORDER BY id
  LOOP
    INSERT INTO public.person_profiles(display_name)
    VALUES (NULLIF(btrim(account_row.display_name), ''))
    RETURNING id INTO person_id;
    UPDATE public.profiles SET person_profile_id = person_id WHERE id = account_row.id;
  END LOOP;
END;
$$;

-- A display name seeded from the login email is a fallback, not a real name.
UPDATE public.person_profiles person
SET display_name = NULL
FROM public.profiles account
WHERE account.person_profile_id = person.id
  AND account.email IS NOT NULL
  AND lower(btrim(COALESCE(person.display_name, ''))) = lower(btrim(account.email));

-- Preserve the account-to-teacher link only where it is one-to-one. Legacy
-- duplicate links are reported by IDs, then the extra teacher rows become
-- unlinked people rather than being silently merged by account or name.
INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'account_linked_multiple_teachers', teacher.user_id, count(*) - 1,
       jsonb_build_object('teacher_ids', jsonb_agg(teacher.id ORDER BY teacher.created_at, teacher.id))
FROM public.teachers teacher
WHERE teacher.user_id IS NOT NULL
GROUP BY teacher.user_id
HAVING count(*) > 1;

WITH ranked AS (
  SELECT id, user_id,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at NULLS LAST, id) AS link_rank
  FROM public.teachers
  WHERE user_id IS NOT NULL
)
UPDATE public.teachers teacher
SET user_id = NULL
FROM ranked
WHERE ranked.id = teacher.id AND ranked.link_rank > 1;

UPDATE public.teachers teacher
SET person_profile_id = account.person_profile_id
FROM public.profiles account
WHERE teacher.user_id = account.id
  AND teacher.person_profile_id IS NULL;

-- Allocate any still-unlinked teachers unique person records without using
-- names or email as an identity-matching heuristic.
DO $$
DECLARE teacher_row record; profile_id uuid;
BEGIN
  FOR teacher_row IN
    SELECT id, name, email, phone, gov_id, address, birthday, bio, bio_document
    FROM public.teachers WHERE person_profile_id IS NULL ORDER BY id
  LOOP
    INSERT INTO public.person_profiles(display_name, contact_email, phone, government_id, address, birthday, bio, bio_document)
    VALUES (teacher_row.name, teacher_row.email, teacher_row.phone, teacher_row.gov_id,
            teacher_row.address, teacher_row.birthday, teacher_row.bio, teacher_row.bio_document)
    RETURNING id INTO profile_id;
    UPDATE public.teachers SET person_profile_id = profile_id WHERE id = teacher_row.id;
  END LOOP;
END;
$$;

-- Account values win. Teacher fields fill only empty account person fields;
-- login email remains in profiles.email and teacher.email becomes contact data.
UPDATE public.person_profiles person
SET display_name = COALESCE(NULLIF(btrim(person.display_name), ''), teacher.name),
    contact_email = COALESCE(NULLIF(btrim(person.contact_email), ''), NULLIF(btrim(teacher.email), '')),
    phone = COALESCE(NULLIF(btrim(person.phone), ''), NULLIF(btrim(teacher.phone), '')),
    government_id = COALESCE(NULLIF(btrim(person.government_id), ''), NULLIF(btrim(teacher.gov_id), '')),
    address = COALESCE(NULLIF(btrim(person.address), ''), NULLIF(btrim(teacher.address), '')),
    birthday = COALESCE(person.birthday, teacher.birthday),
    bio = COALESCE(NULLIF(btrim(person.bio), ''), NULLIF(btrim(teacher.bio), '')),
    bio_document = COALESCE(person.bio_document, teacher.bio_document),
    updated_at = timezone('utc'::text, now())
FROM public.teachers teacher
WHERE teacher.person_profile_id = person.id;

ALTER TABLE public.profiles ALTER COLUMN person_profile_id SET NOT NULL;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_person_profile_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_person_profile_id_fkey
  FOREIGN KEY (person_profile_id) REFERENCES public.person_profiles(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_person_profile_id_unique ON public.profiles(person_profile_id);

ALTER TABLE public.teachers ALTER COLUMN person_profile_id SET NOT NULL;
ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_person_profile_id_fkey;
ALTER TABLE public.teachers ADD CONSTRAINT teachers_person_profile_id_fkey
  FOREIGN KEY (person_profile_id) REFERENCES public.person_profiles(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS teachers_person_profile_id_unique ON public.teachers(person_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS teachers_user_id_unique ON public.teachers(user_id) WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS trigger
SET search_path = public AS $$
DECLARE person_id uuid;
BEGIN
  SELECT profile.person_profile_id INTO person_id
  FROM public.profiles profile WHERE profile.id = NEW.id;
  IF person_id IS NULL THEN
    INSERT INTO public.person_profiles(display_name)
    VALUES (CASE
      WHEN lower(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''))) = lower(btrim(COALESCE(NEW.email, ''))) THEN NULL
      ELSE NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), '')
    END)
    RETURNING id INTO person_id;
  END IF;
  INSERT INTO public.profiles(id, email, display_name, person_profile_id)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'display_name', person_id)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    person_profile_id = COALESCE(public.profiles.person_profile_id, EXCLUDED.person_profile_id),
    updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.teachings ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;
INSERT INTO public.teachings(name, is_global, is_quarantine)
VALUES ('EduLog Global Teaching', true, false)
ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS teachings_single_global_idx ON public.teachings(is_global) WHERE is_global;

INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'legacy_teaching_root_assignments', assignment.scope_id, count(*),
       jsonb_build_object('assignments', jsonb_agg(jsonb_build_object(
         'assignment_id', assignment.id, 'user_id', assignment.user_id, 'role_id', assignment.role_id,
         'effective_from', assignment.effective_from, 'effective_to', assignment.effective_to
       ) ORDER BY assignment.user_id, assignment.role_id, assignment.effective_from))
FROM public.user_role_assignments assignment
WHERE assignment.scope_type = 'teaching'
GROUP BY assignment.scope_id;

INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'legacy_teaching_root_policies', policy.scope_id, count(*),
       jsonb_build_object('policies', jsonb_agg(jsonb_build_object(
         'role_id', policy.role_id, 'permission_key', permission.key, 'effect', policy.effect
       ) ORDER BY policy.role_id, permission.key))
FROM public.role_permission_policies policy
JOIN public.permissions permission ON permission.id = policy.permission_id
WHERE policy.scope_type = 'teaching'
GROUP BY policy.scope_id;

INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'linked_teacher_profile_conflict', teacher.id, 1,
       jsonb_build_object('fields', jsonb_build_array('display_name'))
FROM public.teachers teacher
JOIN public.person_profiles person ON person.id = teacher.person_profile_id
JOIN public.profiles account ON account.person_profile_id = person.id
WHERE NULLIF(btrim(person.display_name), '') IS NOT NULL
  AND lower(btrim(person.display_name)) <> lower(btrim(teacher.name))
  AND lower(btrim(person.display_name)) <> lower(btrim(COALESCE(account.email, '')));

-- The virtual room gives every migrated session a real classroom parent.
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false;
-- The legacy owner default is auth.uid(), which is NULL while migrations run.
-- Clear and relax it before inserting the system-owned virtual classroom.
ALTER TABLE public.classrooms ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE public.classrooms ALTER COLUMN user_id DROP NOT NULL;
UPDATE public.classrooms SET user_id = NULL;
INSERT INTO public.classrooms(name, color, teaching_id, is_virtual)
SELECT 'Virtual classroom', '#64748b', teaching.id, true
FROM public.teachings teaching
WHERE teaching.is_global
  AND NOT EXISTS (SELECT 1 FROM public.classrooms WHERE is_virtual);
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_single_virtual_idx ON public.classrooms(is_virtual) WHERE is_virtual;

UPDATE public.class_sessions
SET classroom_id = (SELECT id FROM public.classrooms WHERE is_virtual LIMIT 1)
WHERE classroom_id IS NULL;
ALTER TABLE public.class_sessions ALTER COLUMN classroom_id SET NOT NULL;

-- Reparent all teaching entities to the singleton domain. Legacy root
-- assignments and non-null root policies intentionally keep their old scope
-- IDs, so they are reviewable but cannot silently grant global access.
UPDATE public.classrooms SET teaching_id = (SELECT id FROM public.teachings WHERE is_global LIMIT 1);
UPDATE public.courses SET teaching_id = (SELECT id FROM public.teachings WHERE is_global LIMIT 1);
UPDATE public.class_sessions SET teaching_id = (SELECT id FROM public.teachings WHERE is_global LIMIT 1);
UPDATE public.report_templates SET teaching_id = (SELECT id FROM public.teachings WHERE is_global LIMIT 1);

-- Keep distinct custom roles distinct after all roles share one scope. A source
-- suffix resolves name/code collisions without changing role IDs or policies.
DO $$
DECLARE role_row record; suffix text;
BEGIN
  FOR role_row IN
    SELECT role.id, role.code, role.name, role.teaching_id
    FROM public.roles role
    WHERE role.domain = 'teaching' AND NOT role.is_builtin AND role.teaching_id IS NOT NULL
    ORDER BY role.teaching_id, role.id
  LOOP
    suffix := left(replace(role_row.teaching_id::text, '-', ''), 8);
    IF EXISTS (
      SELECT 1 FROM public.roles other
      WHERE other.id <> role_row.id AND other.domain = 'teaching'
        AND other.name = role_row.name AND other.teaching_id IS DISTINCT FROM role_row.teaching_id
    ) THEN
      UPDATE public.roles SET name = left(role_row.name, 100) || ' [legacy ' || suffix || ']'
      WHERE id = role_row.id;
    END IF;
    IF role_row.code IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.roles other
      WHERE other.id <> role_row.id AND other.domain = 'teaching'
        AND other.code = role_row.code AND other.teaching_id IS DISTINCT FROM role_row.teaching_id
    ) THEN
      UPDATE public.roles SET code = left(role_row.code, 63) || '_legacy_' || suffix
      WHERE id = role_row.id;
    END IF;
  END LOOP;
END;
$$;

-- List likely duplicate people for review only. Names are not used to merge,
-- and the report contains record IDs and field names but no personal values.
INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'suspected_duplicate_teachers', (array_agg(id ORDER BY id))[1], count(*),
       jsonb_build_object('record_ids', to_jsonb(array_agg(id ORDER BY id)), 'fields', jsonb_build_array('name'))
FROM public.teachers
WHERE NULLIF(btrim(name), '') IS NOT NULL
GROUP BY lower(btrim(name))
HAVING count(*) > 1;

INSERT INTO public.global_scope_migration_report(category, source_id, row_count, detail)
SELECT 'suspected_duplicate_students', (array_agg(id ORDER BY id))[1], count(*),
       jsonb_build_object('record_ids', to_jsonb(array_agg(id ORDER BY id)), 'fields', jsonb_build_array('name'))
FROM public.students
WHERE NULLIF(btrim(name), '') IS NOT NULL
GROUP BY lower(btrim(name))
HAVING count(*) > 1;
UPDATE public.roles
SET teaching_id = (SELECT id FROM public.teachings WHERE is_global LIMIT 1)
WHERE domain = 'teaching' AND NOT is_builtin;

-- Clear former row-owner data and defaults. The columns remain temporarily for
-- old generated clients but are no longer ownership or authorization inputs.
DO $$
DECLARE target_table text; owned_rows bigint;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'students','student_contacts','student_schools','student_credentials',
    'courses','lessons','classrooms','classroom_schedules','class_sessions',
    'enrollments','class_occurrences','occurrence_reports','report_versions',
    'report_templates','teacher_credentials'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public' AND column_info.table_name = target_table AND column_info.column_name = 'user_id'
    ) THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id IS NOT NULL', target_table) INTO owned_rows;
      IF owned_rows > 0 THEN
        INSERT INTO public.global_scope_migration_report(category, row_count, detail)
        VALUES ('legacy_owner_rows_cleared', owned_rows, jsonb_build_object('table', target_table, 'field', 'user_id'));
      END IF;
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP DEFAULT', target_table);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', target_table);
      EXECUTE format('UPDATE public.%I SET user_id = NULL', target_table);
    END IF;
  END LOOP;
END;
$$;

-- Removing an account must not delete a system-level teacher object. The
-- person profile and teacher record remain; only their optional account link
-- is removed.
ALTER TABLE public.teachers DROP CONSTRAINT IF EXISTS teachers_user_id_fkey;
ALTER TABLE public.teachers ADD CONSTRAINT teachers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Ensure even legacy RPCs and direct authenticated table writes cannot restore
-- account ownership or create a second teaching root. Existing RLS remains
-- responsible for deciding whether the caller may perform the operation.
CREATE OR REPLACE FUNCTION public.normalize_global_teaching_row()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.teaching_id := (SELECT id FROM public.teachings WHERE is_global LIMIT 1);
  IF NEW.teaching_id IS NULL THEN RAISE EXCEPTION 'GLOBAL_TEACHING_SCOPE_MISSING'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_legacy_owner()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.user_id := NULL;
  RETURN NEW;
END;
$$;

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['courses','classrooms','class_sessions','report_templates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS normalize_global_teaching_scope ON public.%I', target_table);
    EXECUTE format('CREATE TRIGGER normalize_global_teaching_scope BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.normalize_global_teaching_row()', target_table);
  END LOOP;
  FOREACH target_table IN ARRAY ARRAY[
    'students','student_contacts','student_schools','student_credentials','courses','lessons',
    'classrooms','class_sessions',
    'classroom_schedules','enrollments','class_occurrences','occurrence_reports',
    'report_versions','teacher_credentials'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns column_info
      WHERE column_info.table_schema = 'public' AND column_info.table_name = target_table AND column_info.column_name = 'user_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS clear_legacy_owner_before_write ON public.%I', target_table);
      EXECUTE format('CREATE TRIGGER clear_legacy_owner_before_write BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.clear_legacy_owner()', target_table);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles(role_id, source_scope_type, source_scope_id) AS (
  SELECT assignment.role_id, assignment.scope_type, assignment.scope_id
  FROM public.user_role_assignments assignment
  WHERE assignment.user_id = p_user_id
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
    AND (
      assignment.scope_type = 'system'
      OR (assignment.scope_type = 'teaching' AND assignment.scope_id = p_teaching_id)
      OR (assignment.scope_type = 'classroom' AND assignment.scope_id = p_classroom_id)
      OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id)
    )
), role_tree(role_id, source_scope_type, source_scope_id) AS (
  SELECT role_id, source_scope_type, source_scope_id FROM assigned_roles WHERE role_id IS NOT NULL
  UNION
  SELECT inheritance.parent_role_id, child.source_scope_type, child.source_scope_id
  FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  JOIN role_tree role ON role.role_id = policy.role_id
  WHERE permission.key = p_permission_key AND (
    (policy.scope_type = 'system' AND role.source_scope_type = 'system')
    OR (policy.scope_type = 'teaching' AND (policy.scope_id IS NULL OR policy.scope_id = p_teaching_id) AND (
      role.source_scope_type = 'system'
      OR (role.source_scope_type = 'teaching' AND role.source_scope_id = p_teaching_id)
      OR (role.source_scope_type = 'classroom' AND role.source_scope_id = COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)))
      OR (role.source_scope_type = 'class_session' AND role.source_scope_id = p_class_session_id)
    ))
    OR (policy.scope_type = 'classroom' AND policy.scope_id = COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)))
    OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
  )
)
SELECT COALESCE(bool_or(effect = 'allow'), false) AND NOT COALESCE(bool_or(effect = 'deny'), false),
       COALESCE(bool_or(effect = 'deny'), false), EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

-- Membership and former student.user_id ownership are not access grants.
CREATE OR REPLACE FUNCTION public.can_access_teaching(p_teaching_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_permission_key IS NOT NULL
    AND public.has_teaching_permission(auth.uid(), p_permission_key, p_teaching_id);
$$;

CREATE OR REPLACE FUNCTION public.can_access_classroom(p_classroom_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classrooms classroom
    WHERE classroom.id = p_classroom_id
      AND public.has_teaching_permission(auth.uid(), p_permission_key, classroom.teaching_id, classroom.id, NULL)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_teacher(
  p_teacher_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers teacher
    WHERE teacher.id = p_teacher_id
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles account
          WHERE account.id = auth.uid()
            AND account.person_profile_id = teacher.person_profile_id
        )
        OR public.has_teaching_permission(
          auth.uid(), COALESCE(p_permission_key, 'teaching.teachers.read'),
          (SELECT id FROM public.teachings WHERE is_global LIMIT 1), NULL, NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.class_session_teachers assignment
          JOIN public.class_sessions session ON session.id = assignment.class_session_id
          WHERE assignment.teacher_id = teacher.id
            AND public.has_teaching_permission(
              auth.uid(), COALESCE(p_permission_key, 'teaching.teachers.read'),
              session.teaching_id, session.classroom_id, session.id
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_sensitive_details(p_teacher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  teacher_row jsonb;
  credentials jsonb;
BEGIN
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.read_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'id', teacher.id,
    'person_profile_id', person.id,
    'user_id', teacher.user_id,
    'name', person.display_name,
    'email', person.contact_email,
    'phone', person.phone,
    'address', person.address,
    'mailing_address', person.mailing_address,
    'birthday', person.birthday,
    'gov_id', person.government_id,
    'bio', person.bio,
    'bio_document', person.bio_document,
    'created_at', teacher.created_at,
    'updated_at', GREATEST(teacher.updated_at, person.updated_at)
  )
  INTO teacher_row
  FROM public.teachers teacher
  JOIN public.person_profiles person ON person.id = teacher.person_profile_id
  WHERE teacher.id = p_teacher_id;
  IF teacher_row IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(credential) - 'user_id' ORDER BY credential.created_at), '[]'::jsonb)
  INTO credentials
  FROM public.teacher_credentials credential
  WHERE credential.teacher_id = p_teacher_id;

  RETURN jsonb_build_object('teacher', teacher_row, 'credentials', credentials);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_teacher_profile(p_teacher_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  person_id uuid;
  updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN ('name', 'bio', 'bio_document')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TEACHER_PROFILE_PATCH';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.update') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEACHER_PERMISSION_REQUIRED';
  END IF;
  SELECT teacher.person_profile_id INTO person_id FROM public.teachers teacher WHERE teacher.id = p_teacher_id;
  IF person_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.person_profiles person
  SET display_name = CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'), '') ELSE person.display_name END,
      bio = CASE WHEN p_patch ? 'bio' THEN p_patch->>'bio' ELSE person.bio END,
      bio_document = CASE WHEN p_patch ? 'bio_document' THEN p_patch->'bio_document' ELSE person.bio_document END,
      updated_at = timezone('utc'::text, now())
  WHERE person.id = person_id;
  SELECT jsonb_build_object('id', teacher.id, 'person_profile_id', person.id, 'user_id', teacher.user_id,
    'name', person.display_name, 'bio', person.bio, 'bio_document', person.bio_document,
    'created_at', teacher.created_at, 'updated_at', GREATEST(teacher.updated_at, person.updated_at))
  INTO updated_row
  FROM public.teachers teacher JOIN public.person_profiles person ON person.id = teacher.person_profile_id
  WHERE teacher.id = p_teacher_id;
  RETURN updated_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_teacher_sensitive(p_teacher_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE person_id uuid; updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) key WHERE key NOT IN ('email', 'phone', 'address', 'mailing_address', 'birthday', 'gov_id')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SENSITIVE_PATCH';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.update_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;
  SELECT teacher.person_profile_id INTO person_id FROM public.teachers teacher WHERE teacher.id = p_teacher_id;
  IF person_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.person_profiles person
  SET contact_email = CASE WHEN p_patch ? 'email' THEN NULLIF(btrim(p_patch->>'email'), '') ELSE person.contact_email END,
      phone = CASE WHEN p_patch ? 'phone' THEN NULLIF(btrim(p_patch->>'phone'), '') ELSE person.phone END,
      address = CASE WHEN p_patch ? 'address' THEN NULLIF(btrim(p_patch->>'address'), '') ELSE person.address END,
      mailing_address = CASE WHEN p_patch ? 'mailing_address' THEN NULLIF(btrim(p_patch->>'mailing_address'), '') ELSE person.mailing_address END,
      birthday = CASE WHEN p_patch ? 'birthday' THEN NULLIF(p_patch->>'birthday', '')::date ELSE person.birthday END,
      government_id = CASE WHEN p_patch ? 'gov_id' THEN NULLIF(btrim(p_patch->>'gov_id'), '') ELSE person.government_id END,
      updated_at = timezone('utc'::text, now())
  WHERE person.id = person_id;
  SELECT jsonb_build_object('id', teacher.id, 'person_profile_id', person.id, 'user_id', teacher.user_id,
    'name', person.display_name, 'email', person.contact_email, 'phone', person.phone,
    'address', person.address, 'mailing_address', person.mailing_address, 'birthday', person.birthday,
    'gov_id', person.government_id, 'bio', person.bio, 'bio_document', person.bio_document,
    'created_at', teacher.created_at, 'updated_at', GREATEST(teacher.updated_at, person.updated_at))
  INTO updated_row
  FROM public.teachers teacher JOIN public.person_profiles person ON person.id = teacher.person_profile_id
  WHERE teacher.id = p_teacher_id;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.update_teacher_profile(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_teacher_profile(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_class_session(p_class_session_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.class_sessions session
    WHERE session.id = p_class_session_id
      AND public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(p_student_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = p_student_id AND (
      public.has_teaching_permission(auth.uid(), p_permission_key,
        (SELECT id FROM public.teachings WHERE is_global LIMIT 1), NULL, NULL)
      OR EXISTS (
        SELECT 1 FROM public.enrollments enrollment
        LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
        LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
        WHERE enrollment.student_id = student.id
          AND public.has_teaching_permission(auth.uid(), p_permission_key,
            COALESCE(session.teaching_id, classroom.teaching_id),
            COALESCE(classroom.id, session.classroom_id), session.id)
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(p_enrollment_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.enrollments enrollment
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_student(enrollment.student_id, p_permission_key)
      AND public.has_teaching_permission(auth.uid(), p_permission_key,
        COALESCE(session.teaching_id, classroom.teaching_id),
        COALESCE(classroom.id, session.classroom_id), session.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_report(p_report_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_permission_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.occurrence_reports report
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE report.id = p_report_id
      AND public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id)
  );
$$;

CREATE INDEX IF NOT EXISTS person_profiles_display_name_idx ON public.person_profiles(display_name);
CREATE INDEX IF NOT EXISTS person_profiles_contact_email_idx ON public.person_profiles(contact_email);
CREATE TRIGGER person_profiles_updated_at BEFORE UPDATE ON public.person_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Legacy teacher create requests are normalized into the canonical person
-- profile. Existing links are reusable only for initial linking; changing or
-- splitting a persisted link is rejected until an explicit field-ownership
-- workflow is used.
CREATE OR REPLACE FUNCTION public.normalize_teacher_person_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE person_id uuid; person_row public.person_profiles%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.person_profile_id IS DISTINCT FROM OLD.person_profile_id THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TEACHER_ACCOUNT_LINK_REQUIRES_PROFILE_SPLIT';
    END IF;
    RETURN NEW;
  END IF;

  person_id := NEW.person_profile_id;
  IF person_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT account.person_profile_id INTO person_id
    FROM public.profiles account WHERE account.id = NEW.user_id;
    IF EXISTS (SELECT 1 FROM public.teachers teacher WHERE teacher.user_id = NEW.user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TEACHER_ACCOUNT_ALREADY_LINKED';
    END IF;
  END IF;

  IF person_id IS NULL THEN
    INSERT INTO public.person_profiles(display_name,contact_email,phone,government_id,address,birthday,bio,bio_document)
    VALUES (NULLIF(btrim(NEW.name), ''), NULLIF(btrim(NEW.email), ''), NEW.phone, NEW.gov_id,
      NEW.address, NEW.birthday, NEW.bio, NEW.bio_document)
    RETURNING id INTO person_id;
  ELSE
    SELECT * INTO person_row FROM public.person_profiles person WHERE person.id = person_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'PERSON_PROFILE_NOT_FOUND'; END IF;
    UPDATE public.person_profiles person SET
      display_name = COALESCE(NULLIF(btrim(person.display_name), ''), NULLIF(btrim(NEW.name), '')),
      contact_email = COALESCE(NULLIF(btrim(person.contact_email), ''), NULLIF(btrim(NEW.email), '')),
      phone = COALESCE(NULLIF(btrim(person.phone), ''), NULLIF(btrim(NEW.phone), '')),
      government_id = COALESCE(NULLIF(btrim(person.government_id), ''), NULLIF(btrim(NEW.gov_id), '')),
      address = COALESCE(NULLIF(btrim(person.address), ''), NULLIF(btrim(NEW.address), '')),
      birthday = COALESCE(person.birthday, NEW.birthday),
      bio = COALESCE(NULLIF(btrim(person.bio), ''), NULLIF(btrim(NEW.bio), '')),
      bio_document = COALESCE(person.bio_document, NEW.bio_document)
    WHERE person.id = person_id;
  END IF;
  NEW.person_profile_id := person_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_teacher_person_profile ON public.teachers;
CREATE TRIGGER normalize_teacher_person_profile BEFORE INSERT OR UPDATE ON public.teachers
FOR EACH ROW EXECUTE FUNCTION public.normalize_teacher_person_profile();

-- Teaching APIs write name and bio through the guarded person-profile RPC.
-- Deny direct table updates so compatibility columns cannot become a second
-- editable copy of profile data.
REVOKE UPDATE ON public.teachers FROM PUBLIC, anon, authenticated;
GRANT SELECT (person_profile_id) ON public.teachers TO authenticated;

NOTIFY pgrst, 'reload schema';
