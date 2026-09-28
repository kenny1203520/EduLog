-- Avoid collisions between RETURNS TABLE output parameters and CTE columns
-- while resolving effective teaching roles.
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
    SELECT directives.*,
      row_number() OVER (
        PARTITION BY directives.role_id
        ORDER BY directives.depth DESC, (directives.directive = 'exclude') DESC
      ) AS rank
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
