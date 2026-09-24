-- Turn profiles into the single person record. The preceding 1000096 migration
-- is deliberately left immutable; this forward migration absorbs and removes
-- its temporary person_profiles relation.

DO $$
BEGIN
  IF to_regclass('public.person_profiles') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.teachers') IS NULL THEN
    RAISE EXCEPTION '1000097 prerequisites missing; apply 1000096 first';
  END IF;
END;
$$;

INSERT INTO public.global_scope_migration_report(category, row_count, detail)
SELECT 'profiles_person_master_pre_cutover', count(*),
       jsonb_build_object('accounts', count(*) FILTER (WHERE profile.person_profile_id IS NOT NULL),
                          'profile_rows', count(DISTINCT profile.person_profile_id))
FROM public.profiles profile;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS government_id text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS mailing_address text,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS bio_document jsonb,
  ADD COLUMN IF NOT EXISTS profile_version bigint NOT NULL DEFAULT 1;

-- profiles.id was the Auth UID. Preserve it as the nullable account link and
-- use the already-stable person profile UUID as the new primary key.
ALTER TABLE public.profiles RENAME COLUMN id TO auth_user_id;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_pkey;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE public.profiles ALTER COLUMN auth_user_id DROP NOT NULL;
ALTER TABLE public.profiles ADD COLUMN id uuid;
UPDATE public.profiles SET id = gen_random_uuid();
UPDATE public.profiles SET id = person_profile_id;

UPDATE public.profiles account
SET display_name = COALESCE(
      NULLIF(NULLIF(btrim(account.display_name), ''), btrim(account.email)),
      person.display_name
    ),
    contact_email = person.contact_email,
    phone = person.phone,
    government_id = person.government_id,
    address = person.address,
    mailing_address = person.mailing_address,
    birthday = person.birthday,
    bio = person.bio,
    bio_document = person.bio_document,
    updated_at = GREATEST(account.updated_at, person.updated_at)
FROM public.person_profiles person
WHERE account.person_profile_id = person.id;

-- Teachers without accounts keep their canonical person-profile ID and become
-- profiles rows with a NULL auth_user_id. No name/email matching is used.
INSERT INTO public.profiles(
  id, auth_user_id, email, display_name, contact_email, phone, government_id,
  address, mailing_address, birthday, bio, bio_document, created_at, updated_at
)
SELECT person.id, NULL, NULL, person.display_name, person.contact_email,
       person.phone, person.government_id, person.address, person.mailing_address,
       person.birthday, person.bio, person.bio_document, person.created_at, person.updated_at
FROM public.person_profiles person
WHERE NOT EXISTS (SELECT 1 FROM public.profiles account WHERE account.id = person.id);

ALTER TABLE public.profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.profiles ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX profiles_auth_user_id_unique ON public.profiles(auth_user_id)
  WHERE auth_user_id IS NOT NULL;
CREATE INDEX profiles_id_idx ON public.profiles(id);
CREATE INDEX profiles_contact_email_idx ON public.profiles(contact_email);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_person_profile_id_fkey;
DROP INDEX IF EXISTS public.profiles_person_profile_id_unique;
DROP INDEX IF EXISTS public.idx_profiles_id;
ALTER TABLE public.profiles DROP COLUMN person_profile_id;

-- Teacher-account identity now comes from profiles.auth_user_id. Teacher rows
-- retain only the teaching entity ID and one canonical profile reference.
DROP TRIGGER IF EXISTS normalize_teacher_person_profile ON public.teachers;
DROP FUNCTION IF EXISTS public.normalize_teacher_person_profile();
ALTER TABLE public.teachers RENAME TO teacher_records;
DO $$
DECLARE policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policy.polname FROM pg_policy policy WHERE policy.polrelid = 'public.teacher_records'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_records', policy_name);
  END LOOP;
