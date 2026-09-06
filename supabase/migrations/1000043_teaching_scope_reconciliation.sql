-- EduLog final reconciliation layer.
-- Keep 1000001-1000042 immutable; this migration repairs partial deployments,
-- introduces the teaching domain, and makes core RLS fail closed.

DO $$
BEGIN
  IF to_regclass('public.roles') IS NULL
     OR to_regclass('public.permissions') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL
     OR to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.class_sessions') IS NULL
     OR to_regclass('public.enrollments') IS NULL
     OR to_regclass('public.occurrence_reports') IS NULL THEN
    RAISE EXCEPTION 'EduLog prerequisite migration chain is incomplete; expected 1000001-1000042 objects';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.teachings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_quarantine boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT teachings_name_not_blank CHECK (length(btrim(name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS teachings_owner_unique ON public.teachings(owner_user_id) WHERE owner_user_id IS NOT NULL AND is_quarantine = false;
CREATE UNIQUE INDEX IF NOT EXISTS teachings_quarantine_unique ON public.teachings(is_quarantine) WHERE is_quarantine = true;

CREATE TABLE IF NOT EXISTS public.teaching_members (
  teaching_id uuid NOT NULL REFERENCES public.teachings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (teaching_id, user_id),
  CONSTRAINT teaching_member_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.class_sessions ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);
ALTER TABLE public.report_templates ADD COLUMN IF NOT EXISTS teaching_id uuid REFERENCES public.teachings(id);

CREATE INDEX IF NOT EXISTS classrooms_teaching_idx ON public.classrooms(teaching_id);
CREATE INDEX IF NOT EXISTS courses_teaching_idx ON public.courses(teaching_id);
CREATE INDEX IF NOT EXISTS class_sessions_teaching_idx ON public.class_sessions(teaching_id);
CREATE INDEX IF NOT EXISTS teaching_members_user_idx ON public.teaching_members(user_id, status);

INSERT INTO public.teachings(name, owner_user_id)
SELECT 'Legacy teaching ' || left(owner_user_id::text, 8), owner_user_id
FROM (
  SELECT user_id AS owner_user_id FROM public.classrooms WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.courses WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.class_sessions WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM public.students WHERE user_id IS NOT NULL
) owners
ON CONFLICT DO NOTHING;

INSERT INTO public.teachings(name, is_quarantine)
VALUES ('Legacy quarantine (admin only)', true)
ON CONFLICT DO NOTHING;

UPDATE public.classrooms classroom
SET teaching_id = teaching.id
FROM public.teachings teaching
WHERE classroom.teaching_id IS NULL
  AND teaching.owner_user_id IS NOT DISTINCT FROM classroom.user_id
  AND teaching.is_quarantine = false;
UPDATE public.courses course
SET teaching_id = teaching.id
FROM public.teachings teaching
WHERE course.teaching_id IS NULL
  AND teaching.owner_user_id IS NOT DISTINCT FROM course.user_id
  AND teaching.is_quarantine = false;
WITH resolved_sessions AS (
  SELECT
    session.id,
    COALESCE(
      classroom.teaching_id,
      (
        SELECT course.teaching_id
        FROM public.courses course
        WHERE course.id = ANY(session.course_ids)
        ORDER BY course.teaching_id NULLS LAST
        LIMIT 1
      ),
      (SELECT id FROM public.teachings WHERE is_quarantine = true)
    ) AS resolved_teaching_id
  FROM public.class_sessions session
  LEFT JOIN public.classrooms classroom
    ON classroom.id IS NOT DISTINCT FROM session.classroom_id
  WHERE session.teaching_id IS NULL
)
UPDATE public.class_sessions target
SET teaching_id = resolved.resolved_teaching_id
FROM resolved_sessions resolved
WHERE target.id = resolved.id;

UPDATE public.classrooms
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;
UPDATE public.courses
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;
UPDATE public.class_sessions
SET teaching_id = (SELECT id FROM public.teachings WHERE is_quarantine = true)
WHERE teaching_id IS NULL;

INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('teaching_owner', 'Teaching owner', 'Full management access within an owned teaching', true, 5)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES ('teaching.members.manage', 'Manage teaching members', 'Manage membership within a teaching', 'teaching', 'members', 'manage')
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;
INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching.id, teaching.owner_user_id, role.id
FROM public.teachings teaching
JOIN public.roles role ON role.code = 'teaching_owner'
WHERE teaching.owner_user_id IS NOT NULL AND teaching.is_quarantine = false
ON CONFLICT (teaching_id, user_id) DO UPDATE SET role_id = COALESCE(teaching_members.role_id, EXCLUDED.role_id), status = 'active';

INSERT INTO public.roles(code, name, description, is_system, sort_order)
VALUES ('teaching_owner', 'Teaching owner', 'Full management access within an owned teaching', true, 5)
ON CONFLICT (code) WHERE code IS NOT NULL DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES ('teaching.members.manage', 'Manage teaching members', 'Manage membership within a teaching', 'teaching', 'members', 'manage')
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;
WITH teacher_memberships AS (
  SELECT DISTINCT ON (session.teaching_id, teacher.user_id)
    session.teaching_id,
    teacher.user_id,
    assignment.role_id
  FROM public.class_session_teachers assignment
  JOIN public.class_sessions session
    ON session.id = assignment.class_session_id
  JOIN public.teachers teacher
    ON teacher.id = assignment.teacher_id
  WHERE teacher.user_id IS NOT NULL
    AND session.teaching_id IS NOT NULL
  ORDER BY
    session.teaching_id,
    teacher.user_id,
    (assignment.role_id IS NULL),
    assignment.effective_from DESC,
    assignment.created_at DESC,
    assignment.id
)
INSERT INTO public.teaching_members(teaching_id, user_id, role_id)
SELECT teaching_id, user_id, role_id
FROM teacher_memberships
ON CONFLICT (teaching_id, user_id) DO UPDATE
SET role_id = COALESCE(teaching_members.role_id, EXCLUDED.role_id),
    status = 'active';

DO $$
BEGIN
  ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
  ALTER TABLE public.role_permission_policies ADD CONSTRAINT role_permission_policies_scope_shape CHECK (
    (scope_type = 'system' AND scope_id IS NULL)
    OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
  );
  ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignment_scope_shape;
  ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignment_scope_shape CHECK (
    (scope_type = 'system' AND scope_id IS NULL)
    OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_teaching_member(p_teaching_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.teaching_members member
    WHERE member.teaching_id = p_teaching_id
      AND member.user_id = p_user_id
      AND member.status = 'active'
      AND member.effective_from <= CURRENT_DATE
      AND (member.effective_to IS NULL OR member.effective_to >= CURRENT_DATE)
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH RECURSIVE assigned_roles AS (
  SELECT assignment.role_id
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
  UNION
  SELECT member.role_id FROM public.teaching_members member
  WHERE member.teaching_id = p_teaching_id AND member.user_id = p_user_id AND member.status = 'active'
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles WHERE role_id IS NOT NULL
  UNION
  SELECT inheritance.parent_role_id
  FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect, policy.scope_type
  FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND permission.key = p_permission_key
    AND (
      policy.scope_type = 'system'
      OR (policy.scope_type = 'teaching' AND policy.scope_id = p_teaching_id)
      OR (policy.scope_type = 'classroom' AND policy.scope_id = p_classroom_id)
      OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
    )
)
SELECT COALESCE(bool_or(matched.effect = 'allow'), false) AND NOT COALESCE(bool_or(matched.effect = 'deny'), false),
       COALESCE(bool_or(matched.effect = 'deny'), false),
       EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.has_teaching_permission(p_user_id uuid, p_permission_key text, p_teaching_id uuid, p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.role() = 'service_role' OR auth.uid() = p_user_id
    THEN COALESCE((SELECT is_allowed AND NOT is_denied FROM public.resolve_teaching_permission(p_user_id, p_permission_key, p_teaching_id, p_classroom_id, p_class_session_id) LIMIT 1), false)
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_teaching(p_teaching_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_teaching_member(p_teaching_id)
    AND (p_permission_key IS NULL OR public.has_teaching_permission(auth.uid(), p_permission_key, p_teaching_id));
$$;

CREATE OR REPLACE FUNCTION public.can_teaching_action(p_teaching_id uuid, p_resource text, p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access_teaching(p_teaching_id, 'teaching.' || p_resource || '.' || p_action)
      OR public.can_access_teaching(p_teaching_id, 'teaching.' || p_resource || '.manage');
$$;
CREATE OR REPLACE FUNCTION public.can_access_classroom(p_classroom_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.classrooms classroom WHERE classroom.id = p_classroom_id AND public.can_access_teaching(classroom.teaching_id, p_permission_key));
$$;

CREATE OR REPLACE FUNCTION public.can_access_class_session(p_class_session_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.class_sessions session WHERE session.id = p_class_session_id AND public.can_access_teaching(session.teaching_id, p_permission_key));
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(p_student_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = p_student_id AND (
      student.user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.enrollments enrollment JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id WHERE enrollment.student_id = student.id AND public.can_access_teaching(classroom.teaching_id, p_permission_key))
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(p_enrollment_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.enrollments enrollment
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_teaching(COALESCE(session.teaching_id, classroom.teaching_id), p_permission_key)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_report(p_report_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.occurrence_reports report
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE report.id = p_report_id AND public.can_access_teaching(session.teaching_id, p_permission_key)
  ) OR public.can_access_occurrence_report(p_report_id);
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['students','student_contacts','student_schools','student_credentials','teachers','courses','lessons','classrooms','classroom_schedules','class_sessions','class_session_teachers','holidays','enrollments','class_occurrences','report_templates','student_suspensions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', table_name);
  END LOOP;
END;
$$;

ALTER TABLE public.teachings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Teaching members can read teachings" ON public.teachings;
CREATE POLICY "Teaching members can read teachings" ON public.teachings FOR SELECT TO authenticated USING (public.can_access_teaching(id));
DROP POLICY IF EXISTS "Teaching owners manage teachings" ON public.teachings;
CREATE POLICY "Teaching owners manage teachings" ON public.teachings FOR ALL TO authenticated USING (owner_user_id = auth.uid() OR public.has_teaching_permission(auth.uid(), 'system.roles.manage', id)) WITH CHECK (owner_user_id = auth.uid() OR public.has_teaching_permission(auth.uid(), 'system.roles.manage', id));
DROP POLICY IF EXISTS "Teaching members can read membership" ON public.teaching_members;
CREATE POLICY "Teaching members can read membership" ON public.teaching_members FOR SELECT TO authenticated USING (public.can_access_teaching(teaching_id));
DROP POLICY IF EXISTS "Teaching managers manage membership" ON public.teaching_members;
CREATE POLICY "Teaching managers manage membership" ON public.teaching_members FOR ALL TO authenticated USING (public.has_teaching_permission(auth.uid(), 'teaching.members.manage', teaching_id)) WITH CHECK (public.has_teaching_permission(auth.uid(), 'teaching.members.manage', teaching_id));

DROP POLICY IF EXISTS "Teaching scoped classrooms" ON public.classrooms;
DROP POLICY IF EXISTS "Teaching classrooms read" ON public.classrooms;
DROP POLICY IF EXISTS "Teaching classrooms write" ON public.classrooms;
CREATE POLICY "Teaching classrooms read" ON public.classrooms FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'read') OR public.can_teaching_action(teaching_id, 'classrooms', 'list'));
CREATE POLICY "Teaching classrooms write" ON public.classrooms FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'create'));
CREATE POLICY "Teaching classrooms update" ON public.classrooms FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'classrooms', 'update'));
CREATE POLICY "Teaching classrooms delete" ON public.classrooms FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'classrooms', 'delete'));

DROP POLICY IF EXISTS "Teaching scoped courses" ON public.courses;
DROP POLICY IF EXISTS "Teaching courses read" ON public.courses;
DROP POLICY IF EXISTS "Teaching courses write" ON public.courses;
CREATE POLICY "Teaching courses read" ON public.courses FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'read') OR public.can_teaching_action(teaching_id, 'courses', 'list'));
CREATE POLICY "Teaching courses write" ON public.courses FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'create'));
CREATE POLICY "Teaching courses update" ON public.courses FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'courses', 'update'));
CREATE POLICY "Teaching courses delete" ON public.courses FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'courses', 'delete'));

