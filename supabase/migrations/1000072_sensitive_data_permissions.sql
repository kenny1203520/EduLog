-- Forward-only sensitive data boundary.
-- General teaching read/list permissions must not expose personal data or
-- credentials. The safe projections remain available through the normal
-- user-JWT client; sensitive fields are available only through the guarded
-- SECURITY DEFINER functions below.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.teaching_members') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.teachers') IS NULL
     OR to_regclass('public.student_contacts') IS NULL
     OR to_regclass('public.student_schools') IS NULL
     OR to_regclass('public.student_credentials') IS NULL
     OR to_regclass('public.teacher_credentials') IS NULL
     OR to_regprocedure('public.can_access_student(uuid,text)') IS NULL
     OR to_regprocedure('public.can_access_teaching(uuid,text)') IS NULL
     OR to_regprocedure('public.has_teaching_permission(uuid,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '1000072 prerequisites missing; apply migrations through 1000071 first';
  END IF;
END;
$$;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.students.read_sensitive', 'Read sensitive student data', 'Read student personal data, contacts, schools, and credentials', 'teaching', 'students', 'read_sensitive'),
  ('teaching.students.update_sensitive', 'Update sensitive student data', 'Update student personal data, contacts, schools, and credentials', 'teaching', 'students', 'update_sensitive'),
  ('teaching.teachers.read_sensitive', 'Read sensitive teacher data', 'Read teacher personal data and credentials', 'teaching', 'teachers', 'read_sensitive'),
  ('teaching.teachers.update_sensitive', 'Update sensitive teacher data', 'Update teacher personal data and credentials', 'teaching', 'teachers', 'update_sensitive')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- Owners receive the new capability through their teaching membership. No
-- other role is granted implicitly; administrators may add an explicit
-- policy through the canonical RBAC management path.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
JOIN public.permissions permission
  ON permission.key IN (
    'teaching.students.read_sensitive',
    'teaching.students.update_sensitive',
    'teaching.teachers.read_sensitive',
    'teaching.teachers.update_sensitive'
  )
WHERE owner_role.code = 'teaching_owner'
ON CONFLICT DO NOTHING;

-- Sensitive access must not inherit the ordinary "the subject owns the row"
-- shortcut in can_access_student(). Resolve a teaching scope from an
-- enrollment and require the explicit sensitive permission there.
CREATE OR REPLACE FUNCTION public.can_access_sensitive_student(
  p_student_id uuid,
  p_permission_key text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students student
    JOIN public.enrollments enrollment ON enrollment.student_id = student.id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    WHERE student.id = p_student_id
      AND public.can_access_teaching(
        COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
        p_permission_key
      )
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
      AND EXISTS (
        SELECT 1
        FROM public.class_session_teachers assignment
        JOIN public.class_sessions session ON session.id = assignment.class_session_id
        WHERE assignment.teacher_id = teacher.id
          AND public.has_teaching_permission(
            (select auth.uid()),
            COALESCE(p_permission_key, 'teaching.teachers.read'),
            session.teaching_id,
            session.classroom_id,
            session.id
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_student_sensitive_details(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  student_row jsonb;
  contacts jsonb;
  schools jsonb;
BEGIN
  IF NOT public.can_access_sensitive_student(p_student_id, 'teaching.students.read_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  SELECT to_jsonb(student) - 'user_id' - 'created_at' - 'updated_at'
  INTO student_row
  FROM public.students student
  WHERE student.id = p_student_id;
  IF student_row IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(contact) - 'user_id' ORDER BY contact.created_at), '[]'::jsonb)
  INTO contacts
  FROM public.student_contacts contact
  WHERE contact.student_id = p_student_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(school) - 'user_id' ORDER BY school.created_at), '[]'::jsonb)
  INTO schools
  FROM public.student_schools school
  WHERE school.student_id = p_student_id;

  RETURN jsonb_build_object('student', student_row, 'contacts', contacts, 'schools', schools);
END;
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

  SELECT to_jsonb(teacher) - 'created_at' - 'updated_at'
  INTO teacher_row
  FROM public.teachers teacher
  WHERE teacher.id = p_teacher_id;
  IF teacher_row IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(credential) - 'user_id' ORDER BY credential.created_at), '[]'::jsonb)
  INTO credentials
  FROM public.teacher_credentials credential
  WHERE credential.teacher_id = p_teacher_id;

  RETURN jsonb_build_object('teacher', teacher_row, 'credentials', credentials);
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
  IF NOT public.can_access_sensitive_student(p_student_id, 'teaching.students.update_sensitive') THEN
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

