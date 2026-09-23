-- Allow teaching roles to have a global teaching policy and manage policies
-- at teaching, classroom and class-session scopes. System roles remain separate.
DO $$
BEGIN
  ALTER TABLE public.role_permission_policies
    DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
  ALTER TABLE public.role_permission_policies
    ADD CONSTRAINT role_permission_policies_scope_shape CHECK (
      (scope_type = 'system' AND scope_id IS NULL)
      OR (scope_type = 'teaching' AND scope_id IS NOT NULL)
      OR (scope_type = 'teaching' AND scope_id IS NULL)
      OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
    );
END;
$$;

DROP INDEX IF EXISTS public.role_permission_policies_scoped_unique;
CREATE UNIQUE INDEX role_permission_policies_scoped_unique
  ON public.role_permission_policies(role_id, permission_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE scope_type <> 'system';

CREATE OR REPLACE FUNCTION public.validate_rbac_role_policy_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_permission public.permissions; v_teaching_id uuid;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = NEW.role_id;
  SELECT * INTO v_permission FROM public.permissions WHERE id = NEW.permission_id;
  IF v_role.id IS NULL OR v_permission.id IS NULL OR v_role.domain <> v_permission.domain THEN
    RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH';
  END IF;
  IF v_role.domain = 'system' AND (NEW.scope_type <> 'system' OR NEW.scope_id IS NOT NULL) THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF v_role.domain = 'teaching' AND NEW.scope_type = 'system' THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF NEW.scope_type = 'teaching' AND NEW.scope_id IS NOT NULL
     AND v_role.teaching_id IS NOT NULL AND NEW.scope_id <> v_role.teaching_id THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  IF NEW.scope_type = 'teaching' AND NEW.scope_id IS NULL AND v_role.teaching_id IS NOT NULL THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  v_teaching_id := public.rbac_scope_teaching_id(NEW.scope_type, NEW.scope_id);
  IF v_role.domain = 'teaching' AND v_role.teaching_id IS NOT NULL
     AND v_teaching_id IS NOT NULL AND v_role.teaching_id <> v_teaching_id THEN
    RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
  END IF;
  RETURN NEW;
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
  UNION
  SELECT member.role_id, 'teaching', member.teaching_id
  FROM public.teaching_members member
  WHERE member.teaching_id = p_teaching_id AND member.user_id = p_user_id
    AND member.status = 'active' AND member.effective_from <= p_effective_date
    AND (member.effective_to IS NULL OR member.effective_to >= p_effective_date)
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
    OR (policy.scope_type = 'teaching' AND (
      policy.scope_id IS NULL OR policy.scope_id = p_teaching_id
    ) AND (
      role.source_scope_type = 'system'
      OR (role.source_scope_type = 'teaching' AND role.source_scope_id = p_teaching_id)
      OR (role.source_scope_type = 'classroom' AND role.source_scope_id = COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)))
      OR (role.source_scope_type = 'class_session' AND role.source_scope_id = p_class_session_id)
    ))
    OR (policy.scope_type = 'classroom' AND policy.scope_id = COALESCE(p_classroom_id, (SELECT session.classroom_id FROM public.class_sessions session WHERE session.id = p_class_session_id)))
    OR (policy.scope_type = 'class_session' AND policy.scope_id = p_class_session_id)
  )
)
SELECT COALESCE(bool_or(matched.effect = 'allow'), false) AND NOT COALESCE(bool_or(matched.effect = 'deny'), false),
       COALESCE(bool_or(matched.effect = 'deny'), false), EXISTS (SELECT 1 FROM matched)
FROM matched;
$$;

