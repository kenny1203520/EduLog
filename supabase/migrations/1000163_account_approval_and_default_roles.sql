-- Account approval and default roles for new accounts.
--
-- * profiles.account_status gains 'pending'. Every account GoTrue creates
--   from now on (OAuth, self sign-up, Studio) starts pending and holds no
--   role until an administrator approves it. Existing accounts keep their
--   status. Invited accounts are approved by the API right after the invite.
-- * account_default_roles: roles every approved or invited account receives,
--   at platform scope. Protected roles (owners) cannot be defaults.
-- * approve_account(user, roles, actor): pending -> active and the roles.
-- * list_pending_accounts() / count_pending_accounts(): the review queue.
-- * mark_pending_account_notified(user): record that administrators were told,
--   so the notification is sent once; list_account_approver_emails() says whom.
-- * bootstrap_system_owner also activates the account it makes owner.
--
-- All new functions are service-role only; the API checks the caller.
-- Rerunnable.

DO $$
BEGIN
  IF to_regprocedure('public.set_system_user_status(uuid,text,text,bigint)') IS NULL
     OR to_regprocedure('public.sync_user_to_profile()') IS NULL THEN
    RAISE EXCEPTION '1000163 prerequisites missing; apply 1000083 and 1000098 first';
  END IF;
END;
$$;

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_notified_at timestamptz;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active','disabled','pending'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_disabled_shape;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_disabled_shape CHECK (
  (account_status IN ('active','pending') AND disabled_at IS NULL AND disabled_by IS NULL AND disabled_reason IS NULL)
  OR (account_status = 'disabled' AND disabled_at IS NOT NULL AND disabled_by IS NOT NULL AND length(btrim(disabled_reason)) BETWEEN 3 AND 500)
);

ALTER TABLE public.user_status_events DROP CONSTRAINT IF EXISTS user_status_events_previous_status_check;
ALTER TABLE public.user_status_events ADD CONSTRAINT user_status_events_previous_status_check
  CHECK (previous_status IN ('active','disabled','pending'));
ALTER TABLE public.user_status_events DROP CONSTRAINT IF EXISTS user_status_events_new_status_check;
ALTER TABLE public.user_status_events ADD CONSTRAINT user_status_events_new_status_check
  CHECK (new_status IN ('active','disabled','pending'));

