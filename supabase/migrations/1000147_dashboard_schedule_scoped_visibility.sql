-- Dashboard "today's schedule" visibility per classroom and class.
--
-- 1000145 made the schedule all-or-nothing platform-wide. Teaching roles can
-- now choose, per system / classroom / class scope, one of four modes:
--   all       teaching.dashboard.schedule.all = allow, schedule.view = allow
--   assigned  teaching.dashboard.schedule.all = deny,  schedule.view = allow
--   hidden    teaching.dashboard.schedule.view = deny
--   inherit   no policy
-- all/assigned also write view = allow so that a more specific scope can lift
-- a "hidden" set further up.
--
-- resolve_dashboard_schedule_modes picks, per class and per teaching role, the
-- most specific policy (class > classroom > system), then the strictest
-- explicit mode across the user's teaching roles (hidden > assigned > all).
-- Roles without a policy do not restrict, and a user with no explicit mode
-- sees only the classes they teach.
--
-- Only teaching roles decide the schedule now: system.dashboard.schedule.all
-- (1000145) is removed, so system owners and administrators need a teaching
-- role set to "all" to see every class.

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permission_policies') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = 'teaching.dashboard.schedule.all') THEN
    RAISE EXCEPTION '1000147 prerequisites missing; apply migrations through 1000146 first';
  END IF;
END;
$$;

INSERT INTO public.permissions(key, name, description, domain, resource, action)
VALUES
  ('teaching.dashboard.schedule.view', '顯示今日課表', '拒絕時不在儀表板今日課表顯示該範圍的課程，包含自己授課的班級', 'teaching', 'dashboard', 'schedule_view')
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    domain = EXCLUDED.domain,
    resource = EXCLUDED.resource,
    action = EXCLUDED.action;

-- role_permission_policies rows cascade with the permission.
DELETE FROM public.permissions WHERE key = 'system.dashboard.schedule.all';

CREATE OR REPLACE FUNCTION public.resolve_dashboard_schedule_modes(
  p_user_id uuid, p_class_session_ids uuid[], p_effective_date date DEFAULT CURRENT_DATE
) RETURNS TABLE(class_session_id uuid, mode text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE targets AS (
  SELECT session.id AS class_session_id, session.classroom_id
  FROM public.class_sessions session
  WHERE session.id = ANY(p_class_session_ids)
    AND (auth.role() = 'service_role' OR auth.uid() = p_user_id)
), directives AS (
  SELECT target.class_session_id, assignment.role_id,
         CASE assignment.scope_type WHEN 'system' THEN 0 WHEN 'classroom' THEN 1 ELSE 2 END AS depth,
         'grant'::text AS directive
  FROM targets target
  JOIN public.user_role_assignments assignment
    ON assignment.user_id = p_user_id AND assignment.status = 'active'
   AND assignment.effective_from <= p_effective_date
   AND (assignment.effective_to IS NULL OR assignment.effective_to >= p_effective_date)
   AND (assignment.scope_type = 'system'
     OR (assignment.scope_type = 'classroom' AND assignment.scope_id = target.classroom_id)
     OR (assignment.scope_type = 'class_session' AND assignment.scope_id = target.class_session_id))
  JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
  UNION ALL
  SELECT target.class_session_id, grant_row.role_id, 2, 'grant'::text
  FROM targets target
  JOIN public.class_session_teacher_role_grants grant_row
    ON grant_row.user_id = p_user_id AND grant_row.class_session_id = target.class_session_id
   AND grant_row.effective_from <= p_effective_date
   AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= p_effective_date)
  JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
  UNION ALL
  SELECT target.class_session_id, exclusion.role_id,
         CASE exclusion.scope_type WHEN 'classroom' THEN 1 ELSE 2 END,
         'exclude'::text
  FROM targets target
  JOIN public.user_role_assignment_exclusions exclusion
    ON exclusion.user_id = p_user_id AND exclusion.effective_from <= p_effective_date
   AND (exclusion.effective_to IS NULL OR exclusion.effective_to >= p_effective_date)
   AND ((exclusion.scope_type = 'classroom' AND exclusion.scope_id = target.classroom_id)
     OR (exclusion.scope_type = 'class_session' AND exclusion.scope_id = target.class_session_id))
), ranked AS (
  SELECT directives.*, row_number() OVER (
    PARTITION BY directives.class_session_id, directives.role_id
    ORDER BY directives.depth DESC, (directives.directive = 'exclude') DESC
  ) AS rank
  FROM directives
), role_tree(class_session_id, root_role_id, role_id) AS (
  SELECT ranked.class_session_id, ranked.role_id, ranked.role_id FROM ranked WHERE ranked.rank = 1 AND ranked.directive = 'grant'
  UNION
  SELECT tree.class_session_id, tree.root_role_id, inheritance.parent_role_id
  FROM role_tree tree JOIN public.role_inheritance inheritance ON inheritance.role_id = tree.role_id
), role_policies AS (
  SELECT tree.class_session_id, tree.root_role_id, permission.key, policy.effect,
         row_number() OVER (
           PARTITION BY tree.class_session_id, tree.root_role_id, permission.key
           ORDER BY CASE policy.scope_type WHEN 'class_session' THEN 2 WHEN 'classroom' THEN 1 ELSE 0 END DESC,
                    (policy.effect = 'deny') DESC
         ) AS rank
  FROM role_tree tree
  JOIN targets target ON target.class_session_id = tree.class_session_id
  JOIN public.role_permission_policies policy ON policy.role_id = tree.role_id
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE permission.key IN ('teaching.dashboard.schedule.view', 'teaching.dashboard.schedule.all')
    AND (policy.scope_type = 'system'
      OR (policy.scope_type = 'classroom' AND policy.scope_id = target.classroom_id)
      OR (policy.scope_type = 'class_session' AND policy.scope_id = target.class_session_id))
), role_modes AS (
  -- 3 = hidden, 2 = assigned, 1 = all, NULL = no explicit mode for this role.
  SELECT role_policies.class_session_id,
         CASE
           WHEN bool_or(role_policies.key = 'teaching.dashboard.schedule.view' AND role_policies.effect = 'deny') THEN 3
           WHEN bool_or(role_policies.key = 'teaching.dashboard.schedule.all' AND role_policies.effect = 'deny') THEN 2
           WHEN bool_or(role_policies.key = 'teaching.dashboard.schedule.all' AND role_policies.effect = 'allow') THEN 1
         END AS strictness
  FROM role_policies
  WHERE role_policies.rank = 1
  GROUP BY role_policies.class_session_id, role_policies.root_role_id
)
SELECT target.class_session_id,
       CASE COALESCE(max(role_modes.strictness), 0)
         WHEN 3 THEN 'hidden'
         WHEN 1 THEN 'all'
         ELSE 'assigned'
       END
FROM targets target
LEFT JOIN role_modes ON role_modes.class_session_id = target.class_session_id
GROUP BY target.class_session_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_dashboard_schedule_modes(uuid, uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_dashboard_schedule_modes(uuid, uuid[], date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
