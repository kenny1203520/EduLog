-- Unify effective teaching roles with classroom teacher assignments and make
-- enrollment creation depend on student readability plus destination access.

CREATE TABLE IF NOT EXISTS public.class_session_teacher_role_grants (
  teacher_assignment_id uuid PRIMARY KEY REFERENCES public.class_session_teachers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  class_session_id uuid NOT NULL REFERENCES public.class_sessions(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT class_session_teacher_role_grants_date_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS class_session_teacher_role_grants_resolution_idx
  ON public.class_session_teacher_role_grants(user_id, class_session_id, effective_from, effective_to);
ALTER TABLE public.class_session_teacher_role_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_session_teacher_role_grants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_session_teacher_role_grants TO service_role;

CREATE OR REPLACE FUNCTION public.sync_class_session_teacher_role_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE assignment public.class_session_teachers%ROWTYPE; teacher_user_id uuid; session_classroom_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN assignment := OLD; ELSE assignment := NEW; END IF;
  SELECT session.classroom_id INTO session_classroom_id
  FROM public.class_sessions session WHERE session.id = assignment.class_session_id;
  IF TG_OP <> 'INSERT' THEN
    SELECT session.classroom_id INTO session_classroom_id
    FROM public.class_sessions session WHERE session.id = OLD.class_session_id;
  END IF;
  IF NOT public.has_api_permission(auth.uid(), 'teaching.class_sessions.update', session_classroom_id, assignment.class_session_id)
     OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', session_classroom_id, assignment.class_session_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEACHER_ASSIGNMENT_REQUIRES_ROLE_MANAGEMENT';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    DELETE FROM public.class_session_teacher_role_grants WHERE teacher_assignment_id = OLD.id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT profile.auth_user_id INTO teacher_user_id
  FROM public.teacher_records teacher
  JOIN public.profiles profile ON profile.id = teacher.profile_id
  WHERE teacher.id = assignment.teacher_id;
  IF teacher_user_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.roles role WHERE role.id = assignment.role_id AND role.domain = 'teaching') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TEACHING_ROLE_REQUIRED';
  END IF;
  INSERT INTO public.class_session_teacher_role_grants(
    teacher_assignment_id, user_id, role_id, class_session_id, effective_from, effective_to
  ) VALUES (
    assignment.id, teacher_user_id, assignment.role_id, assignment.class_session_id,
    assignment.effective_from, assignment.effective_to
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_class_session_teacher_role_grant ON public.class_session_teachers;
CREATE TRIGGER sync_class_session_teacher_role_grant
AFTER INSERT OR UPDATE OR DELETE ON public.class_session_teachers
FOR EACH ROW EXECUTE FUNCTION public.sync_class_session_teacher_role_grant();

CREATE OR REPLACE FUNCTION public.replace_class_session_teacher_assignments(p_session_id uuid, p_teachers jsonb)
RETURNS SETOF public.class_session_teachers
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE session_classroom_id uuid; item jsonb;
BEGIN
  SELECT session.classroom_id INTO session_classroom_id
  FROM public.class_sessions session WHERE session.id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'CLASS_SESSION_NOT_FOUND'; END IF;
  IF auth.uid() IS NULL OR NOT public.has_api_permission(auth.uid(), 'teaching.class_sessions.update', session_classroom_id, p_session_id)
     OR NOT public.has_api_permission(auth.uid(), 'teaching.roles.manage', session_classroom_id, p_session_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEACHER_ASSIGNMENT_REQUIRES_ROLE_MANAGEMENT';
  END IF;
  IF COALESCE(jsonb_typeof(p_teachers) <> 'array', true) OR jsonb_array_length(p_teachers) > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_TEACHER_ASSIGNMENTS';
  END IF;
  DELETE FROM public.class_session_teachers WHERE class_session_id = p_session_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_teachers) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.roles role WHERE role.id = (item->>'role_id')::uuid AND role.domain = 'teaching') THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TEACHING_ROLE_REQUIRED';
    END IF;
    RETURN QUERY INSERT INTO public.class_session_teachers(
      class_session_id, teacher_id, role_id, effective_from, effective_to
    ) VALUES (
      p_session_id, (item->>'teacher_id')::uuid, (item->>'role_id')::uuid,
      (item->>'effective_from')::date, NULLIF(item->>'effective_to', '')::date
    ) RETURNING *;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_class_session_teacher_assignments(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_class_session_teacher_assignments(uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_teacher_account_role_grants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE linked_user_id uuid;
BEGIN
  SELECT profile.auth_user_id INTO linked_user_id
  FROM public.profiles profile WHERE profile.id = NEW.profile_id;
  IF linked_user_id IS NOT NULL THEN
    INSERT INTO public.class_session_teacher_role_grants(
      teacher_assignment_id, user_id, role_id, class_session_id, effective_from, effective_to
    )
    SELECT assignment.id, linked_user_id, assignment.role_id, assignment.class_session_id,
           assignment.effective_from, assignment.effective_to
    FROM public.class_session_teachers assignment
    WHERE assignment.teacher_id = NEW.id AND assignment.role_id IS NOT NULL
    ON CONFLICT (teacher_assignment_id) DO UPDATE SET
      user_id = EXCLUDED.user_id, role_id = EXCLUDED.role_id,
      class_session_id = EXCLUDED.class_session_id,
      effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to;
  ELSE
    DELETE FROM public.class_session_teacher_role_grants grant_row
    USING public.class_session_teachers assignment
    WHERE grant_row.teacher_assignment_id = assignment.id AND assignment.teacher_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_teacher_account_role_grants ON public.teacher_records;
CREATE TRIGGER sync_teacher_account_role_grants
AFTER UPDATE OF profile_id ON public.teacher_records
FOR EACH ROW WHEN (OLD.profile_id IS DISTINCT FROM NEW.profile_id)
EXECUTE FUNCTION public.sync_teacher_account_role_grants();

CREATE OR REPLACE FUNCTION public.sync_profile_teacher_role_grants()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.auth_user_id IS NOT NULL THEN
    INSERT INTO public.class_session_teacher_role_grants(
      teacher_assignment_id, user_id, role_id, class_session_id, effective_from, effective_to
    )
    SELECT assignment.id, NEW.auth_user_id, assignment.role_id, assignment.class_session_id,
           assignment.effective_from, assignment.effective_to
    FROM public.teacher_records teacher
    JOIN public.class_session_teachers assignment ON assignment.teacher_id = teacher.id
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    WHERE teacher.profile_id = NEW.id
    ON CONFLICT (teacher_assignment_id) DO UPDATE SET
      user_id = EXCLUDED.user_id, role_id = EXCLUDED.role_id,
      class_session_id = EXCLUDED.class_session_id,
      effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to;
  ELSE
    DELETE FROM public.class_session_teacher_role_grants grant_row
    USING public.teacher_records teacher, public.class_session_teachers assignment
    WHERE teacher.profile_id = NEW.id AND assignment.teacher_id = teacher.id
      AND grant_row.teacher_assignment_id = assignment.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_profile_teacher_role_grants ON public.profiles;
CREATE TRIGGER sync_profile_teacher_role_grants
AFTER UPDATE OF auth_user_id ON public.profiles
FOR EACH ROW WHEN (OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id)
EXECUTE FUNCTION public.sync_profile_teacher_role_grants();

-- Existing linked teachers inherit their existing class assignment role and dates.
INSERT INTO public.class_session_teacher_role_grants(
  teacher_assignment_id, user_id, role_id, class_session_id, effective_from, effective_to
)
SELECT assignment.id, profile.auth_user_id, assignment.role_id, assignment.class_session_id,
       assignment.effective_from, assignment.effective_to
FROM public.class_session_teachers assignment
JOIN public.teacher_records teacher ON teacher.id = assignment.teacher_id
JOIN public.profiles profile ON profile.id = teacher.profile_id
JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
WHERE profile.auth_user_id IS NOT NULL
ON CONFLICT (teacher_assignment_id) DO UPDATE SET
  user_id = EXCLUDED.user_id, role_id = EXCLUDED.role_id,
  class_session_id = EXCLUDED.class_session_id,
  effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to;

CREATE OR REPLACE FUNCTION public.resolve_teaching_permission(
  p_user_id uuid, p_permission_key text, p_teaching_id uuid,
  p_classroom_id uuid DEFAULT NULL, p_class_session_id uuid DEFAULT NULL,
  p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE target AS (
  SELECT COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)) AS classroom_id
), directives AS (
  SELECT assignment.role_id, assignment.scope_type, assignment.scope_id,
         CASE assignment.scope_type WHEN 'system' THEN 0 WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
         'grant'::text AS directive
  FROM public.user_role_assignments assignment
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  CROSS JOIN target
  WHERE assignment.user_id = p_user_id AND assignment.status = 'active'
    AND assignment.effective_from <= p_effective_date
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
    AND (assignment.scope_type = 'system'
      OR (assignment.scope_type = 'classroom' AND assignment.scope_id = target.classroom_id)
      OR (assignment.scope_type = 'class_session' AND assignment.scope_id = p_class_session_id))
  UNION ALL
  SELECT grant_row.role_id, 'class_session', grant_row.class_session_id, 2, 'grant'::text
  FROM public.class_session_teacher_role_grants grant_row
  JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
  WHERE grant_row.user_id = p_user_id AND grant_row.class_session_id = p_class_session_id
    AND grant_row.effective_from <= p_effective_date
    AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= p_effective_date)
  UNION ALL
  SELECT exclusion.role_id, exclusion.scope_type, exclusion.scope_id,
         CASE exclusion.scope_type WHEN 'classroom' THEN 1 ELSE 2 END,
         'exclude'::text
  FROM public.user_role_assignment_exclusions exclusion CROSS JOIN target
  WHERE exclusion.user_id = p_user_id AND exclusion.effective_from <= p_effective_date
    AND (exclusion.effective_to IS NULL OR exclusion.effective_to >= p_effective_date)
    AND ((exclusion.scope_type = 'classroom' AND exclusion.scope_id = target.classroom_id)
      OR (exclusion.scope_type = 'class_session' AND exclusion.scope_id = p_class_session_id))
), ranked AS (
  SELECT directives.*, row_number() OVER (PARTITION BY role_id ORDER BY depth DESC, (directive = 'exclude') DESC) AS rank
  FROM directives
), assigned_roles AS (
  SELECT role_id FROM ranked WHERE rank = 1 AND directive = 'grant'
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  JOIN role_tree role ON role.role_id = policy.role_id CROSS JOIN target
  WHERE permission.key = p_permission_key AND (
    policy.scope_type = 'system'
    OR (policy.scope_type = 'classroom' AND policy.scope_id = target.classroom_id)
    OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
  )
)
SELECT COALESCE(bool_or(effect = 'allow'), false) AND NOT COALESCE(bool_or(effect = 'deny'), false),
       COALESCE(bool_or(effect = 'deny'), false), EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_teaching_roles(
  p_user_id uuid, p_scope_type text, p_scope_id uuid, p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(role_id uuid, code text, name text, source_type text, source_scope_type text,
  source_scope_id uuid, effective_from date, effective_to date, is_excluded boolean, is_inherited boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_classroom_id uuid; v_session_id uuid; v_teaching_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() = 'anon' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUTH_REQUIRED';
  END IF;
  IF p_scope_type = 'system' THEN
    IF p_scope_id IS NOT NULL OR NOT (
      public.has_api_permission(auth.uid(), 'teaching.roles.read', NULL, NULL)
      OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, NULL)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_SCOPE_READ_REQUIRED';
    END IF;
  ELSIF p_scope_type = 'classroom' THEN
    v_classroom_id := p_scope_id;
    IF NOT (
      public.has_api_permission(auth.uid(), 'teaching.roles.read', v_classroom_id, NULL)
      OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', v_classroom_id, NULL)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_SCOPE_READ_REQUIRED';
    END IF;
  ELSIF p_scope_type = 'class_session' THEN
    v_session_id := p_scope_id;
    SELECT session.classroom_id, session.teaching_id INTO v_classroom_id, v_teaching_id
    FROM public.class_sessions session WHERE session.id = v_session_id;
    IF NOT FOUND OR NOT (
      public.has_api_permission(auth.uid(), 'teaching.roles.read', v_classroom_id, v_session_id)
      OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', v_classroom_id, v_session_id)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ROLE_SCOPE_READ_REQUIRED';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ROLE_SCOPE';
  END IF;
  RETURN QUERY
  WITH RECURSIVE target AS (
    SELECT v_classroom_id AS classroom_id, v_session_id AS session_id
  ), directives AS (
    SELECT assignment.role_id, assignment.scope_type, assignment.scope_id,
      CASE assignment.scope_type WHEN 'system' THEN 0 WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
      assignment.effective_from, assignment.effective_to, 'direct'::text AS source_type, 'grant'::text AS directive
    FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    CROSS JOIN target
    WHERE assignment.user_id = p_user_id AND assignment.status = 'active' AND assignment.effective_from <= p_effective_date
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
      AND (assignment.scope_type = 'system'
        OR (assignment.scope_type = 'classroom' AND assignment.scope_id = target.classroom_id)
        OR (assignment.scope_type = 'class_session' AND assignment.scope_id = target.session_id))
    UNION ALL
    SELECT grant_row.role_id, 'class_session', grant_row.class_session_id, 2,
      grant_row.effective_from, grant_row.effective_to, 'teaching_assignment', 'grant'
    FROM public.class_session_teacher_role_grants grant_row CROSS JOIN target
    WHERE grant_row.user_id = p_user_id AND grant_row.class_session_id = target.session_id
      AND grant_row.effective_from <= p_effective_date
      AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= p_effective_date)
    UNION ALL
    SELECT exclusion.role_id, exclusion.scope_type, exclusion.scope_id,
      CASE exclusion.scope_type WHEN 'classroom' THEN 1 ELSE 2 END,
      exclusion.effective_from, exclusion.effective_to, 'exclusion', 'exclude'
    FROM public.user_role_assignment_exclusions exclusion CROSS JOIN target
    WHERE exclusion.user_id = p_user_id AND exclusion.effective_from <= p_effective_date
      AND (exclusion.effective_to IS NULL OR exclusion.effective_to >= p_effective_date)
      AND ((exclusion.scope_type = 'classroom' AND exclusion.scope_id = target.classroom_id)
        OR (exclusion.scope_type = 'class_session' AND exclusion.scope_id = target.session_id))
  ), ranked AS (
    SELECT directives.*, row_number() OVER (PARTITION BY role_id ORDER BY depth DESC, (directive = 'exclude') DESC) AS rank
    FROM directives
  ), roots AS (
    SELECT * FROM ranked WHERE rank = 1 AND directive = 'grant'
  ), role_tree(role_id, source_type, source_scope_type, source_scope_id, effective_from, effective_to, root_role_id) AS (
    SELECT root.role_id, root.source_type, root.scope_type, root.scope_id, root.effective_from, root.effective_to, root.role_id FROM roots root
    UNION
    SELECT inheritance.parent_role_id, child.source_type, child.source_scope_type, child.source_scope_id, child.effective_from, child.effective_to, child.root_role_id
    FROM public.role_inheritance inheritance JOIN role_tree child ON child.role_id = inheritance.role_id
  )
  SELECT role.id, role.code, role.name, tree.source_type, tree.source_scope_type, tree.source_scope_id,
         tree.effective_from, tree.effective_to, false, tree.role_id <> tree.root_role_id
  FROM role_tree tree JOIN public.roles role ON role.id = tree.role_id
  UNION
  SELECT role.id, role.code, role.name, 'exclusion', exclusion.scope_type, exclusion.scope_id,
         exclusion.effective_from, exclusion.effective_to, true, false
  FROM ranked exclusion JOIN public.roles role ON role.id = exclusion.role_id
  WHERE exclusion.rank = 1 AND exclusion.directive = 'exclude';
END;
$$;
REVOKE ALL ON FUNCTION public.get_effective_teaching_roles(uuid,text,uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_teaching_roles(uuid,text,uuid,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(
  p_student_id uuid, p_course_id uuid, p_classroom_id uuid, p_class_session_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    LEFT JOIN public.courses course ON course.id = p_course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = p_classroom_id
    LEFT JOIN public.class_sessions session ON session.id = p_class_session_id
    WHERE student.id = p_student_id
      AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
      AND (session.teaching_id IS NULL OR session.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (classroom.teaching_id IS NULL OR classroom.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (course.teaching_id IS NULL OR course.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND public.can_access_student(student.id,
        CASE WHEN p_permission_key = 'teaching.enrollments.create'
          THEN 'teaching.students.read' ELSE p_permission_key END)
      AND CASE WHEN p_permission_key IS NULL
        THEN public.is_teaching_member(COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
        ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
      END
  );
$$;

NOTIFY pgrst, 'reload schema';