-- RLS predicates pass the owning classroom and class session through to the
-- same resolver, so scoped policies protect stored resources as well as APIs.
CREATE OR REPLACE FUNCTION public.can_access_classroom(p_classroom_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classrooms classroom
    WHERE classroom.id = p_classroom_id
      AND (p_permission_key IS NULL OR public.has_teaching_permission(auth.uid(), p_permission_key, classroom.teaching_id, classroom.id, NULL))
      AND (p_permission_key IS NOT NULL OR public.is_teaching_member(classroom.teaching_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_class_session(p_class_session_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.class_sessions session
    WHERE session.id = p_class_session_id
      AND (p_permission_key IS NULL OR public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id))
      AND (p_permission_key IS NOT NULL OR public.is_teaching_member(session.teaching_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_student(p_student_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id = p_student_id AND (
      student.user_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.enrollments enrollment
        LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
        LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
        LEFT JOIN public.courses course ON course.id = enrollment.course_id
        WHERE enrollment.student_id = student.id
          AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
          AND CASE WHEN p_permission_key IS NULL
            THEN public.is_teaching_member(COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
            ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
              COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
              COALESCE(classroom.id, session.classroom_id), session.id)
          END
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment_scope(
  p_student_id uuid, p_course_id uuid, p_classroom_id uuid, p_class_session_id uuid,
  p_permission_key text DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students student
    LEFT JOIN public.courses course ON course.id = p_course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = p_classroom_id
    LEFT JOIN public.class_sessions session ON session.id = p_class_session_id
    WHERE student.id = p_student_id
      AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
      AND (session.teaching_id IS NULL OR session.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (classroom.teaching_id IS NULL OR classroom.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND (course.teaching_id IS NULL OR course.teaching_id = COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
      AND public.can_access_student(student.id, p_permission_key)
      AND CASE WHEN p_permission_key IS NULL
        THEN public.is_teaching_member(COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
        ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
      END
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_enrollment(p_enrollment_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.enrollments enrollment
    LEFT JOIN public.courses course ON course.id = enrollment.course_id
    LEFT JOIN public.classrooms classroom ON classroom.id = enrollment.classroom_id
    LEFT JOIN public.class_sessions session ON session.id = enrollment.class_session_id
    WHERE enrollment.id = p_enrollment_id
      AND public.can_access_student(enrollment.student_id, p_permission_key)
      AND COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id) IS NOT NULL
      AND CASE WHEN p_permission_key IS NULL
        THEN public.is_teaching_member(COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id))
        ELSE public.has_teaching_permission(auth.uid(), p_permission_key,
          COALESCE(session.teaching_id, classroom.teaching_id, course.teaching_id),
          COALESCE(classroom.id, session.classroom_id), session.id)
      END
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_report(p_report_id uuid, p_permission_key text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.occurrence_reports report
    JOIN public.class_occurrences occurrence ON occurrence.id = report.class_occurrence_id
    JOIN public.class_sessions session ON session.id = occurrence.class_session_id
    WHERE report.id = p_report_id
      AND (p_permission_key IS NULL
        OR public.has_teaching_permission(auth.uid(), p_permission_key, session.teaching_id, session.classroom_id, session.id))
      AND (p_permission_key IS NOT NULL OR public.is_teaching_member(session.teaching_id))
  ) OR public.can_access_occurrence_report(p_report_id);
$$;

CREATE OR REPLACE FUNCTION public.rbac_replace_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid,
  p_expected_epoch bigint, p_policies jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_role public.roles;
  v_policies jsonb := COALESCE(p_policies, '[]'::jsonb);
  v_teaching_id uuid;
  v_allowed boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(10082, 2);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id FOR UPDATE;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF v_role.is_protected THEN RAISE EXCEPTION 'PROTECTED_ROLE'; END IF;
  IF (v_role.domain = 'system' AND (p_scope_type <> 'system' OR p_scope_id IS NOT NULL))
     OR (v_role.domain = 'teaching' AND p_scope_type NOT IN ('teaching', 'classroom', 'class_session')) THEN
    RAISE EXCEPTION 'RBAC_SCOPE_DOMAIN_MISMATCH';
  END IF;
  IF p_scope_type = 'system' THEN
    v_allowed := public.has_system_permission(auth.uid(), 'system.roles.manage');
  ELSIF p_scope_type = 'teaching' AND p_scope_id IS NULL THEN
    v_allowed := public.has_system_permission(auth.uid(), 'system.roles.manage');
  ELSE
    IF p_scope_id IS NULL THEN RAISE EXCEPTION 'RBAC_SCOPE_REQUIRED'; END IF;
    v_teaching_id := public.rbac_scope_teaching_id(p_scope_type, p_scope_id);
    IF v_teaching_id IS NULL THEN RAISE EXCEPTION 'RBAC_SCOPE_NOT_FOUND'; END IF;
    IF v_role.teaching_id IS NOT NULL AND v_role.teaching_id <> v_teaching_id THEN
      RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
    END IF;
    v_allowed := CASE p_scope_type
      WHEN 'teaching' THEN public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL, NULL)
      WHEN 'classroom' THEN public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL)
      WHEN 'class_session' THEN public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id)
      ELSE false END;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  IF jsonb_typeof(v_policies) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    WHERE jsonb_typeof(item) <> 'object' OR NOT (item ? 'permission_id') OR NOT (item ? 'effect')
      OR item->>'effect' NOT IN ('allow','deny') OR (item - 'permission_id' - 'effect') <> '{}'::jsonb
  ) THEN RAISE EXCEPTION 'INVALID_POLICY_PAYLOAD'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_policies) item
    LEFT JOIN public.permissions permission ON permission.id = (item->>'permission_id')::uuid
    WHERE permission.id IS NULL OR permission.domain <> v_role.domain
  ) THEN RAISE EXCEPTION 'RBAC_DOMAIN_MISMATCH'; END IF;
  DELETE FROM public.role_permission_policies
  WHERE role_id = p_role_id AND scope_type = p_scope_type AND scope_id IS NOT DISTINCT FROM p_scope_id;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  SELECT p_role_id, (item->>'permission_id')::uuid, p_scope_type, p_scope_id, item->>'effect'
  FROM jsonb_array_elements(v_policies) item;
  RETURN public.current_rbac_policy_epoch();
END;
$$;

DROP FUNCTION IF EXISTS public.rbac_get_role_permissions(uuid, text, uuid);
CREATE FUNCTION public.rbac_get_role_permissions(
  p_role_id uuid, p_scope_type text, p_scope_id uuid
) RETURNS TABLE(
  permission_id uuid, permission_key text, resource text, action text,
  local_effect text, inherited_effect text, inherited_from_role_id uuid,
  inherited_from_scope_type text, effective_effect text, denied boolean, epoch bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role public.roles; v_teaching_id uuid; v_classroom_id uuid; v_allowed boolean := false;
BEGIN
  SELECT * INTO v_role FROM public.roles WHERE id = p_role_id;
  IF v_role.id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND'; END IF;
  IF p_scope_type = 'system' THEN
    v_allowed := v_role.domain = 'system' AND (public.has_system_permission(auth.uid(), 'system.roles.read') OR public.has_system_permission(auth.uid(), 'system.roles.manage'));
  ELSIF v_role.domain = 'teaching' AND p_scope_type = 'teaching' AND p_scope_id IS NULL THEN
    v_allowed := public.has_system_permission(auth.uid(), 'system.roles.manage');
  ELSIF v_role.domain = 'teaching' AND p_scope_type IN ('teaching', 'classroom', 'class_session') AND p_scope_id IS NOT NULL THEN
    v_teaching_id := public.rbac_scope_teaching_id(p_scope_type, p_scope_id);
    IF p_scope_type = 'class_session' THEN SELECT classroom_id INTO v_classroom_id FROM public.class_sessions WHERE id = p_scope_id; END IF;
    IF v_role.teaching_id IS NOT NULL AND v_role.teaching_id <> v_teaching_id THEN
      RAISE EXCEPTION 'RBAC_CROSS_TEACHING_ROLE';
    END IF;
    v_allowed := CASE p_scope_type
      WHEN 'teaching' THEN public.has_teaching_permission(auth.uid(), 'teaching.roles.read', p_scope_id, NULL, NULL) OR public.has_teaching_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL, NULL)
      WHEN 'classroom' THEN public.has_api_permission(auth.uid(), 'teaching.roles.read', p_scope_id, NULL) OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', p_scope_id, NULL)
      WHEN 'class_session' THEN public.has_api_permission(auth.uid(), 'teaching.roles.read', NULL, p_scope_id) OR public.has_api_permission(auth.uid(), 'teaching.roles.manage', NULL, p_scope_id)
      ELSE false END;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'RBAC_MANAGE_REQUIRED'; END IF;
  RETURN QUERY
  WITH RECURSIVE parents(role_id, depth) AS (
    SELECT inheritance.parent_role_id, 1 FROM public.role_inheritance inheritance WHERE inheritance.role_id = p_role_id
    UNION ALL
    SELECT inheritance.parent_role_id, parents.depth + 1 FROM parents JOIN public.role_inheritance inheritance ON inheritance.role_id = parents.role_id
  ), applicable_scopes(scope_type, scope_id, priority) AS (
    SELECT p_scope_type, p_scope_id, 3
    UNION ALL SELECT 'classroom', v_classroom_id, 2 WHERE p_scope_type = 'class_session' AND v_classroom_id IS NOT NULL
    UNION ALL SELECT 'teaching', v_teaching_id, 1 WHERE p_scope_type IN ('classroom', 'class_session')
  ), local_policy AS (
    SELECT policy.permission_id, policy.effect FROM public.role_permission_policies policy
    WHERE policy.role_id = p_role_id AND policy.scope_type = p_scope_type AND policy.scope_id IS NOT DISTINCT FROM p_scope_id
  ), inherited_candidates AS (
    SELECT policy.permission_id, policy.effect, policy.role_id, parent.depth, scope.priority, scope.scope_type
    FROM parents parent JOIN public.role_permission_policies policy ON policy.role_id = parent.role_id
    JOIN applicable_scopes scope ON scope.scope_type = policy.scope_type AND scope.scope_id IS NOT DISTINCT FROM policy.scope_id
    UNION ALL
    SELECT policy.permission_id, policy.effect, policy.role_id, 0, scope.priority, scope.scope_type
    FROM public.role_permission_policies policy JOIN applicable_scopes scope
      ON scope.scope_type = policy.scope_type AND scope.scope_id IS NOT DISTINCT FROM policy.scope_id
    WHERE policy.role_id = p_role_id AND NOT (policy.scope_type = p_scope_type AND policy.scope_id IS NOT DISTINCT FROM p_scope_id)
  ), inherited_policy AS (
    SELECT DISTINCT ON (candidate.permission_id) candidate.permission_id, candidate.effect, candidate.role_id, candidate.scope_type
    FROM inherited_candidates candidate
    ORDER BY candidate.permission_id, (candidate.effect = 'deny') DESC, candidate.priority DESC, candidate.depth ASC
  )
  SELECT permission.id, permission.key, permission.resource, permission.action,
    local.effect, inherited.effect, inherited.role_id, inherited.scope_type,
    CASE WHEN local.effect = 'deny' OR inherited.effect = 'deny' THEN 'deny'
         WHEN local.effect = 'allow' OR inherited.effect = 'allow' THEN 'allow' ELSE NULL END,
    COALESCE(local.effect = 'deny' OR inherited.effect = 'deny', false), public.current_rbac_policy_epoch()
  FROM public.permissions permission
  LEFT JOIN local_policy local ON local.permission_id = permission.id
  LEFT JOIN inherited_policy inherited ON inherited.permission_id = permission.id
  WHERE permission.domain = v_role.domain
  ORDER BY permission.resource, permission.action, permission.key;
END;
$$;

REVOKE ALL ON FUNCTION public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rbac_get_role_permissions(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rbac_replace_role_permissions(uuid,text,uuid,bigint,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rbac_get_role_permissions(uuid,text,uuid) TO authenticated, service_role;
