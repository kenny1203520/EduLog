-- The original RBAC checks predate teaching scopes. Replace both the old
-- scope-type allowlists and the singular legacy policy shape constraint
-- before 1000058 writes teaching-scoped policies.
DO $$
BEGIN
  IF to_regclass('public.role_permission_policies') IS NULL
     OR to_regclass('public.user_role_assignments') IS NULL THEN
    RAISE EXCEPTION '1000057a prerequisites missing; apply RBAC foundation first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permission_policies' AND column_name = 'scope_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'role_permission_policies' AND column_name = 'scope_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_role_assignments' AND column_name = 'scope_type'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_role_assignments' AND column_name = 'scope_id'
  ) THEN
    RAISE EXCEPTION '1000057a prerequisites missing; RBAC scope columns are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.role_permission_policies
    WHERE scope_type IS NULL
       OR scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')
       OR (scope_type = 'system' AND scope_id IS NOT NULL)
       OR (scope_type <> 'system' AND scope_id IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.user_role_assignments
    WHERE scope_type IS NULL
       OR scope_type NOT IN ('system', 'teaching', 'classroom', 'class_session')
       OR (scope_type = 'system' AND scope_id IS NOT NULL)
       OR (scope_type <> 'system' AND scope_id IS NULL)
  ) THEN
    RAISE EXCEPTION '1000057a found rows outside canonical RBAC scope; review data before migration';
  END IF;

  ALTER TABLE public.role_permission_policies
    DROP CONSTRAINT IF EXISTS role_permission_policies_scope_type_check,
    DROP CONSTRAINT IF EXISTS role_permission_policy_scope_shape,
    DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
  ALTER TABLE public.role_permission_policies
    ADD CONSTRAINT role_permission_policies_scope_type_check
      CHECK (scope_type IN ('system', 'teaching', 'classroom', 'class_session')),
    ADD CONSTRAINT role_permission_policies_scope_shape CHECK (
      (scope_type = 'system' AND scope_id IS NULL)
      OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
    );

  ALTER TABLE public.user_role_assignments
    DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check,
    DROP CONSTRAINT IF EXISTS user_role_assignment_scope_shape;
  ALTER TABLE public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_scope_type_check
      CHECK (scope_type IN ('system', 'teaching', 'classroom', 'class_session')),
    ADD CONSTRAINT user_role_assignment_scope_shape CHECK (
      (scope_type = 'system' AND scope_id IS NULL)
      OR (scope_type IN ('teaching', 'classroom', 'class_session') AND scope_id IS NOT NULL)
    );
END;
$$;
