-- Teaching roles are platform-scoped but remain a distinct RBAC domain from
-- system-administration roles. No teaching role should point at a workspace.
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_domain_teaching_shape;
ALTER TABLE public.roles ADD CONSTRAINT roles_domain_teaching_shape CHECK (
  domain IN ('system', 'teaching') AND teaching_id IS NULL
);