END;
$$;
ALTER TABLE public.teacher_records RENAME COLUMN person_profile_id TO profile_id;
ALTER TABLE public.teacher_records DROP CONSTRAINT IF EXISTS teachers_person_profile_id_fkey;
ALTER TABLE public.teacher_records DROP CONSTRAINT IF EXISTS teacher_records_person_profile_id_fkey;
DROP INDEX IF EXISTS public.teachers_person_profile_id_unique;
DROP INDEX IF EXISTS public.teachers_user_id_unique;
ALTER TABLE public.teacher_records DROP CONSTRAINT IF EXISTS teachers_user_id_key;
ALTER TABLE public.teacher_records DROP CONSTRAINT IF EXISTS teacher_records_user_id_key;
ALTER TABLE public.teacher_records DROP CONSTRAINT IF EXISTS teachers_user_id_fkey;
ALTER TABLE public.teacher_records ADD CONSTRAINT teacher_records_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX teacher_records_profile_id_unique ON public.teacher_records(profile_id);
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS person_profile_id;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS name;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS email;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS phone;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS gov_id;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS address;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS birthday;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS bio;
ALTER TABLE public.teacher_records DROP COLUMN IF EXISTS bio_document;

-- The public account directory is a narrow, permission-filtered projection;
-- it never exposes teacher contact or sensitive profile fields.
CREATE OR REPLACE VIEW public.user_accounts WITH (security_barrier = true) AS
SELECT profile.auth_user_id AS id, profile.email, profile.display_name,
       profile.avatar_url, profile.account_status, profile.disabled_at,
       profile.disabled_by, profile.disabled_reason, profile.created_at,
       profile.updated_at
FROM public.profiles profile
WHERE profile.auth_user_id IS NOT NULL
  AND (auth.role() = 'service_role'
    OR profile.auth_user_id = auth.uid()
    OR public.has_api_permission(auth.uid(), 'system.users.list', NULL::uuid, NULL::uuid)
    OR public.has_api_permission(auth.uid(), 'system.users.read', NULL::uuid, NULL::uuid));
REVOKE ALL ON public.user_accounts FROM PUBLIC, anon;
GRANT SELECT ON public.user_accounts TO authenticated;

-- Person data is accessed only by the server after API/RBAC authorization.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
REVOKE ALL ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS trigger
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(auth_user_id, email, display_name)
  VALUES (NEW.id, NEW.email, CASE
    WHEN lower(btrim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''))) = lower(btrim(COALESCE(NEW.email, ''))) THEN NULL
    ELSE NULLIF(btrim(NEW.raw_user_meta_data->>'display_name'), '') END)
  ON CONFLICT (auth_user_id) WHERE auth_user_id IS NOT NULL DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(
      CASE WHEN lower(btrim(COALESCE(public.profiles.display_name, ''))) = lower(btrim(COALESCE(public.profiles.email, ''))) THEN NULL
           ELSE NULLIF(btrim(public.profiles.display_name), '') END,
      EXCLUDED.display_name
    ),
    updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.bump_person_profile_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['profile_version','updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['profile_version','updated_at']) THEN
    NEW.profile_version := OLD.profile_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_bump_person_version ON public.profiles;
CREATE TRIGGER profiles_bump_person_version BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_person_profile_version();

CREATE OR REPLACE FUNCTION public.clear_deleted_account_profile_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.auth_user_id IS NOT NULL AND NEW.auth_user_id IS NULL THEN
    NEW.email := NULL;
    NEW.avatar_url := NULL;
    NEW.account_status := 'active';
    NEW.disabled_at := NULL;
    NEW.disabled_by := NULL;
    NEW.disabled_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_clear_deleted_account_fields ON public.profiles;
CREATE TRIGGER profiles_clear_deleted_account_fields
BEFORE UPDATE OF auth_user_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.clear_deleted_account_profile_fields();

CREATE OR REPLACE FUNCTION public.is_current_teacher_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles profile
                 WHERE profile.id = p_profile_id AND profile.auth_user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.can_access_teacher(
  p_teacher_id uuid, p_permission_key text DEFAULT 'teaching.teachers.read'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teacher_records teacher
    JOIN public.profiles profile ON profile.id = teacher.profile_id
    WHERE teacher.id = p_teacher_id AND (
      profile.auth_user_id = auth.uid()
      OR public.has_teaching_permission(auth.uid(), p_permission_key,
        (SELECT id FROM public.teachings WHERE is_global LIMIT 1), NULL, NULL)
      OR EXISTS (
        SELECT 1 FROM public.class_session_teachers assignment
        JOIN public.class_sessions session ON session.id = assignment.class_session_id
        WHERE assignment.teacher_id = teacher.id
          AND public.has_teaching_permission(auth.uid(), p_permission_key,
            session.teaching_id, session.classroom_id, session.id)
      )
    )
  );
$$;

-- Keep the compatibility view narrow and permission-filtered. The server's
-- authorized detail route reads sensitive profile fields through the RPC below.
CREATE OR REPLACE VIEW public.teachers WITH (security_barrier = true) AS
SELECT teacher.id, teacher.profile_id, profile.auth_user_id AS user_id,
       profile.display_name AS name, profile.bio, profile.bio_document,
       teacher.created_at, teacher.updated_at
FROM public.teacher_records teacher
JOIN public.profiles profile ON profile.id = teacher.profile_id
WHERE auth.role() = 'service_role'
   OR public.can_access_teacher(teacher.id, 'teaching.teachers.read');
REVOKE ALL ON public.teachers FROM PUBLIC, anon;
GRANT SELECT ON public.teachers TO authenticated;

-- Platform credentials are more sensitive than the teacher directory and are
-- protected by the existing sensitive teacher permissions.
DO $$
DECLARE policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policy.polname FROM pg_policy policy WHERE policy.polrelid = 'public.teacher_credentials'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_credentials', policy_name);
  END LOOP;
END;
$$;
CREATE POLICY teacher_credentials_permission_read ON public.teacher_credentials
  FOR SELECT TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.read_sensitive'));
CREATE POLICY teacher_credentials_permission_create ON public.teacher_credentials
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));
CREATE POLICY teacher_credentials_permission_update ON public.teacher_credentials
  FOR UPDATE TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'))
  WITH CHECK (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));