CREATE OR REPLACE FUNCTION public.update_teacher_sensitive(p_teacher_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated_row jsonb;
BEGIN
  IF jsonb_typeof(p_patch) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_patch) key
       WHERE key NOT IN ('email', 'phone', 'address', 'birthday', 'gov_id')
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SENSITIVE_PATCH';
  END IF;
  IF NOT public.can_access_teacher(p_teacher_id, 'teaching.teachers.update_sensitive') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SENSITIVE_PERMISSION_REQUIRED';
  END IF;

  UPDATE public.teachers teacher
  SET email = CASE WHEN p_patch ? 'email' THEN p_patch->>'email' ELSE teacher.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN p_patch->>'phone' ELSE teacher.phone END,
      address = CASE WHEN p_patch ? 'address' THEN p_patch->>'address' ELSE teacher.address END,
      birthday = CASE WHEN p_patch ? 'birthday' THEN NULLIF(p_patch->>'birthday', '')::date ELSE teacher.birthday END,
      gov_id = CASE WHEN p_patch ? 'gov_id' THEN p_patch->>'gov_id' ELSE teacher.gov_id END
  WHERE teacher.id = p_teacher_id
  RETURNING to_jsonb(teacher) INTO updated_row;
  RETURN updated_row;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_sensitive_student(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_teacher(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_sensitive_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_teacher_sensitive_details(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_student_sensitive(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_teacher_sensitive(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_sensitive_student(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_teacher(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_student_sensitive_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_teacher_sensitive_details(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_student_sensitive(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_teacher_sensitive(uuid, jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS "Canonical student contacts read" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts create" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts update" ON public.student_contacts;
DROP POLICY IF EXISTS "Canonical student contacts delete" ON public.student_contacts;
CREATE POLICY "Canonical student contacts read" ON public.student_contacts FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.read_sensitive'));
CREATE POLICY "Canonical student contacts create" ON public.student_contacts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student contacts update" ON public.student_contacts FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student contacts delete" ON public.student_contacts FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));

DROP POLICY IF EXISTS "Canonical student schools read" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools create" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools update" ON public.student_schools;
DROP POLICY IF EXISTS "Canonical student schools delete" ON public.student_schools;
CREATE POLICY "Canonical student schools read" ON public.student_schools FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.read_sensitive'));
CREATE POLICY "Canonical student schools create" ON public.student_schools FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student schools update" ON public.student_schools FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student schools delete" ON public.student_schools FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));

DROP POLICY IF EXISTS "Canonical student credentials read" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials create" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials update" ON public.student_credentials;
DROP POLICY IF EXISTS "Canonical student credentials delete" ON public.student_credentials;
CREATE POLICY "Canonical student credentials read" ON public.student_credentials FOR SELECT TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.read_sensitive'));
CREATE POLICY "Canonical student credentials create" ON public.student_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student credentials update" ON public.student_credentials FOR UPDATE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'))
  WITH CHECK (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));
CREATE POLICY "Canonical student credentials delete" ON public.student_credentials FOR DELETE TO authenticated
  USING (public.can_access_sensitive_student(student_id, 'teaching.students.update_sensitive'));

DROP POLICY IF EXISTS "Canonical teacher credentials read" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials create" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials update" ON public.teacher_credentials;
DROP POLICY IF EXISTS "Canonical teacher credentials delete" ON public.teacher_credentials;
CREATE POLICY "Canonical teacher credentials read" ON public.teacher_credentials FOR SELECT TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.read_sensitive'));
CREATE POLICY "Canonical teacher credentials create" ON public.teacher_credentials FOR INSERT TO authenticated
  WITH CHECK (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));
CREATE POLICY "Canonical teacher credentials update" ON public.teacher_credentials FOR UPDATE TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'))
  WITH CHECK (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));
CREATE POLICY "Canonical teacher credentials delete" ON public.teacher_credentials FOR DELETE TO authenticated
  USING (public.can_access_teacher(teacher_id, 'teaching.teachers.update_sensitive'));

-- Column privileges prevent direct authenticated clients from selecting or
-- updating core PII. Revoke table-level grants first; a column-level revoke
-- cannot override a previously granted table-level privilege. The controlled
-- RPCs above remain callable through the user-JWT client and perform the
-- canonical permission checks themselves.
REVOKE SELECT, UPDATE ON TABLE public.students, public.teachers FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, created_at, updated_at, name, notes, notes_document, user_id, external_link)
  ON public.students TO authenticated;
GRANT UPDATE (name, notes, notes_document, updated_at, external_link)
  ON public.students TO authenticated;
GRANT SELECT (id, created_at, updated_at, name, user_id, bio, bio_document)
  ON public.teachers TO authenticated;
GRANT UPDATE (name, bio, bio_document, updated_at)
  ON public.teachers TO authenticated;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.permissions
      WHERE key IN (
        'teaching.students.read_sensitive',
        'teaching.students.update_sensitive',
        'teaching.teachers.read_sensitive',
        'teaching.teachers.update_sensitive'
      )) <> 4 THEN
    RAISE EXCEPTION '1000072 sensitive permission catalogue is incomplete';
  END IF;
END;
$$;
