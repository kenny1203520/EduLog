-- Split read and write access so authenticated SELECT has only one permissive
-- policy while keeping the domain- and scope-aware management boundary.

DROP POLICY IF EXISTS "RBAC managers can read role policies"
  ON public.role_permission_policies;
DROP POLICY IF EXISTS "RBAC managers can manage role policies"
  ON public.role_permission_policies;

CREATE POLICY "RBAC managers can read role policies"
ON public.role_permission_policies FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission
      ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.read')
            OR public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', NULL, NULL)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', role_permission_policies.scope_id, NULL)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.read', NULL, role_permission_policies.scope_id)
            OR public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);

CREATE POLICY "RBAC managers can insert role policies"
ON public.role_permission_policies FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission
      ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);

CREATE POLICY "RBAC managers can update role policies"
ON public.role_permission_policies FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission
      ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission
      ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);

CREATE POLICY "RBAC managers can delete role policies"
ON public.role_permission_policies FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.roles role
    JOIN public.permissions permission
      ON permission.id = role_permission_policies.permission_id
    WHERE role.id = role_permission_policies.role_id
      AND role.domain = permission.domain
      AND CASE
        WHEN role.domain = 'system' AND role_permission_policies.scope_type = 'system'
          THEN public.has_system_permission((select auth.uid()), 'system.roles.manage')
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'system'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'classroom'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', role_permission_policies.scope_id, NULL)
        WHEN role.domain = 'teaching' AND role_permission_policies.scope_type = 'class_session'
          THEN public.has_api_permission((select auth.uid()), 'teaching.roles.manage', NULL, role_permission_policies.scope_id)
        ELSE false
      END
  )
);