DROP POLICY IF EXISTS "Teaching scoped sessions" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions read" ON public.class_sessions;
DROP POLICY IF EXISTS "Teaching sessions write" ON public.class_sessions;
CREATE POLICY "Teaching sessions read" ON public.class_sessions FOR SELECT TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'read') OR public.can_teaching_action(teaching_id, 'class_sessions', 'list'));
CREATE POLICY "Teaching sessions write" ON public.class_sessions FOR INSERT TO authenticated WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'create'));
CREATE POLICY "Teaching sessions update" ON public.class_sessions FOR UPDATE TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'update')) WITH CHECK (public.can_teaching_action(teaching_id, 'class_sessions', 'update'));
CREATE POLICY "Teaching sessions delete" ON public.class_sessions FOR DELETE TO authenticated USING (public.can_teaching_action(teaching_id, 'class_sessions', 'delete'));
DROP POLICY IF EXISTS "Teaching scoped lessons" ON public.lessons;
CREATE POLICY "Teaching scoped lessons" ON public.lessons FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_access_teaching(course.teaching_id))) WITH CHECK (EXISTS (SELECT 1 FROM public.courses course WHERE course.id = lessons.course_id AND public.can_access_teaching(course.teaching_id)));
DROP POLICY IF EXISTS "Teaching scoped session teachers" ON public.class_session_teachers;
CREATE POLICY "Teaching scoped session teachers" ON public.class_session_teachers FOR ALL TO authenticated USING (public.can_access_class_session(class_session_id)) WITH CHECK (public.can_access_class_session(class_session_id));
DROP POLICY IF EXISTS "Teaching scoped enrollments" ON public.enrollments;
CREATE POLICY "Teaching scoped enrollments" ON public.enrollments FOR ALL TO authenticated USING (public.can_access_enrollment(id)) WITH CHECK (public.can_access_enrollment(id));
DROP POLICY IF EXISTS "Teaching scoped occurrences" ON public.class_occurrences;
CREATE POLICY "Teaching scoped occurrences" ON public.class_occurrences FOR ALL TO authenticated USING (public.can_access_class_session(class_session_id)) WITH CHECK (public.can_access_class_session(class_session_id));
DROP POLICY IF EXISTS "Teaching scoped reports" ON public.occurrence_reports;
CREATE POLICY "Teaching scoped reports" ON public.occurrence_reports FOR ALL TO authenticated USING (public.can_access_report(id)) WITH CHECK (public.can_access_report(id));

