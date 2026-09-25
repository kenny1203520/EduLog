-- Teaching roles are platform-scoped but remain a distinct RBAC domain from
-- system-administration roles. No teaching role should point at a workspace.
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_domain_teaching_shape;
ALTER TABLE public.roles ADD CONSTRAINT roles_domain_teaching_shape CHECK (
  domain IN ('system', 'teaching') AND teaching_id IS NULL
);

-- Legacy teaching-workspace policies were promoted to system scope in 1000099.
-- Keep only the current hierarchical scopes available at runtime.
ALTER TABLE public.role_permission_policies DROP CONSTRAINT IF EXISTS role_permission_policies_scope_type_check;
ALTER TABLE public.role_permission_policies ADD CONSTRAINT role_permission_policies_scope_type_check
  CHECK (scope_type IN ('system', 'classroom', 'class_session'));
ALTER TABLE public.user_role_assignments DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check;
ALTER TABLE public.user_role_assignments ADD CONSTRAINT user_role_assignments_scope_type_check
  CHECK (scope_type IN ('system', 'classroom', 'class_session'));
