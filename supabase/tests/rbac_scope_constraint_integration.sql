\set ON_ERROR_STOP on

DO $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
  v_permission_id uuid;
  v_scope_id uuid := gen_random_uuid();
  v_definition text;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'unassigned@example.test';
  SELECT id INTO v_role_id FROM public.roles WHERE code = 'teaching_owner' AND domain = 'teaching';
  SELECT id INTO v_permission_id FROM public.permissions WHERE key = 'teaching.roles.manage';
  IF v_user_id IS NULL OR v_role_id IS NULL OR v_permission_id IS NULL THEN
    RAISE EXCEPTION 'platform RBAC scope fixture is incomplete';
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.role_permission_policies'::regclass
    AND constraint_row.conname = 'role_permission_policies_scope_type_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('classroom' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('class_session' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('teaching' IN lower(COALESCE(v_definition, ''))) > 0 THEN
    RAISE EXCEPTION 'role_permission_policies has invalid scope types: %', v_definition;
  END IF;

  SELECT pg_get_constraintdef(constraint_row.oid)
    INTO v_definition
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.user_role_assignments'::regclass
    AND constraint_row.conname = 'user_role_assignments_scope_type_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF position('classroom' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('class_session' IN lower(COALESCE(v_definition, ''))) = 0
     OR position('teaching' IN lower(COALESCE(v_definition, ''))) > 0 THEN
    RAISE EXCEPTION 'user_role_assignments has invalid scope types: %', v_definition;
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

  -- Platform-level teaching policies and assignments use the system scope
  -- while the teaching domain remains distinct from the system role domain.
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  VALUES (v_role_id, v_permission_id, 'system', NULL, 'allow')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
  VALUES (v_user_id, v_role_id, 'system', NULL)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  VALUES (v_role_id, v_permission_id, 'classroom', v_scope_id, 'allow')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
  VALUES (v_role_id, v_permission_id, 'class_session', v_scope_id, 'allow')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
  VALUES (v_user_id, v_role_id, 'classroom', v_scope_id)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
  VALUES (v_user_id, v_role_id, 'class_session', v_scope_id)
  ON CONFLICT DO NOTHING;

  BEGIN
    INSERT INTO public.role_permission_policies(role_id, permission_id, scope_type, scope_id, effect)
    VALUES (v_role_id, v_permission_id, 'teaching', v_scope_id, 'allow');
    RAISE EXCEPTION 'legacy teaching policy scope was accepted';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'RBAC_SCOPE_DOMAIN_MISMATCH' THEN RAISE; END IF;
    WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id)
    VALUES (v_user_id, v_role_id, 'teaching', v_scope_id);
    RAISE EXCEPTION 'legacy teaching assignment scope was accepted';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'RBAC_ASSIGNMENT_DOMAIN_MISMATCH' THEN RAISE; END IF;
    WHEN check_violation THEN
    NULL;
  END;
END;
$$;
