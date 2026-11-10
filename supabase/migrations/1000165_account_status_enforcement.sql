-- An account that is not active holds no permission in the database either.
--
-- The API refuses disabled and pending accounts at its entrance, but the
-- permission resolvers never looked at profiles.account_status, and two
-- entrances skipped the check: the realtime socket and the browser
-- extension, whose tokens live 90 days. A disabled account kept its role
-- assignments, so anything that reached the database with its identity was
-- authorized as before.
--
-- * private.account_is_active(user): the account has a profile and it is
--   active. No profile means not active.
-- * resolve_scoped_permission, has_system_permission, rbac_is_system_owner,
--   has_active_teaching_role and can_access_occurrence_report answer "no"
--   for an account that is not active. has_api_permission,
--   has_teaching_permission, has_teaching_permission_any_scope and the
--   can_access_* helpers resolve through these.
-- * Leaving the active status revokes the account's extension tokens; the
--   extension RPCs already refuse a revoked token. Tokens of accounts that
--   are not active today are revoked now.
--
-- The service role is not an account and is not affected.
--
-- Not covered here: policies that grant access by ownership (a row's own
-- user_id) without asking a resolver. Those still accept an unexpired access
-- token of a disabled account if it reaches PostgREST directly; GoTrue's ban
-- stops such an account from getting a new token.
--
-- Rerunnable.

DO $$
BEGIN
  IF to_regprocedure('public.resolve_scoped_permission(uuid,text,uuid,uuid,date)') IS NULL
     OR to_regclass('public.web_extension_tokens') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'profiles_account_status_check' AND pg_get_constraintdef(oid) LIKE '%pending%'
     ) THEN
    RAISE EXCEPTION '1000165 prerequisites missing; apply migrations through 1000164 first';
  END IF;
END;
$$;

BEGIN;

