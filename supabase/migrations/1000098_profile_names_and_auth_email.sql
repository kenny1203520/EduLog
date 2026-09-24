-- Separate a person's formal name and nickname, and keep sign-in email in
-- Supabase Auth rather than duplicating it in the person profile.
DROP VIEW IF EXISTS public.user_accounts;

ALTER TABLE public.profiles RENAME COLUMN display_name TO full_name;
ALTER TABLE public.profiles ADD COLUMN nickname text;
ALTER TABLE public.profiles DROP COLUMN email;

ALTER INDEX IF EXISTS public.idx_profiles_display_name RENAME TO profiles_full_name_idx;
CREATE INDEX IF NOT EXISTS profiles_nickname_idx ON public.profiles(nickname);

CREATE OR REPLACE VIEW public.user_accounts WITH (security_barrier = true) AS
SELECT profile.auth_user_id AS id,
       account.email,
       COALESCE(NULLIF(btrim(profile.nickname), ''), profile.full_name) AS display_name,
       profile.full_name,
       profile.nickname,
       profile.avatar_url,
       profile.account_status,
       profile.disabled_at,
       profile.disabled_by,
       profile.disabled_reason,
       profile.created_at,
       profile.updated_at
FROM public.profiles profile
JOIN auth.users account ON account.id = profile.auth_user_id
WHERE profile.auth_user_id IS NOT NULL
  AND (auth.role() = 'service_role'
    OR profile.auth_user_id = auth.uid()
    OR public.has_api_permission(auth.uid(), 'system.users.list', NULL::uuid, NULL::uuid)
    OR public.has_api_permission(auth.uid(), 'system.users.read', NULL::uuid, NULL::uuid));
