-- System-managed account status with last-owner protection.

DO $$
BEGIN
  IF to_regprocedure('public.rbac_is_system_owner(uuid)') IS NULL
     OR to_regprocedure('public.rbac_upsert_system_assignment(uuid,uuid,uuid,date,date,bigint)') IS NULL THEN
    RAISE EXCEPTION '1000083 prerequisites missing; apply 1000081-1000082 first';
  END IF;
END;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disabled_reason text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check CHECK (account_status IN ('active','disabled'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_disabled_shape;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_disabled_shape CHECK (
  (account_status = 'active' AND disabled_at IS NULL AND disabled_by IS NULL AND disabled_reason IS NULL)
  OR (account_status = 'disabled' AND disabled_at IS NOT NULL AND disabled_by IS NOT NULL AND length(btrim(disabled_reason)) BETWEEN 3 AND 500)
);
CREATE INDEX IF NOT EXISTS profiles_account_status_idx ON public.profiles(account_status, id);

CREATE TABLE IF NOT EXISTS public.user_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  previous_status text NOT NULL CHECK (previous_status IN ('active','disabled')),
  new_status text NOT NULL CHECK (new_status IN ('active','disabled')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS user_status_events_target_created_idx ON public.user_status_events(target_user_id, created_at DESC);
ALTER TABLE public.user_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_status_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.user_status_events TO service_role;

CREATE OR REPLACE FUNCTION public.set_system_user_status(
  p_user_id uuid, p_status text, p_reason text, p_expected_epoch bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_previous text;
  v_owner_count bigint;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  PERFORM pg_advisory_xact_lock(10083, 0);
  PERFORM public.rbac_assert_epoch(p_expected_epoch);
  IF NOT public.has_system_permission(auth.uid(), 'system.users.manage') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SYSTEM_USERS_MANAGE_REQUIRED';
  END IF;
  IF p_status NOT IN ('active','disabled') THEN RAISE EXCEPTION 'INVALID_ACCOUNT_STATUS'; END IF;
  IF p_status = 'disabled' AND (v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500) THEN
    RAISE EXCEPTION 'DISABLE_REASON_REQUIRED';
  END IF;
  SELECT account_status INTO v_previous FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF v_previous IS NULL THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;

  IF p_status = 'disabled' AND public.rbac_is_system_owner(p_user_id) THEN
    SELECT count(DISTINCT assignment.user_id) INTO v_owner_count
    FROM public.user_role_assignments assignment
    JOIN public.roles role ON role.id=assignment.role_id
    JOIN public.profiles profile ON profile.id=assignment.user_id AND profile.account_status='active'
    WHERE role.domain='system' AND role.code='system_owner' AND assignment.scope_type='system'
      AND assignment.effective_from <= CURRENT_DATE
      AND (assignment.effective_to IS NULL OR assignment.effective_to >= CURRENT_DATE);
    IF v_owner_count <= 1 THEN RAISE EXCEPTION 'LAST_SYSTEM_OWNER'; END IF;
  END IF;

  UPDATE public.profiles SET account_status=p_status,
    disabled_at=CASE WHEN p_status='disabled' THEN timezone('utc'::text, now()) ELSE NULL END,
    disabled_by=CASE WHEN p_status='disabled' THEN auth.uid() ELSE NULL END,
    disabled_reason=CASE WHEN p_status='disabled' THEN v_reason ELSE NULL END
  WHERE id=p_user_id;

  IF v_previous IS DISTINCT FROM p_status THEN
    INSERT INTO public.user_status_events(target_user_id,actor_user_id,previous_status,new_status,reason)
    VALUES (p_user_id,auth.uid(),v_previous,p_status,v_reason);
  END IF;
  RETURN jsonb_build_object('id',p_user_id,'account_status',p_status,
    'disabled_at',CASE WHEN p_status='disabled' THEN timezone('utc'::text, now()) ELSE NULL END);
END;
$$;

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
  SELECT id INTO v_role_id FROM public.roles WHERE domain='system' AND code='system_owner';
  INSERT INTO public.user_role_assignments(user_id,role_id,scope_type,scope_id,effective_from)
  VALUES (p_user_id,v_role_id,'system',NULL,CURRENT_DATE) RETURNING id INTO v_assignment_id;
  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_system_user_status(uuid,text,text,bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bootstrap_system_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_system_user_status(uuid,text,text,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_system_owner(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