CREATE OR REPLACE FUNCTION private.account_is_active(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE auth_user_id = p_user_id AND account_status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION private.account_is_active(uuid) FROM PUBLIC, anon, authenticated;

-- 1000157's body; the result is "no" for an account that is not active.
CREATE OR REPLACE FUNCTION public.resolve_scoped_permission(p_user_id uuid, p_permission_key text, p_classroom_id uuid DEFAULT NULL::uuid, p_class_session_id uuid DEFAULT NULL::uuid, p_effective_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(is_allowed boolean, is_denied boolean, policy_configured boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    AND private.account_is_active(p_user_id)
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
    AND private.account_is_active(p_user_id)
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
$function$;

-- 1000099's body with the account check.
CREATE OR REPLACE FUNCTION public.has_system_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned_roles(role_id) AS (
  SELECT assignment.role_id FROM public.user_role_assignments assignment
  JOIN public.roles assigned_role ON assigned_role.id = assignment.role_id AND assigned_role.domain = 'system'
  WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
    AND assignment.status = 'active' AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned_roles
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
), matched AS (
  SELECT policy.effect FROM public.role_permission_policies policy
  JOIN public.permissions permission ON permission.id = policy.permission_id
  WHERE policy.role_id IN (SELECT role_id FROM role_tree)
    AND policy.scope_type = 'system' AND permission.key = p_permission_key
)
SELECT auth.role() = 'service_role' OR (
  auth.uid() = p_user_id
  AND private.account_is_active(p_user_id)
  AND COALESCE((SELECT bool_or(effect = 'allow') FROM matched), false)
  AND NOT COALESCE((SELECT bool_or(effect = 'deny') FROM matched), false)
);
$$;

CREATE OR REPLACE FUNCTION public.rbac_is_system_owner(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
WITH RECURSIVE assigned(role_id) AS (
  SELECT assignment.role_id FROM public.user_role_assignments assignment
  JOIN public.roles assigned_role ON assigned_role.id = assignment.role_id AND assigned_role.domain = 'system'
  WHERE assignment.user_id = p_user_id AND assignment.scope_type = 'system'
    AND assignment.status = 'active' AND assignment.effective_from <= CURRENT_DATE
    AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
), role_tree(role_id) AS (
  SELECT role_id FROM assigned
  UNION
  SELECT inheritance.parent_role_id FROM public.role_inheritance inheritance
  JOIN role_tree child ON child.role_id = inheritance.role_id
)
SELECT auth.role() = 'service_role' OR (auth.uid() = p_user_id AND private.account_is_active(p_user_id) AND EXISTS (
  SELECT 1 FROM role_tree tree JOIN public.roles role ON role.id = tree.role_id
  WHERE role.domain = 'system' AND role.code = 'system_owner'
));
$$;

-- 1000158's body with the account check.
CREATE OR REPLACE FUNCTION public.has_active_teaching_role(p_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT private.account_is_active(p_user_id) AND (EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id = assignment.role_id AND role.domain = 'teaching'
    WHERE assignment.user_id = p_user_id
      AND assignment.status = 'active'
      AND assignment.effective_from <= CURRENT_DATE AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  ) OR EXISTS (
    SELECT 1 FROM public.class_session_teacher_role_grants grant_row
    JOIN public.roles role ON role.id = grant_row.role_id AND role.domain = 'teaching'
    WHERE grant_row.user_id = p_user_id
      AND grant_row.effective_from <= CURRENT_DATE AND (grant_row.effective_to IS NULL OR grant_row.effective_to >= CURRENT_DATE)
  ));
$function$;

-- 1000040's body with the account check. It also grants by ownership (the
-- class's own teacher), so the check stands in front of both branches.
-- Policies refer to this function by identity, so it is replaced in place.
CREATE OR REPLACE FUNCTION public.can_access_occurrence_report(p_report_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        auth.uid() IS NOT NULL
        AND private.account_is_active(auth.uid())
        AND (
            EXISTS (
                SELECT 1
                FROM public.occurrence_reports report
                JOIN public.enrollments enrollment
                  ON enrollment.id = report.enrollment_id
                JOIN public.class_occurrences occurrence
                  ON occurrence.id = report.class_occurrence_id
                JOIN public.class_sessions session
                  ON session.id = occurrence.class_session_id
                WHERE report.id = p_report_id
                  AND (
                      session.user_id = auth.uid()
                      OR EXISTS (
                          SELECT 1
                          FROM public.class_session_teachers assignment
                          JOIN public.teachers teacher
                            ON teacher.id = assignment.teacher_id
                          WHERE assignment.class_session_id = occurrence.class_session_id
                            AND teacher.user_id = auth.uid()
                            AND assignment.effective_from <= occurrence.occurrence_date
                            AND (
                                assignment.effective_to IS NULL
                                OR assignment.effective_to >= occurrence.occurrence_date
                            )
                      )
                  )
                  AND (
                      enrollment.class_session_id = occurrence.class_session_id
                      OR EXISTS (
                          SELECT 1
                          FROM public.get_effective_occurrence_enrollment_ids(occurrence.id) roster
                          WHERE roster.enrollment_id = report.enrollment_id
                      )
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.resolve_user_permission(auth.uid(), 'rbac.manage', NULL, NULL) permission
                WHERE permission.is_allowed
                  AND NOT permission.is_denied
            )
        );
$function$;

-- Extension tokens end with the account's active status.
CREATE OR REPLACE FUNCTION private.revoke_extension_tokens_on_deactivation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.web_extension_tokens SET revoked_at = now()
  WHERE user_id = NEW.auth_user_id AND revoked_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_extension_tokens_on_deactivation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_revoke_extension_tokens ON public.profiles;
CREATE TRIGGER profiles_revoke_extension_tokens AFTER UPDATE OF account_status ON public.profiles
FOR EACH ROW WHEN (OLD.account_status = 'active' AND NEW.account_status <> 'active' AND NEW.auth_user_id IS NOT NULL)
EXECUTE FUNCTION private.revoke_extension_tokens_on_deactivation();

UPDATE public.web_extension_tokens token SET revoked_at = now()
WHERE token.revoked_at IS NULL AND NOT private.account_is_active(token.user_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
