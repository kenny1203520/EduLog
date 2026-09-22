\set ON_ERROR_STOP on

DO $$
DECLARE
  v_teaching_id uuid;
  v_owner_user_id uuid;
  v_role_id uuid;
  v_permission_id uuid;
  v_definition text;
BEGIN
  SELECT teaching.id, teaching.owner_user_id
    INTO v_teaching_id, v_owner_user_id
  FROM public.teachings teaching
  WHERE teaching.owner_user_id IS NOT NULL AND NOT teaching.is_quarantine
  ORDER BY teaching.id
  LIMIT 1;

  SELECT id INTO v_role_id FROM public.roles WHERE code = 'teaching_owner';
  SELECT id INTO v_permission_id FROM public.permissions WHERE key = 'teaching.members.manage';
  IF v_teaching_id IS NULL OR v_owner_user_id IS NULL OR v_role_id IS NULL OR v_permission_id IS NULL THEN
    RAISE EXCEPTION 'RBAC scope fixture is incomplete';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.role_permission_policies'::regclass
    AND constraint_row.conname = 'role_permission_policies_scope_type_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('teaching' IN lower(COALESCE(v_definition, ''))) = 0 THEN
    RAISE EXCEPTION 'role_permission_policies does not allow teaching scope';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.user_role_assignments'::regclass
    AND constraint_row.conname = 'user_role_assignments_scope_type_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('teaching' IN lower(COALESCE(v_definition, ''))) = 0 THEN
    RAISE EXCEPTION 'user_role_assignments does not allow teaching scope';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.role_permission_policies'::regclass
      AND conname = 'role_permission_policies_scope_shape'
      AND contype = 'c' AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_role_assignments'::regclass
      AND conname = 'user_role_assignment_scope_shape'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'canonical RBAC scope-shape constraints are missing';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.role_permission_policies'::regclass
    AND constraint_row.conname = 'role_permission_policies_scope_shape'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('teaching' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('scope_id is not null' IN lower(COALESCE(v_definition, ''))) = 0 THEN
    RAISE EXCEPTION 'role_permission_policies has an invalid scope-shape definition';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.user_role_assignments'::regclass
    AND constraint_row.conname = 'user_role_assignment_scope_shape'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('teaching' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('scope_id is not null' IN lower(COALESCE(v_definition, ''))) = 0 THEN
    RAISE EXCEPTION 'user_role_assignments has an invalid scope-shape definition';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.role_permission_policies'::regclass
      AND conname = 'role_permission_policy_scope_shape'
  ) THEN
    RAISE EXCEPTION 'legacy singular role policy scope constraint remains';
  END IF;

  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  VALUES (v_role_id, v_permission_id, 'teaching', v_teaching_id, 'allow')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
  VALUES (v_owner_user_id, v_role_id, 'teaching', v_teaching_id)
  ON CONFLICT DO NOTHING;

  BEGIN
    INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
    VALUES (v_role_id, v_permission_id, 'invalid_scope', v_teaching_id, 'allow');
    RAISE EXCEPTION 'invalid role policy scope was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
    VALUES (v_owner_user_id, v_role_id, 'invalid_scope', v_teaching_id);
    RAISE EXCEPTION 'invalid role assignment scope was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
