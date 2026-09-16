\set ON_ERROR_STOP on

-- Simulate a deployed database whose teaching rows exist but whose old
-- constraints were not reconciled. NOT VALID preserves those rows while
-- enforcing the legacy checks for new writes until 1000065 repairs them.
DO $$
BEGIN
  ALTER TABLE public.role_permission_policies
    DROP CONSTRAINT IF EXISTS role_permission_policies_scope_type_check,
    DROP CONSTRAINT IF EXISTS role_permission_policy_scope_shape,
    DROP CONSTRAINT IF EXISTS role_permission_policies_scope_shape;
  ALTER TABLE public.role_permission_policies
    ADD CONSTRAINT role_permission_policies_scope_type_check
      CHECK (scope_type IN ('system', 'classroom', 'class_session')) NOT VALID,
    ADD CONSTRAINT role_permission_policy_scope_shape CHECK (
      (scope_type = 'system' AND scope_id IS NULL)
      OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
    ) NOT VALID;

  ALTER TABLE public.user_role_assignments
    DROP CONSTRAINT IF EXISTS user_role_assignments_scope_type_check,
    DROP CONSTRAINT IF EXISTS user_role_assignment_scope_shape;
  ALTER TABLE public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_scope_type_check
      CHECK (scope_type IN ('system', 'classroom', 'class_session')) NOT VALID,
    ADD CONSTRAINT user_role_assignment_scope_shape CHECK (
      (scope_type = 'system' AND scope_id IS NULL)
      OR (scope_type IN ('classroom', 'class_session') AND scope_id IS NOT NULL)
    ) NOT VALID;
END;
$$;