CREATE POLICY teacher_credentials_permission_delete ON public.teacher_credentials
  FOR DELETE TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));

CREATE OR REPLACE FUNCTION public.get_teacher_sensitive_details(p_teacher_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE teacher_row jsonb; credentials jsonb;
BEGIN
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.read_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'id', teacher.id, 'profile_id', profile.id, 'user_id', profile.auth_user_id,
    'name', profile.display_name, 'email', profile.contact_email, 'phone', profile.phone,
    'address', profile.address, 'mailing_address', profile.mailing_address,
    'birthday', profile.birthday, 'gov_id', profile.government_id,
    'bio', profile.bio, 'bio_document', profile.bio_document,
    'created_at', teacher.created_at, 'updated_at', GREATEST(teacher.updated_at, profile.updated_at)
  ) INTO teacher_row
  FROM public.teacher_records teacher JOIN public.profiles profile ON profile.id = teacher.profile_id
  WHERE teacher.id = p_teacher_id;
  IF teacher_row IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(credential) - 'user_id' ORDER BY credential.created_at), '[]'::jsonb)
  INTO credentials FROM public.teacher_credentials credential WHERE credential.teacher_id = p_teacher_id;
  RETURN jsonb_build_object('teacher', teacher_row, 'credentials', credentials);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_teacher_profile(p_teacher_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE profile_id uuid; updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) key
                WHERE key NOT IN ('name','bio','bio_document')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TEACHER_PROFILE_PATCH';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.update') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEACHER_PERMISSION_REQUIRED';
  END IF;
  SELECT teacher.profile_id INTO profile_id FROM public.teacher_records teacher WHERE teacher.id = p_teacher_id;
  IF profile_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.profiles profile
  SET display_name = CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'), '') ELSE profile.display_name END,
      bio = CASE WHEN p_patch ? 'bio' THEN p_patch->>'bio' ELSE profile.bio END,
      bio_document = CASE WHEN p_patch ? 'bio_document' THEN p_patch->'bio_document' ELSE profile.bio_document END,
      updated_at = timezone('utc'::text, now())
  WHERE profile.id = profile_id;
  SELECT jsonb_build_object('id', teacher.id, 'profile_id', profile.id,
    'user_id', profile.auth_user_id, 'name', profile.display_name, 'bio', profile.bio,
    'bio_document', profile.bio_document, 'created_at', teacher.created_at,
    'updated_at', GREATEST(teacher.updated_at, profile.updated_at))
  INTO updated_row FROM public.teacher_records teacher
  JOIN public.profiles profile ON profile.id = teacher.profile_id WHERE teacher.id = p_teacher_id;
  RETURN updated_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_teacher_sensitive(p_teacher_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE profile_id uuid; updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) key
                WHERE key NOT IN ('email','phone','address','mailing_address','birthday','gov_id')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SENSITIVE_PATCH';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.update_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;
  SELECT teacher.profile_id INTO profile_id FROM public.teacher_records teacher WHERE teacher.id = p_teacher_id;
  IF profile_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.profiles profile SET
    contact_email = CASE WHEN p_patch ? 'email' THEN NULLIF(btrim(p_patch->>'email'), '') ELSE profile.contact_email END,
    phone = CASE WHEN p_patch ? 'phone' THEN NULLIF(btrim(p_patch->>'phone'), '') ELSE profile.phone END,
    address = CASE WHEN p_patch ? 'address' THEN NULLIF(btrim(p_patch->>'address'), '') ELSE profile.address END,
    mailing_address = CASE WHEN p_patch ? 'mailing_address' THEN NULLIF(btrim(p_patch->>'mailing_address'), '') ELSE profile.mailing_address END,
    birthday = CASE WHEN p_patch ? 'birthday' THEN NULLIF(p_patch->>'birthday', '')::date ELSE profile.birthday END,
    government_id = CASE WHEN p_patch ? 'gov_id' THEN NULLIF(btrim(p_patch->>'gov_id'), '') ELSE profile.government_id END,
    updated_at = timezone('utc'::text, now())
  WHERE profile.id = profile_id;
  SELECT jsonb_build_object('id', teacher.id, 'profile_id', profile.id,
    'user_id', profile.auth_user_id, 'name', profile.display_name, 'email', profile.contact_email,
    'phone', profile.phone, 'address', profile.address, 'mailing_address', profile.mailing_address,
    'birthday', profile.birthday, 'gov_id', profile.government_id, 'bio', profile.bio,
    'bio_document', profile.bio_document, 'created_at', teacher.created_at,
    'updated_at', GREATEST(teacher.updated_at, profile.updated_at))
  INTO updated_row FROM public.teacher_records teacher
  JOIN public.profiles profile ON profile.id = teacher.profile_id WHERE teacher.id = p_teacher_id;
  RETURN updated_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_teacher_with_profile(p_account_user_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_profile_id uuid; teacher_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) key
                WHERE key NOT IN ('name','email','phone','address','mailing_address','birthday','bio','bio_document','gov_id')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TEACHER_PROFILE_PATCH';
  END IF;
  IF p_account_user_id IS NOT NULL THEN
    SELECT id INTO v_profile_id FROM public.profiles WHERE auth_user_id = p_account_user_id FOR UPDATE;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_PROFILE_NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM public.teacher_records teacher WHERE teacher.profile_id = v_profile_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TEACHER_ACCOUNT_ALREADY_LINKED';
    END IF;
    UPDATE public.profiles SET
      display_name = COALESCE(
        CASE WHEN lower(btrim(COALESCE(display_name, ''))) = lower(btrim(COALESCE(email, ''))) THEN NULL
             ELSE NULLIF(btrim(display_name), '') END,
        NULLIF(btrim(p_patch->>'name'), '')
      ),
      contact_email = COALESCE(NULLIF(btrim(contact_email), ''), NULLIF(btrim(p_patch->>'email'), '')),
      phone = COALESCE(NULLIF(btrim(phone), ''), NULLIF(btrim(p_patch->>'phone'), '')),
      government_id = COALESCE(NULLIF(btrim(government_id), ''), NULLIF(btrim(p_patch->>'gov_id'), '')),
      address = COALESCE(NULLIF(btrim(address), ''), NULLIF(btrim(p_patch->>'address'), '')),
      mailing_address = COALESCE(NULLIF(btrim(mailing_address), ''), NULLIF(btrim(p_patch->>'mailing_address'), '')),
      birthday = COALESCE(birthday, NULLIF(p_patch->>'birthday', '')::date),
      bio = COALESCE(NULLIF(btrim(bio), ''), NULLIF(btrim(p_patch->>'bio'), '')),
      bio_document = COALESCE(bio_document, p_patch->'bio_document')
    WHERE id = v_profile_id;
  ELSE
    INSERT INTO public.profiles(display_name, contact_email, phone, government_id,
      address, mailing_address, birthday, bio, bio_document)
    VALUES (NULLIF(btrim(p_patch->>'name'), ''), NULLIF(btrim(p_patch->>'email'), ''),
      NULLIF(btrim(p_patch->>'phone'), ''), NULLIF(btrim(p_patch->>'gov_id'), ''),
      NULLIF(btrim(p_patch->>'address'), ''), NULLIF(btrim(p_patch->>'mailing_address'), ''),
      NULLIF(p_patch->>'birthday', '')::date, NULLIF(btrim(p_patch->>'bio'), ''), p_patch->'bio_document')
    RETURNING id INTO v_profile_id;
  END IF;
  INSERT INTO public.teacher_records(profile_id) VALUES (v_profile_id) RETURNING id INTO teacher_id;
  RETURN jsonb_build_object('id', teacher_id, 'profile_id', v_profile_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.change_teacher_account_link(
  p_teacher_id uuid, p_target_auth_user_id uuid, p_expected_profile_id uuid,
  p_expected_profile_version bigint, p_expected_target_profile_id uuid,
  p_expected_target_version bigint, p_field_ownership jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE source_profile public.profiles%ROWTYPE; target_profile public.profiles%ROWTYPE;
  next_profile_id uuid; field_name text; ownership text; field_names text[] := ARRAY[
    'display_name','contact_email','phone','government_id','address','mailing_address','birthday','bio','bio_document'
  ];
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF jsonb_typeof(p_field_ownership) <> 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_field_ownership) key)
        IS DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM unnest(field_names) key) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROFILE_FIELD_CHOICES_REQUIRED';
  END IF;
  SELECT profile.* INTO source_profile
  FROM public.teacher_records teacher JOIN public.profiles profile ON profile.id = teacher.profile_id
  WHERE teacher.id = p_teacher_id FOR UPDATE OF teacher, profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'TEACHER_NOT_FOUND'; END IF;
  IF source_profile.id <> p_expected_profile_id OR source_profile.profile_version <> p_expected_profile_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PROFILE_LINK_STALE';
  END IF;
  IF p_target_auth_user_id IS NOT NULL THEN
    SELECT * INTO target_profile FROM public.profiles WHERE auth_user_id = p_target_auth_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_PROFILE_NOT_FOUND'; END IF;
    IF target_profile.id = source_profile.id THEN RAISE EXCEPTION 'ACCOUNT_LINK_UNCHANGED'; END IF;
    IF target_profile.id <> p_expected_target_profile_id
       OR target_profile.profile_version <> p_expected_target_version THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TARGET_PROFILE_STALE';
    END IF;
    IF EXISTS (SELECT 1 FROM public.teacher_records teacher WHERE teacher.profile_id = target_profile.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TARGET_ACCOUNT_ALREADY_LINKED_TO_TEACHER';
    END IF;
  ELSIF source_profile.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_LINK_UNCHANGED';
  END IF;

  FOREACH field_name IN ARRAY field_names LOOP
    ownership := p_field_ownership->>field_name;
    IF p_target_auth_user_id IS NULL THEN
      IF ownership NOT IN ('account','teacher') THEN RAISE EXCEPTION 'INVALID_PROFILE_FIELD_OWNER'; END IF;
    ELSE
      IF ownership NOT IN ('account','teacher','target') THEN RAISE EXCEPTION 'INVALID_PROFILE_FIELD_OWNER'; END IF;
      IF source_profile.auth_user_id IS NULL AND ownership = 'account' THEN RAISE EXCEPTION 'INVALID_PROFILE_FIELD_OWNER'; END IF;
    END IF;
  END LOOP;

  IF p_target_auth_user_id IS NULL THEN
    INSERT INTO public.profiles(display_name, contact_email, phone, government_id, address,
      mailing_address, birthday, bio, bio_document)
    SELECT CASE WHEN p_field_ownership->>'display_name' = 'teacher' THEN source_profile.display_name END,
      CASE WHEN p_field_ownership->>'contact_email' = 'teacher' THEN source_profile.contact_email END,
      CASE WHEN p_field_ownership->>'phone' = 'teacher' THEN source_profile.phone END,
      CASE WHEN p_field_ownership->>'government_id' = 'teacher' THEN source_profile.government_id END,
      CASE WHEN p_field_ownership->>'address' = 'teacher' THEN source_profile.address END,
      CASE WHEN p_field_ownership->>'mailing_address' = 'teacher' THEN source_profile.mailing_address END,
      CASE WHEN p_field_ownership->>'birthday' = 'teacher' THEN source_profile.birthday END,
      CASE WHEN p_field_ownership->>'bio' = 'teacher' THEN source_profile.bio END,
      CASE WHEN p_field_ownership->>'bio_document' = 'teacher' THEN source_profile.bio_document END
    RETURNING id INTO next_profile_id;
  ELSE
    next_profile_id := target_profile.id;
    UPDATE public.profiles target SET
      display_name = CASE p_field_ownership->>'display_name' WHEN 'teacher' THEN source_profile.display_name WHEN 'target' THEN target.display_name ELSE target.display_name END,
      contact_email = CASE p_field_ownership->>'contact_email' WHEN 'teacher' THEN source_profile.contact_email WHEN 'target' THEN target.contact_email ELSE target.contact_email END,
      phone = CASE p_field_ownership->>'phone' WHEN 'teacher' THEN source_profile.phone WHEN 'target' THEN target.phone ELSE target.phone END,
      government_id = CASE p_field_ownership->>'government_id' WHEN 'teacher' THEN source_profile.government_id WHEN 'target' THEN target.government_id ELSE target.government_id END,
      address = CASE p_field_ownership->>'address' WHEN 'teacher' THEN source_profile.address WHEN 'target' THEN target.address ELSE target.address END,
      mailing_address = CASE p_field_ownership->>'mailing_address' WHEN 'teacher' THEN source_profile.mailing_address WHEN 'target' THEN target.mailing_address ELSE target.mailing_address END,
      birthday = CASE p_field_ownership->>'birthday' WHEN 'teacher' THEN source_profile.birthday WHEN 'target' THEN target.birthday ELSE target.birthday END,
      bio = CASE p_field_ownership->>'bio' WHEN 'teacher' THEN source_profile.bio WHEN 'target' THEN target.bio ELSE target.bio END,
      bio_document = CASE p_field_ownership->>'bio_document' WHEN 'teacher' THEN source_profile.bio_document WHEN 'target' THEN target.bio_document ELSE target.bio_document END,
      updated_at = timezone('utc'::text, now()) WHERE target.id = target_profile.id;
  END IF;

  UPDATE public.profiles source SET
    display_name = CASE WHEN p_field_ownership->>'display_name' = 'teacher' OR p_field_ownership->>'display_name' = 'target' THEN NULL ELSE source.display_name END,
    contact_email = CASE WHEN p_field_ownership->>'contact_email' = 'teacher' OR p_field_ownership->>'contact_email' = 'target' THEN NULL ELSE source.contact_email END,
    phone = CASE WHEN p_field_ownership->>'phone' = 'teacher' OR p_field_ownership->>'phone' = 'target' THEN NULL ELSE source.phone END,
    government_id = CASE WHEN p_field_ownership->>'government_id' = 'teacher' OR p_field_ownership->>'government_id' = 'target' THEN NULL ELSE source.government_id END,
    address = CASE WHEN p_field_ownership->>'address' = 'teacher' OR p_field_ownership->>'address' = 'target' THEN NULL ELSE source.address END,
    mailing_address = CASE WHEN p_field_ownership->>'mailing_address' = 'teacher' OR p_field_ownership->>'mailing_address' = 'target' THEN NULL ELSE source.mailing_address END,
    birthday = CASE WHEN p_field_ownership->>'birthday' = 'teacher' OR p_field_ownership->>'birthday' = 'target' THEN NULL ELSE source.birthday END,
    bio = CASE WHEN p_field_ownership->>'bio' = 'teacher' OR p_field_ownership->>'bio' = 'target' THEN NULL ELSE source.bio END,
    bio_document = CASE WHEN p_field_ownership->>'bio_document' = 'teacher' OR p_field_ownership->>'bio_document' = 'target' THEN NULL ELSE source.bio_document END,
    updated_at = timezone('utc'::text, now()) WHERE source.id = source_profile.id;

  UPDATE public.teacher_records SET profile_id = next_profile_id WHERE id = p_teacher_id;
  RETURN jsonb_build_object('teacher_id', p_teacher_id, 'profile_id', next_profile_id,
    'auth_user_id', p_target_auth_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_system_user_status(
  p_user_id uuid, p_status text, p_reason text, p_expected_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_previous text; v_owner_count bigint; v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM pg_advisory_xact_lock(10083, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_system_permission(auth.uid(), 'system.users.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SYSTEM_USERS_MANAGE_REQUIRED';
  END IF;
  IF p_status NOT IN ('active','disabled') THEN RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS'; END IF;
  IF p_status = 'disabled' AND (v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500) THEN
    RAISE EXCEPTION 'DISABLE_REASON_REQUIRED';
  END IF;
  SELECT account_status INTO v_previous FROM public.profiles WHERE auth_user_id = p_user_id FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_status = 'disabled' AND public.rbac_is_system_owner(p_user_id) THEN
    SELECT count(DISTINCT assignment.user_id) INTO v_owner_count
    FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id
    JOIN public.profiles profile ON profile.auth_user_id = assignment.user_id AND profile.account_status = 'active'
    WHERE role.domain = 'system' AND role.code = 'system_owner' AND assignment.scope_type = 'system'
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE);
    IF v_owner_count <= 1 THEN RAISE EXCEPTION 'LAST_SYSTEM_OWNER'; END IF;
  END IF;
  UPDATE public.profiles SET account_status = p_status,
    disabled_at = CASE WHEN p_status = 'disabled' THEN timezone('utc'::text, now()) ELSE NULL END,
    disabled_by = CASE WHEN p_status = 'disabled' THEN auth.uid() ELSE NULL END,
    disabled_reason = CASE WHEN p_status = 'disabled' THEN v_reason ELSE NULL END
  WHERE auth_user_id = p_user_id;
  IF v_previous IS DISTINCT FROM p_status THEN
    INSERT INTO public.user_status_events(target_user_id, actor_user_id, previous_status, new_status, reason)
    VALUES (p_user_id, auth.uid(), v_previous, p_status, v_reason);
  END IF;
  RETURN jsonb_build_object('id', p_user_id, 'account_status', p_status,
    'disabled_at', CASE WHEN p_status = 'disabled' THEN timezone('utc'::text, now()) ELSE NULL END);
END;
$$;

-- Relink and split APIs are service-role-only. The caller enforces teaching
-- permissions and records the operation in the existing audit event pipeline.
REVOKE ALL ON FUNCTION public.create_teacher_with_profile(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_teacher_with_profile(uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.change_teacher_account_link(uuid,uuid,uuid,bigint,uuid,bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_teacher_account_link(uuid,uuid,uuid,bigint,uuid,bigint,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.update_teacher_profile(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_teacher_profile(uuid,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_teacher_sensitive(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_teacher_sensitive(uuid,jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_teacher_sensitive_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_sensitive_details(uuid) TO authenticated, service_role;

DROP TABLE public.person_profiles;
NOTIFY pgrst, 'reload schema';
