\set ON_ERROR_STOP on

-- Regression for 1000163: new accounts start pending with no role, approval
-- activates them and grants the chosen roles at platform scope, default
-- roles cannot be protected, and the review queue lists only pending ones.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO auth.users(id, email, raw_app_meta_data)
VALUES ('a1630000-0000-4000-8000-000000000001', 'admin@example.test', '{}'),
       ('a1630000-0000-4000-8000-000000000002', 'oauth@example.test', '{"provider":"github"}');

DO $$
DECLARE v_teacher uuid; v_owner uuid; v_result jsonb;
BEGIN
  IF (SELECT account_status FROM public.profiles WHERE auth_user_id = 'a1630000-0000-4000-8000-000000000002') <> 'pending' THEN
    RAISE EXCEPTION 'new account did not start pending';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_role_assignments WHERE user_id = 'a1630000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'pending account holds a role';
  END IF;
  IF public.count_pending_accounts() < 2 THEN RAISE EXCEPTION 'pending count is wrong'; END IF;
  IF (SELECT provider FROM public.list_pending_accounts() WHERE id = 'a1630000-0000-4000-8000-000000000002') <> 'github' THEN
    RAISE EXCEPTION 'pending list lost the provider';
  END IF;

  -- Notified once only.
  IF NOT public.mark_pending_account_notified('a1630000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'first notification refused'; END IF;
  IF public.mark_pending_account_notified('a1630000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'notified twice'; END IF;

  SELECT id INTO v_teacher FROM public.roles WHERE domain = 'teaching' AND code = 'teacher';
  SELECT id INTO v_owner FROM public.roles WHERE domain = 'teaching' AND code = 'teaching_owner';

  -- Protected roles are never defaults nor granted on approval.
  BEGIN
    PERFORM public.set_account_default_roles(ARRAY[v_owner], NULL);
    RAISE EXCEPTION 'protected default role was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PROTECTED_ROLE_NOT_ALLOWED' THEN RAISE; END IF;
  END;
  IF public.set_account_default_roles(ARRAY[v_teacher], NULL) <> ARRAY[v_teacher] THEN RAISE EXCEPTION 'default roles not saved'; END IF;
  BEGIN
    PERFORM public.approve_account('a1630000-0000-4000-8000-000000000002', ARRAY[v_owner], NULL);
    RAISE EXCEPTION 'protected role granted on approval';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PROTECTED_ROLE_NOT_ALLOWED' THEN RAISE; END IF;
  END;

  v_result := public.approve_account('a1630000-0000-4000-8000-000000000002', ARRAY[v_teacher, v_teacher], 'a1630000-0000-4000-8000-000000000001');
  IF (SELECT account_status FROM public.profiles WHERE auth_user_id = 'a1630000-0000-4000-8000-000000000002') <> 'active'
     OR (SELECT approved_by FROM public.profiles WHERE auth_user_id = 'a1630000-0000-4000-8000-000000000002') <> 'a1630000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'approval did not activate the account';
  END IF;
  IF (SELECT count(*) FROM public.user_role_assignments
      WHERE user_id = 'a1630000-0000-4000-8000-000000000002' AND role_id = v_teacher AND scope_type = 'system') <> 1 THEN
    RAISE EXCEPTION 'approval did not grant the role once at platform scope';
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_pending_accounts() WHERE id = 'a1630000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'approved account still listed as pending';
  END IF;

  BEGIN
    PERFORM public.approve_account('a1630000-0000-4000-8000-000000000002', '{}', NULL);
    RAISE EXCEPTION 'active account approved twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCOUNT_NOT_PENDING' THEN RAISE; END IF;
  END;

  -- Updating an account never resets its status.
  UPDATE auth.users SET email = 'oauth2@example.test' WHERE id = 'a1630000-0000-4000-8000-000000000002';
  IF (SELECT account_status FROM public.profiles WHERE auth_user_id = 'a1630000-0000-4000-8000-000000000002') <> 'active' THEN
    RAISE EXCEPTION 'account update changed the status';
  END IF;
END;
$$;

-- Only the service role may call the review functions.
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.count_pending_accounts();
    RAISE EXCEPTION 'authenticated user counted pending accounts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

ROLLBACK;