REVOKE ALL ON public.user_accounts FROM PUBLIC, anon;
GRANT SELECT ON public.user_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS trigger
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(auth_user_id)
  VALUES (NEW.id)
  ON CONFLICT (auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.clear_deleted_account_profile_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.auth_user_id IS NOT NULL AND NEW.auth_user_id IS NULL THEN
    NEW.avatar_url := NULL;
    NEW.account_status := 'active';
    NEW.disabled_at := NULL;
    NEW.disabled_by := NULL;
    NEW.disabled_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_teacher_sensitive_details(p_teacher_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE teacher_row jsonb; credentials jsonb;
BEGIN
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.read_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'id', teacher.id, 'profile_id', profile.id, 'user_id', profile.auth_user_id,
    'name', profile.full_name, 'email', profile.contact_email, 'phone', profile.phone,
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
    'user_id', profile.auth_user_id, 'name', profile.full_name, 'email', profile.contact_email,
    'phone', profile.phone, 'address', profile.address, 'mailing_address', profile.mailing_address,
    'birthday', profile.birthday, 'gov_id', profile.government_id, 'bio', profile.bio,
    'bio_document', profile.bio_document, 'created_at', teacher.created_at,
    'updated_at', GREATEST(teacher.updated_at, profile.updated_at))
  INTO updated_row FROM public.teacher_records teacher
  JOIN public.profiles profile ON profile.id = teacher.profile_id WHERE teacher.id = p_teacher_id;
  RETURN updated_row;
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
  SET full_name = CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'), '') ELSE profile.full_name END,
      bio = CASE WHEN p_patch ? 'bio' THEN p_patch->>'bio' ELSE profile.bio END,
      bio_document = CASE WHEN p_patch ? 'bio_document' THEN p_patch->'bio_document' ELSE profile.bio_document END,
      updated_at = timezone('utc'::text, now())
  WHERE profile.id = profile_id;
  SELECT jsonb_build_object('id', teacher.id, 'profile_id', profile.id,
    'user_id', profile.auth_user_id, 'name', profile.full_name, 'bio', profile.bio,
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
      full_name = COALESCE(NULLIF(btrim(full_name), ''), NULLIF(btrim(p_patch->>'name'), '')),
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
    INSERT INTO public.profiles(full_name, contact_email, phone, government_id,
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
    'full_name','nickname','contact_email','phone','government_id','address','mailing_address','birthday','bio','bio_document'
  ];
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED'; END IF;
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
    IF target_profile.id <> p_expected_target_profile_id OR target_profile.profile_version <> p_expected_target_version THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'TARGET_PROFILE_STALE';
    END IF;
    IF EXISTS (SELECT 1 FROM public.teacher_records teacher WHERE teacher.profile_id = target_profile.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'TARGET_ACCOUNT_ALREADY_LINKED_TO_TEACHER';
    END IF;
  ELSIF source_profile.auth_user_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_LINK_UNCHANGED';
  END IF;
  FOREACH field_name IN ARRAY field_names LOOP
    ownership := p_field_ownership->>field_name;
    IF (p_target_auth_user_id IS NULL AND ownership NOT IN ('account','teacher'))
       OR (p_target_auth_user_id IS NOT NULL AND ownership NOT IN ('account','teacher','target'))
       OR (p_target_auth_user_id IS NOT NULL AND source_profile.auth_user_id IS NULL AND ownership = 'account') THEN
      RAISE EXCEPTION 'INVALID_PROFILE_FIELD_OWNER';
    END IF;
  END LOOP;
  IF p_target_auth_user_id IS NULL THEN
    INSERT INTO public.profiles(full_name, nickname, contact_email, phone, government_id, address,
      mailing_address, birthday, bio, bio_document)
    SELECT CASE WHEN p_field_ownership->>'full_name' = 'teacher' THEN source_profile.full_name END,
      CASE WHEN p_field_ownership->>'nickname' = 'teacher' THEN source_profile.nickname END,
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
      full_name = CASE p_field_ownership->>'full_name' WHEN 'teacher' THEN source_profile.full_name WHEN 'target' THEN target_profile.full_name ELSE target.full_name END,
      nickname = CASE p_field_ownership->>'nickname' WHEN 'teacher' THEN source_profile.nickname WHEN 'target' THEN target_profile.nickname ELSE target.nickname END,
      contact_email = CASE p_field_ownership->>'contact_email' WHEN 'teacher' THEN source_profile.contact_email WHEN 'target' THEN target_profile.contact_email ELSE target.contact_email END,
      phone = CASE p_field_ownership->>'phone' WHEN 'teacher' THEN source_profile.phone WHEN 'target' THEN target_profile.phone ELSE target.phone END,
      government_id = CASE p_field_ownership->>'government_id' WHEN 'teacher' THEN source_profile.government_id WHEN 'target' THEN target_profile.government_id ELSE target.government_id END,
      address = CASE p_field_ownership->>'address' WHEN 'teacher' THEN source_profile.address WHEN 'target' THEN target_profile.address ELSE target.address END,
      mailing_address = CASE p_field_ownership->>'mailing_address' WHEN 'teacher' THEN source_profile.mailing_address WHEN 'target' THEN target_profile.mailing_address ELSE target.mailing_address END,
      birthday = CASE p_field_ownership->>'birthday' WHEN 'teacher' THEN source_profile.birthday WHEN 'target' THEN target_profile.birthday ELSE target.birthday END,
      bio = CASE p_field_ownership->>'bio' WHEN 'teacher' THEN source_profile.bio WHEN 'target' THEN target_profile.bio ELSE target.bio END,
      bio_document = CASE p_field_ownership->>'bio_document' WHEN 'teacher' THEN source_profile.bio_document WHEN 'target' THEN target_profile.bio_document ELSE target.bio_document END,
      updated_at = timezone('utc'::text, now()) WHERE target.id = target_profile.id;
  END IF;
  UPDATE public.profiles source SET
    full_name = CASE WHEN p_field_ownership->>'full_name' IN ('teacher','target') THEN NULL ELSE source.full_name END,
    nickname = CASE WHEN p_field_ownership->>'nickname' IN ('teacher','target') THEN NULL ELSE source.nickname END,
    contact_email = CASE WHEN p_field_ownership->>'contact_email' IN ('teacher','target') THEN NULL ELSE source.contact_email END,
    phone = CASE WHEN p_field_ownership->>'phone' IN ('teacher','target') THEN NULL ELSE source.phone END,
    government_id = CASE WHEN p_field_ownership->>'government_id' IN ('teacher','target') THEN NULL ELSE source.government_id END,
    address = CASE WHEN p_field_ownership->>'address' IN ('teacher','target') THEN NULL ELSE source.address END,
    mailing_address = CASE WHEN p_field_ownership->>'mailing_address' IN ('teacher','target') THEN NULL ELSE source.mailing_address END,
    birthday = CASE WHEN p_field_ownership->>'birthday' IN ('teacher','target') THEN NULL ELSE source.birthday END,
    bio = CASE WHEN p_field_ownership->>'bio' IN ('teacher','target') THEN NULL ELSE source.bio END,
    bio_document = CASE WHEN p_field_ownership->>'bio_document' IN ('teacher','target') THEN NULL ELSE source.bio_document END,
    updated_at = timezone('utc'::text, now()) WHERE source.id = source_profile.id;
  UPDATE public.teacher_records SET profile_id = next_profile_id WHERE id = p_teacher_id;
  RETURN jsonb_build_object('teacher_id', p_teacher_id, 'profile_id', next_profile_id,
    'auth_user_id', p_target_auth_user_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