-- New GoTrue accounts start pending. Updates of an existing account (email
-- change, sign-in timestamps) never change its status.
CREATE OR REPLACE FUNCTION public.sync_user_to_profile()
RETURNS trigger
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles(auth_user_id, account_status)
  VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'pending' ELSE 'active' END)
  ON CONFLICT (auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TABLE IF NOT EXISTS public.account_default_roles (
  role_id uuid PRIMARY KEY REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.account_default_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_default_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_default_roles TO service_role;

CREATE OR REPLACE FUNCTION private.reject_protected_default_role()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.roles WHERE id = NEW.role_id AND is_protected) THEN
    RAISE EXCEPTION 'PROTECTED_ROLE_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS account_default_roles_not_protected ON public.account_default_roles;
CREATE TRIGGER account_default_roles_not_protected BEFORE INSERT OR UPDATE ON public.account_default_roles
FOR EACH ROW EXECUTE FUNCTION private.reject_protected_default_role();

-- Replace the default role set in one call.
CREATE OR REPLACE FUNCTION public.set_account_default_roles(p_role_ids uuid[], p_actor uuid)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  DELETE FROM public.account_default_roles WHERE NOT (role_id = ANY(COALESCE(p_role_ids, '{}')));
  INSERT INTO public.account_default_roles(role_id, created_by)
  SELECT DISTINCT role_id, p_actor FROM unnest(COALESCE(p_role_ids, '{}')) AS role_id
  ON CONFLICT (role_id) DO NOTHING;
  RETURN ARRAY(SELECT role_id FROM public.account_default_roles ORDER BY created_at, role_id);
END;
$$;

-- Activate a pending account and give it platform-scope roles. Roles the
-- account already holds at platform scope today are left as they are.
CREATE OR REPLACE FUNCTION public.approve_account(p_user_id uuid, p_role_ids uuid[], p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_previous text; v_role uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  PERFORM pg_advisory_xact_lock(10083, 0);
  SELECT account_status INTO v_previous FROM public.profiles WHERE auth_user_id = p_user_id FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF v_previous <> 'pending' THEN RAISE EXCEPTION 'ACCOUNT_NOT_PENDING'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.roles role WHERE role.id = ANY(COALESCE(p_role_ids, '{}')) AND role.is_protected
  ) THEN RAISE EXCEPTION 'PROTECTED_ROLE_NOT_ALLOWED'; END IF;
  IF (SELECT count(*) FROM public.roles WHERE id = ANY(COALESCE(p_role_ids, '{}')))
     <> cardinality(ARRAY(SELECT DISTINCT unnest(COALESCE(p_role_ids, '{}')))) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND';
  END IF;

  UPDATE public.profiles
  SET account_status = 'active', approved_at = timezone('utc'::text, now()), approved_by = p_actor
  WHERE auth_user_id = p_user_id;

  FOREACH v_role IN ARRAY ARRAY(SELECT DISTINCT unnest(COALESCE(p_role_ids, '{}'))) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.user_role_assignments assignment
      WHERE assignment.user_id = p_user_id AND assignment.role_id = v_role
        AND assignment.scope_type = 'system' AND assignment.status = 'active'
        AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
    ) THEN
      INSERT INTO public.user_role_assignments(user_id, role_id, scope_type, scope_id, effective_from, status)
      VALUES (p_user_id, v_role, 'system', NULL, CURRENT_DATE, 'active');
    END IF;
  END LOOP;

  IF p_actor IS NOT NULL THEN
    INSERT INTO public.user_status_events(target_user_id, actor_user_id, previous_status, new_status, reason)
    VALUES (p_user_id, p_actor, 'pending', 'active', 'approved');
  END IF;
  RETURN jsonb_build_object('id', p_user_id, 'account_status', 'active',
    'role_ids', to_jsonb(ARRAY(SELECT DISTINCT unnest(COALESCE(p_role_ids, '{}')))));
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_accounts()
RETURNS TABLE(id uuid, email text, provider text, display_name text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT account.id, account.email::text,
         COALESCE(account.raw_app_meta_data->>'provider', 'email'),
         COALESCE(NULLIF(profile.full_name, ''), account.raw_user_meta_data->>'full_name', account.raw_user_meta_data->>'name'),
         account.created_at
  FROM public.profiles profile
  JOIN auth.users account ON account.id = profile.auth_user_id
  WHERE profile.account_status = 'pending'
  ORDER BY account.created_at, account.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.count_pending_accounts()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  RETURN (SELECT count(*) FROM public.profiles WHERE account_status = 'pending' AND auth_user_id IS NOT NULL);
END;
$$;

-- True only for the first caller, so administrators hear about an account once.
CREATE OR REPLACE FUNCTION public.mark_pending_account_notified(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_updated integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  UPDATE public.profiles SET approval_notified_at = timezone('utc'::text, now())
  WHERE auth_user_id = p_user_id AND account_status = 'pending' AND approval_notified_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Emails of active accounts that may approve others (system.users.manage),
-- for the "account waiting for approval" notice.
CREATE OR REPLACE FUNCTION public.list_account_approver_emails()
RETURNS TABLE(email text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SERVICE_ROLE_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT DISTINCT account.email::text
  FROM public.profiles profile
  JOIN auth.users account ON account.id = profile.auth_user_id
  WHERE profile.account_status = 'active' AND account.email IS NOT NULL
    AND public.has_system_permission(account.id, 'system.users.manage');
END;
$$;

-- The first owner is made by an operator, so their account is approved too.
CREATE OR REPLACE FUNCTION public.bootstrap_system_owner(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_role_id uuid; v_assignment_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='SERVICE_ROLE_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id=assignment.role_id
    WHERE role.domain='system' AND role.code='system_owner' AND assignment.scope_type='system'
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE)
  ) THEN RAISE EXCEPTION 'SYSTEM_OWNER_ALREADY_EXISTS'; END IF;
  UPDATE public.profiles SET account_status='active', approved_at=timezone('utc'::text, now())
  WHERE auth_user_id=p_user_id AND account_status='pending';
  SELECT id INTO v_role_id FROM public.roles WHERE domain='system' AND code='system_owner';
  INSERT INTO public.user_role_assignments(user_id,role_id,scope_type,scope_id,effective_from)
  VALUES (p_user_id,v_role_id,'system',NULL,CURRENT_DATE) RETURNING id INTO v_assignment_id;
  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_default_roles(uuid[],uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_account(uuid,uuid[],uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_pending_accounts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.count_pending_accounts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_pending_account_notified(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bootstrap_system_owner(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_account_approver_emails() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_approver_emails() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_account_default_roles(uuid[],uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_account(uuid,uuid[],uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_accounts() TO service_role;
GRANT EXECUTE ON FUNCTION public.count_pending_accounts() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_pending_account_notified(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_system_owner(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