REVOKE ALL ON FUNCTION public.is_teaching_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_teaching_permission(uuid, text, uuid, uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_teaching_permission(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_teaching(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_classroom(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_class_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_student(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_enrollment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_teaching_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_teaching_permission(uuid, text, uuid, uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_teaching_permission(uuid, text, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_teaching(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_classroom(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_class_session(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_student(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_enrollment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_report(uuid, text) TO authenticated, service_role;

-- The canonical permissions must also be attached after the catalogue insert.
INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "Teaching scoped report templates" ON public.report_templates;
CREATE POLICY "Teaching scoped report templates" ON public.report_templates FOR ALL TO authenticated
  USING (public.can_access_teaching(teaching_id, 'teaching.templates.read') OR instructor_id = auth.uid())
  WITH CHECK (public.can_access_teaching(teaching_id, 'teaching.templates.update') OR instructor_id = auth.uid());

DROP POLICY IF EXISTS "Teaching scoped teachers" ON public.teachers;
CREATE POLICY "Teaching scoped teachers" ON public.teachers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.class_session_teachers assignment
    JOIN public.class_sessions session ON session.id = assignment.class_session_id
    WHERE assignment.teacher_id = teachers.id AND public.can_access_class_session(session.id, 'teaching.teachers.read')
  ));
CREATE POLICY "Teaching teachers manage" ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Teaching teachers update" ON public.teachers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Teaching teachers delete" ON public.teachers FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Teaching scoped credentials" ON public.student_credentials;
CREATE POLICY "Teaching scoped credentials" ON public.student_credentials FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.manage'))
  WITH CHECK (user_id = auth.uid() OR public.can_access_student(student_id, 'teaching.students.manage'));

DO $$
DECLARE policy_name text;
BEGIN
  FOREACH policy_name IN ARRAY ARRAY[
    'Enable all access for authenticated users',
    'Allow all authenticated users',
    'Authenticated users can access all rows'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.report_templates', policy_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.student_credentials', policy_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_credentials', policy_name);
  END LOOP;
END;
$$;


-- Canonical permission catalogue and final consistency gate.
INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('teaching.%s.%s', resource_name, action_name),
       initcap(action_name) || ' ' || replace(resource_name, '_', ' '),
       'Canonical teaching-domain permission', 'teaching', resource_name, action_name
FROM unnest(ARRAY['teachings','members','courses','lessons','classrooms','class_sessions','students','enrollments','occurrences','reports','templates','holidays']) AS resources(resource_name)
CROSS JOIN unnest(ARRAY['create','read','update','delete','list','manage']) AS actions(action_name)
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.domain = 'teaching'
ON CONFLICT DO NOTHING;


DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.classrooms WHERE teaching_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.courses WHERE teaching_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.class_sessions WHERE teaching_id IS NULL) THEN
    RAISE EXCEPTION '1000043 teaching backfill incomplete: unscoped core rows remain';
  END IF;
END;
$$;


-- Defined after can_access_teaching so PostgreSQL validates dependencies in order.

GRANT EXECUTE ON FUNCTION public.can_teaching_action(uuid, text, text) TO authenticated, service_role;

-- Remove the remaining historical broad policies after scoped replacements have
-- been installed. Existing editor-scoped policies remain in place.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['class_occurrences','occurrence_reports','report_versions','documents'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', table_name);
  END LOOP;
END;
$$;
INSERT INTO public.permissions(key, name, description, domain, resource, action)
SELECT format('teaching.report-templates.%s', action_name),
       initcap(action_name) || ' report templates',
       'Canonical API alias for report templates', 'teaching', 'report-templates', action_name
FROM unnest(ARRAY['create','read','update','delete','list','manage']) AS actions(action_name)
ON CONFLICT (key) DO UPDATE SET domain = EXCLUDED.domain, resource = EXCLUDED.resource, action = EXCLUDED.action;

INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
SELECT owner_role.id, permission.id, 'system', NULL, 'allow'
FROM public.roles owner_role
CROSS JOIN public.permissions permission
WHERE owner_role.code = 'teaching_owner' AND permission.key LIKE 'teaching.report-templates.%'
ON CONFLICT DO NOTHING;